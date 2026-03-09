from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from supabase import Client, create_client

from .retry_utils import run_with_backoff

logger = logging.getLogger(__name__)


def payload_hash(payload: dict[str, Any]) -> str:
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class SupabaseStorage:
    def __init__(self, *, url: str, service_role_key: str, batch_size: int = 200) -> None:
        self.client: Client = create_client(url, service_role_key)
        self.batch_size = batch_size

    def _chunked(self, rows: list[dict[str, Any]], chunk_size: int | None = None) -> Iterable[list[dict[str, Any]]]:
        size = chunk_size or self.batch_size
        for i in range(0, len(rows), size):
            yield rows[i : i + size]

    def _execute(self, fn, *, context: str):
        return run_with_backoff(fn, retries=5, context=context)

    def get_ingestion_state(self, keys: list[str] | None = None) -> dict[str, str]:
        query = self.client.table("ingestion_state").select("key,value")
        if keys:
            query = query.in_("key", keys)
        response = self._execute(lambda: query.execute(), context="select ingestion_state")
        return {row["key"]: row["value"] for row in (response.data or [])}

    def upsert_ingestion_state(self, values: dict[str, str]) -> None:
        rows = [{"key": k, "value": v, "updated_at": datetime.now(UTC).isoformat()} for k, v in values.items()]
        self._execute(
            lambda: self.client.table("ingestion_state").upsert(rows, on_conflict="key").execute(),
            context="upsert ingestion_state",
        )

    def fetch_existing_jobs(self, job_ids: list[int]) -> dict[int, dict[str, Any]]:
        if not job_ids:
            return {}

        response = self._execute(
            lambda: self.client.table("jobs").select("id,raw_json,is_active").in_("id", job_ids).execute(),
            context="select existing jobs",
        )
        return {int(row["id"]): row for row in (response.data or [])}

    def upsert_jobs(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return

        for chunk in self._chunked(rows):
            self._execute(
                lambda chunk=chunk: self.client.table("jobs").upsert(chunk, on_conflict="id").execute(),
                context="upsert jobs",
            )

    def replace_job_tags(self, tags_by_job_id: dict[int, list[str]]) -> None:
        if not tags_by_job_id:
            return

        job_ids = [int(job_id) for job_id in tags_by_job_id.keys()]
        self._execute(
            lambda: self.client.table("job_tags").delete().in_("job_id", job_ids).execute(),
            context="delete old job tags",
        )

        rows: list[dict[str, Any]] = []
        for job_id, tags in tags_by_job_id.items():
            for tag in sorted(set(tags)):
                rows.append({"job_id": int(job_id), "tag": tag})

        for chunk in self._chunked(rows):
            self._execute(
                lambda chunk=chunk: self.client.table("job_tags").insert(chunk).execute(),
                context="insert job tags",
            )

    def insert_job_events(self, events: list[dict[str, Any]]) -> None:
        if not events:
            return

        for chunk in self._chunked(events):
            self._execute(
                lambda chunk=chunk: self.client.table("job_events").insert(chunk).execute(),
                context="insert job events",
            )

    def persist_batch(
        self,
        *,
        jobs: list[dict[str, Any]],
        tags_by_job_id: dict[int, list[str]],
        events: list[dict[str, Any]],
    ) -> None:
        self.upsert_jobs(jobs)
        self.replace_job_tags(tags_by_job_id)
        self.insert_job_events(events)

    def upsert_taxonomy(self, concepts: list[dict[str, Any]]) -> int:
        if not concepts:
            return 0

        rows: list[dict[str, Any]] = []
        for concept in concepts:
            concept_id = concept.get("id") or concept.get("concept_id")
            concept_type = concept.get("type") or concept.get("concept_type") or "unknown"
            label = concept.get("preferred_label") or concept.get("label")
            if not concept_id or not label:
                continue
            rows.append(
                {
                    "concept_id": str(concept_id),
                    "concept_type": str(concept_type),
                    "preferred_label": str(label),
                    "ssyk_code": concept.get("ssyk_code"),
                    "parent_id": concept.get("parent_id"),
                    "cached_at": datetime.now(UTC).isoformat(),
                }
            )

        for chunk in self._chunked(rows):
            self._execute(
                lambda chunk=chunk: self.client.table("taxonomy_cache").upsert(chunk, on_conflict="concept_id").execute(),
                context="upsert taxonomy",
            )
        return len(rows)

    def fetch_jobs_between(self, period_start: str, period_end: str, *, target_only: bool) -> list[dict[str, Any]]:
        query = (
            self.client.table("jobs")
            .select("id,headline,employer_name,lang,remote_flag,role_family,published_at,is_active,is_target_role,is_noise")
            .gte("published_at", period_start)
            .lt("published_at", period_end)
            .eq("is_active", True)
        )
        if target_only:
            query = query.eq("is_target_role", True)

        response = self._execute(lambda: query.limit(10000).execute(), context="fetch jobs between")
        return response.data or []

    def fetch_tags_for_jobs(self, job_ids: list[int]) -> list[dict[str, Any]]:
        if not job_ids:
            return []
        response = self._execute(
            lambda: self.client.table("job_tags").select("job_id,tag").in_("job_id", job_ids).execute(),
            context="fetch job tags",
        )
        return response.data or []

    def fetch_event_counts(self, event_type: str, period_start: str, period_end: str) -> int:
        response = self._execute(
            lambda: self.client.table("job_events")
            .select("id", count="exact", head=True)
            .eq("event_type", event_type)
            .gte("event_time", period_start)
            .lt("event_time", period_end)
            .execute(),
            context=f"fetch {event_type} event count",
        )
        return int(response.count or 0)

    def upsert_weekly_digest(self, *, period_start: str, period_end: str, digest_json: dict[str, Any]) -> None:
        row = {
            "period_start": period_start,
            "period_end": period_end,
            "generated_at": datetime.now(UTC).isoformat(),
            "digest_json": digest_json,
        }
        self._execute(
            lambda: self.client.table("weekly_digests").insert(row).execute(),
            context="insert weekly digest",
        )

    def sample_target_jobs(self, *, limit: int = 50) -> list[dict[str, Any]]:
        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id,headline,employer_name,role_family,is_target_role,is_noise,relevance_score,reason_codes,published_at")
            .eq("is_active", True)
            .eq("is_target_role", True)
            .order("published_at", desc=True)
            .limit(limit)
            .execute(),
            context="sample target jobs",
        )
        return response.data or []

    def delete_demo_data(self, *, confirm: bool) -> None:
        if not confirm:
            raise RuntimeError("Refusing to delete demo data without explicit confirm=True")

        logger.warning("Deleting pipeline seed/demo tables")
        self._execute(
            lambda: self.client.table("job_tags").delete().gt("job_id", 0).execute(),
            context="delete job_tags",
        )
        self._execute(
            lambda: self.client.table("job_events").delete().gt("id", 0).execute(),
            context="delete job_events",
        )
        self._execute(
            lambda: self.client.table("weekly_digests").delete().gt("id", 0).execute(),
            context="delete weekly_digests",
        )
        self._execute(
            lambda: self.client.table("jobs").delete().gt("id", 0).execute(),
            context="delete jobs",
        )
        self._execute(
            lambda: self.client.table("ingestion_state").delete().neq("key", "__none__").execute(),
            context="delete ingestion_state",
        )
