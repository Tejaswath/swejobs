from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime
from typing import Any

from .classify import classify_job
from .jobtech import JobTechClient
from .normalize import normalize_job
from .storage import SupabaseStorage, payload_hash
from .target_profile import TargetProfile

logger = logging.getLogger(__name__)


class IngestionPipeline:
    def __init__(
        self,
        *,
        client: JobTechClient,
        storage: SupabaseStorage,
        profile: TargetProfile,
        batch_size: int,
        poll_seconds: int,
    ) -> None:
        self.client = client
        self.storage = storage
        self.profile = profile
        self.batch_size = batch_size
        self.poll_seconds = poll_seconds

    def _classify_and_prepare(self, raw: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        job_row, tags = normalize_job(raw)
        classification = classify_job(job_row, self.profile)
        job_row.update(
            {
                "role_family": classification.role_family,
                "relevance_score": classification.relevance_score,
                "reason_codes": classification.reason_codes,
                "is_target_role": classification.is_target_role,
                "is_noise": classification.is_noise,
                # Keep existing frontend behavior aligned.
                "is_relevant": classification.is_target_role,
            }
        )
        if classification.role_family != "noise":
            tags = sorted(set(tags + [classification.role_family]))
        return job_row, tags

    def _build_events(
        self,
        *,
        jobs: list[dict[str, Any]],
        existing: dict[int, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        now = datetime.now(UTC).isoformat()
        for job in jobs:
            job_id = int(job["id"])
            previous = existing.get(job_id)
            current_hash = payload_hash(job.get("raw_json") or {})
            prev_hash = None
            if previous and previous.get("raw_json"):
                prev_hash = payload_hash(previous["raw_json"])

            event_type = None
            if previous is None:
                event_type = "created"
            elif not bool(job.get("is_active")) and bool(previous.get("is_active", True)):
                event_type = "removed"
            elif prev_hash != current_hash:
                event_type = "updated"

            if event_type:
                events.append(
                    {
                        "job_id": job_id,
                        "event_type": event_type,
                        "event_time": now,
                        "payload_hash": current_hash,
                    }
                )
        return events

    def _persist_records(
        self,
        *,
        records: list[dict[str, Any]],
        checkpoint_update: dict[str, str] | None,
    ) -> int:
        jobs: list[dict[str, Any]] = []
        tags_by_job_id: dict[int, list[str]] = {}

        for raw in records:
            try:
                job_row, tags = self._classify_and_prepare(raw)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Parse failure for record: %s", exc)
                continue
            jobs.append(job_row)
            tags_by_job_id[int(job_row["id"])] = tags

        if not jobs:
            return 0

        existing = self.storage.fetch_existing_jobs([int(job["id"]) for job in jobs])
        events = self._build_events(jobs=jobs, existing=existing)

        self.storage.persist_batch(jobs=jobs, tags_by_job_id=tags_by_job_id, events=events)

        # Checkpoint is only advanced after successful data persistence.
        if checkpoint_update:
            self.storage.upsert_ingestion_state(checkpoint_update)

        return len(jobs)

    def sync_taxonomy(self, limit: int | None = None) -> int:
        concepts = self.client.fetch_taxonomy(limit=limit)
        count = self.storage.upsert_taxonomy(concepts)
        logger.info("Upserted taxonomy concepts: %s", count)
        return count

    def run_snapshot(self, *, limit: int | None = None) -> int:
        processed = 0
        batch: list[dict[str, Any]] = []
        for row in self.client.iter_snapshot(limit=limit):
            batch.append(row)
            if len(batch) >= self.batch_size:
                processed += self._persist_records(records=batch, checkpoint_update=None)
                batch = []

        if batch:
            processed += self._persist_records(records=batch, checkpoint_update=None)

        self.storage.upsert_ingestion_state(
            {
                "snapshot_complete": "true",
                "last_poll_at": datetime.now(UTC).isoformat(),
            }
        )
        logger.info("Snapshot ingestion complete. rows=%s", processed)
        return processed

    def run_stream_once(self, *, limit: int | None = None) -> int:
        state = self.storage.get_ingestion_state(["last_stream_timestamp"])
        since = state.get("last_stream_timestamp")

        events, next_cursor = self.client.get_stream_events(since=since, limit=limit)
        if not events:
            self.storage.upsert_ingestion_state({"last_poll_at": datetime.now(UTC).isoformat()})
            logger.info("Stream poll returned no events")
            return 0

        processed = self._persist_records(
            records=events,
            checkpoint_update={
                "last_poll_at": datetime.now(UTC).isoformat(),
                "last_stream_timestamp": next_cursor or datetime.now(UTC).isoformat(),
            },
        )
        logger.info("Stream poll processed rows=%s", processed)
        return processed

    def run_smoke(self, *, limit: int = 1) -> int:
        rows = list(self.client.iter_snapshot(limit=limit))
        if not rows:
            raise RuntimeError("No rows returned from snapshot smoke call")

        processed = self._persist_records(
            records=rows,
            checkpoint_update={
                "snapshot_complete": "smoke",
                "last_poll_at": datetime.now(UTC).isoformat(),
                "last_stream_timestamp": datetime.now(UTC).isoformat(),
            },
        )
        logger.info("Smoke test inserted rows=%s", processed)
        return processed

    def run_poll_forever(self) -> None:
        while True:
            started_at = time.monotonic()
            try:
                self.run_stream_once()
            except Exception as exc:  # noqa: BLE001
                logger.exception("Stream poll failed: %s", exc)

            elapsed = time.monotonic() - started_at
            sleep_seconds = max(0, self.poll_seconds - int(elapsed))
            time.sleep(sleep_seconds)

    def dump_state(self) -> str:
        state = self.storage.get_ingestion_state()
        return json.dumps(state, indent=2)
