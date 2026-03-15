from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from .classify import classify_job
from .digest import generate_weekly_digest
from .jobtech import JobTechClient
from .normalize import normalize_job
from .company_registry import company_registry_map, load_company_registry
from .sources.base import CompanyFeed, FeedFetchResult, load_company_feeds
from .sources.greenhouse import fetch_greenhouse_jobs
from .sources.jobs2web import fetch_jobs2web_jobs
from .sources.html_fallback import fetch_html_fallback_jobs
from .sources.lever import fetch_lever_jobs
from .sources.smartrecruiters import fetch_smartrecruiters_jobs
from .sources.teamtailor import fetch_teamtailor_jobs
from .sources.workday import discover_workday_endpoint, fetch_workday_jobs
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
        digest_window_days: int,
        digest_refresh_minutes: int,
        request_timeout_seconds: int,
        enable_company_feeds: bool,
        company_feed_config_path: str,
        feed_interval_polls: int,
        feed_http_budget: int,
        feed_row_budget: int,
        feed_consecutive_miss_threshold: int,
        stream_reset_stale_cursor_hours: int,
        compaction_interval_hours: int,
        compaction_raw_json_days: int,
        compaction_inactive_job_days: int,
        compaction_job_event_days: int,
        compaction_weekly_digest_days: int,
    ) -> None:
        self.client = client
        self.storage = storage
        self.profile = profile
        self.batch_size = batch_size
        self.poll_seconds = poll_seconds
        self.digest_window_days = digest_window_days
        self.digest_refresh_minutes = digest_refresh_minutes
        self.request_timeout_seconds = request_timeout_seconds
        self.enable_company_feeds = enable_company_feeds
        self.company_feed_config_path = company_feed_config_path
        self.feed_interval_polls = max(1, feed_interval_polls)
        self.feed_http_budget = max(1, feed_http_budget)
        self.feed_row_budget = max(1, feed_row_budget)
        self.feed_consecutive_miss_threshold = max(1, feed_consecutive_miss_threshold)
        self.stream_reset_stale_cursor_hours = max(0, stream_reset_stale_cursor_hours)
        self.compaction_interval_hours = max(1, compaction_interval_hours)
        self.compaction_raw_json_days = max(1, compaction_raw_json_days)
        self.compaction_inactive_job_days = max(1, compaction_inactive_job_days)
        self.compaction_job_event_days = max(1, compaction_job_event_days)
        self.compaction_weekly_digest_days = max(1, compaction_weekly_digest_days)
        self._poll_counter = 0

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
                "company_canonical": classification.company_canonical or None,
                "company_tier": classification.company_tier,
                "career_stage": classification.career_stage,
                "career_stage_confidence": classification.career_stage_confidence,
                "is_grad_program": classification.is_grad_program,
                "years_required_min": classification.years_required_min,
                "swedish_required": classification.swedish_required,
                "consultancy_flag": classification.consultancy_flag,
                "citizenship_required": classification.citizenship_required,
                "security_clearance_required": classification.security_clearance_required,
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
        jobs, tags_by_job_id, _ = self._prepare_records(records)
        if not jobs:
            return 0

        existing = self.storage.fetch_existing_jobs([int(job["id"]) for job in jobs])
        events = self._build_events(jobs=jobs, existing=existing)

        self.storage.persist_batch(jobs=jobs, tags_by_job_id=tags_by_job_id, events=events)

        # Checkpoint is only advanced after successful data persistence.
        if checkpoint_update:
            self.storage.upsert_ingestion_state(checkpoint_update)

        return len(jobs)

    def _prepare_records(
        self,
        records: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], dict[int, list[str]], int]:
        prepared_rows: list[tuple[dict[str, Any], list[str]]] = []
        for raw in records:
            try:
                prepared_rows.append(self._classify_and_prepare(raw))
            except Exception as exc:  # noqa: BLE001
                logger.exception("Parse failure for record: %s", exc)
                continue

        if not prepared_rows:
            return [], {}, 0

        deduped_rows: list[tuple[dict[str, Any], list[str]]] = []
        seen_urls: set[str] = set()
        for job_row, tags in prepared_rows:
            source_url = str(job_row.get("source_url") or "").strip()
            if source_url:
                if source_url in seen_urls:
                    continue
                seen_urls.add(source_url)
            deduped_rows.append((job_row, tags))

        existing_by_url = self.storage.fetch_jobs_by_source_urls(
            [str(job.get("source_url") or "").strip() for job, _ in deduped_rows]
        )

        jobs: list[dict[str, Any]] = []
        tags_by_job_id: dict[int, list[str]] = {}
        target_count = 0
        for job_row, tags in deduped_rows:
            source_url = str(job_row.get("source_url") or "").strip()
            if source_url:
                existing = existing_by_url.get(source_url)
                if existing and existing.get("id") is not None:
                    job_row["id"] = int(existing["id"])

            job_id = int(job_row["id"])
            jobs.append(job_row)
            tags_by_job_id[job_id] = tags
            if bool(job_row.get("is_target_role")):
                target_count += 1

        return jobs, tags_by_job_id, target_count

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

    def reclassify_existing(self, *, limit: int | None = None, active_only: bool = True) -> int:
        processed = 0
        cursor = 0

        while True:
            if limit is not None and processed >= limit:
                break

            remaining = None if limit is None else max(0, limit - processed)
            fetch_limit = self.batch_size if remaining is None else min(self.batch_size, remaining)
            if fetch_limit <= 0:
                break

            rows = self.storage.fetch_jobs_raw_batch(
                after_id=cursor,
                limit=fetch_limit,
                active_only=active_only,
            )
            if not rows:
                break

            records: list[dict[str, Any]] = []
            for row in rows:
                raw = row.get("raw_json")
                if isinstance(raw, dict):
                    records.append(raw)
                else:
                    logger.warning("Skipping reclassify row id=%s due to invalid raw_json", row.get("id"))

            if records:
                processed += self._persist_records(records=records, checkpoint_update=None)

            try:
                cursor = int(rows[-1]["id"])
            except (KeyError, TypeError, ValueError):
                break

        logger.info("Reclassification complete. rows=%s active_only=%s", processed, active_only)
        return processed

    def run_stream_once(self, *, limit: int | None = None) -> int:
        state = self.storage.get_ingestion_state(["last_stream_timestamp", "snapshot_complete"])
        since = state.get("last_stream_timestamp")
        snapshot_complete = str(state.get("snapshot_complete", "")).strip().lower() == "true"

        if since and snapshot_complete and self.stream_reset_stale_cursor_hours > 0:
            try:
                since_dt = datetime.fromisoformat(str(since).replace("Z", "+00:00"))
                if since_dt.tzinfo is None:
                    since_dt = since_dt.replace(tzinfo=UTC)
                since_dt = since_dt.astimezone(UTC)
                cursor_age = datetime.now(UTC) - since_dt
                if cursor_age > timedelta(hours=self.stream_reset_stale_cursor_hours):
                    reset_to = datetime.now(UTC).isoformat()
                    logger.warning(
                        "Resetting stale stream cursor age=%s hours=%s old=%s new=%s",
                        round(cursor_age.total_seconds() / 3600, 2),
                        self.stream_reset_stale_cursor_hours,
                        since,
                        reset_to,
                    )
                    self.storage.upsert_ingestion_state(
                        {
                            "last_stream_timestamp": reset_to,
                            "last_poll_at": reset_to,
                        }
                    )
                    since = reset_to
            except ValueError:
                logger.warning("Ignoring unparsable last_stream_timestamp=%s", since)

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

    def compact_storage(self, *, confirm: bool = False, batch_size: int = 500) -> dict[str, Any]:
        now = datetime.now(UTC)
        raw_json_cutoff = (now - timedelta(days=self.compaction_raw_json_days)).isoformat()
        inactive_job_cutoff = (now - timedelta(days=self.compaction_inactive_job_days)).isoformat()
        job_event_cutoff = (now - timedelta(days=self.compaction_job_event_days)).isoformat()
        weekly_digest_cutoff = (now - timedelta(days=self.compaction_weekly_digest_days)).isoformat()

        counts = {
            "raw_json_rows_older_than_cutoff": self.storage.count_jobs_with_raw_json_before(raw_json_cutoff),
            "inactive_jobs_older_than_cutoff": self.storage.count_inactive_jobs_before(inactive_job_cutoff),
            "job_events_older_than_cutoff": self.storage.count_job_events_before(job_event_cutoff),
            "weekly_digests_older_than_cutoff": self.storage.count_weekly_digests_before(weekly_digest_cutoff),
        }

        report: dict[str, Any] = {
            "generated_at": now.isoformat(),
            "confirm": bool(confirm),
            "batch_size": int(batch_size),
            "cutoffs": {
                "raw_json_before": raw_json_cutoff,
                "inactive_jobs_before": inactive_job_cutoff,
                "job_events_before": job_event_cutoff,
                "weekly_digests_before": weekly_digest_cutoff,
            },
            "counts": counts,
        }

        if not confirm:
            report["status"] = "dry_run"
            return report

        summary = {
            "raw_json_cleared": 0,
            "inactive_jobs_deleted": 0,
            "job_events_deleted": 0,
            "weekly_digests_deleted": 0,
        }

        while True:
            job_ids = self.storage.fetch_job_ids_with_raw_json_before(cutoff_iso=raw_json_cutoff, limit=batch_size)
            if not job_ids:
                break
            summary["raw_json_cleared"] += self.storage.clear_raw_json_for_job_ids(job_ids)

        while True:
            event_ids = self.storage.fetch_job_event_ids_before(cutoff_iso=job_event_cutoff, limit=batch_size)
            if not event_ids:
                break
            summary["job_events_deleted"] += self.storage.delete_job_events_by_ids(event_ids)

        while True:
            digest_ids = self.storage.fetch_weekly_digest_ids_before(cutoff_iso=weekly_digest_cutoff, limit=batch_size)
            if not digest_ids:
                break
            summary["weekly_digests_deleted"] += self.storage.delete_weekly_digests_by_ids(digest_ids)

        while True:
            job_ids = self.storage.fetch_inactive_job_ids_before(cutoff_iso=inactive_job_cutoff, limit=batch_size)
            if not job_ids:
                break
            summary["inactive_jobs_deleted"] += self.storage.delete_jobs_by_ids(job_ids)

        finished_at = datetime.now(UTC).isoformat()
        self.storage.upsert_ingestion_state({"last_compaction_at": finished_at})
        report["status"] = "applied"
        report["summary"] = summary
        return report

    def maybe_run_compaction(self) -> bool:
        state = self.storage.get_ingestion_state(["last_compaction_at"])
        last_compaction = self._parse_state_datetime(state.get("last_compaction_at"))
        if last_compaction is not None:
            age = datetime.now(UTC) - last_compaction
            if age < timedelta(hours=self.compaction_interval_hours):
                return False

        report = self.compact_storage(confirm=True)
        logger.info(
            "Storage compaction complete. raw_json_cleared=%s inactive_jobs_deleted=%s job_events_deleted=%s weekly_digests_deleted=%s",
            report.get("summary", {}).get("raw_json_cleared", 0),
            report.get("summary", {}).get("inactive_jobs_deleted", 0),
            report.get("summary", {}).get("job_events_deleted", 0),
            report.get("summary", {}).get("weekly_digests_deleted", 0),
        )
        return True

    @staticmethod
    def _feed_state_key(feed_key: str, suffix: str) -> str:
        return f"feed:{feed_key}:{suffix}"

    def _fetch_company_feed(self, feed: CompanyFeed, *, max_rows: int, max_http: int):
        if feed.provider == "greenhouse":
            return fetch_greenhouse_jobs(
                feed,
                timeout_seconds=self.request_timeout_seconds,
                max_rows=max_rows,
                max_http=max_http,
            )
        if feed.provider == "lever":
            return fetch_lever_jobs(
                feed,
                timeout_seconds=self.request_timeout_seconds,
                max_rows=max_rows,
                max_http=max_http,
            )
        if feed.provider == "teamtailor":
            return fetch_teamtailor_jobs(
                feed,
                timeout_seconds=self.request_timeout_seconds,
                max_rows=max_rows,
                max_http=max_http,
            )
        if feed.provider == "smartrecruiters":
            return fetch_smartrecruiters_jobs(
                feed,
                timeout_seconds=self.request_timeout_seconds,
                max_rows=max_rows,
                max_http=max_http,
            )
        if feed.provider == "workday":
            return fetch_workday_jobs(
                feed,
                timeout_seconds=self.request_timeout_seconds,
                max_rows=max_rows,
                max_http=max_http,
            )
        if feed.provider == "jobs2web":
            return fetch_jobs2web_jobs(
                feed,
                timeout_seconds=self.request_timeout_seconds,
                max_rows=max_rows,
                max_http=max_http,
            )
        if feed.provider == "html_fallback":
            return fetch_html_fallback_jobs(
                feed,
                timeout_seconds=self.request_timeout_seconds,
                max_rows=max_rows,
                max_http=max_http,
            )
        raise RuntimeError(f"Unsupported feed provider: {feed.provider}")

    def run_company_feeds_once(
        self,
        *,
        max_rows: int,
        max_http: int,
        only_keys: list[str] | None = None,
        clear_auto_disable: bool = False,
    ) -> dict[str, Any]:
        feeds = load_company_feeds(self.company_feed_config_path)
        if not feeds:
            return {
                "enabled": bool(self.enable_company_feeds),
                "processed_rows": 0,
                "target_rows": 0,
                "http_requests": 0,
                "feeds_run": 0,
                "notes": ["No verified company feeds configured."],
                "feed_results": [],
            }

        selected_keys = {key.strip().lower() for key in (only_keys or []) if key.strip()}
        if selected_keys:
            feeds = [feed for feed in feeds if feed.feed_key in selected_keys]

        feed_state_keys: list[str] = []
        for feed in feeds:
            feed_state_keys.extend(
                [
                    self._feed_state_key(feed.feed_key, "consecutive_miss_count"),
                    self._feed_state_key(feed.feed_key, "auto_disabled"),
                    self._feed_state_key(feed.feed_key, "last_success_at"),
                    self._feed_state_key(feed.feed_key, "last_http_status"),
                ]
            )
        state = self.storage.get_ingestion_state(feed_state_keys)

        if clear_auto_disable and feeds:
            now = datetime.now(UTC).isoformat()
            reset_updates: dict[str, str] = {}
            for feed in feeds:
                reset_updates[self._feed_state_key(feed.feed_key, "auto_disabled")] = "false"
                reset_updates[self._feed_state_key(feed.feed_key, "consecutive_miss_count")] = "0"
                reset_updates[self._feed_state_key(feed.feed_key, "last_success_at")] = now
            self.storage.upsert_ingestion_state(reset_updates)
            state.update(reset_updates)

        remaining_rows = max(0, int(max_rows))
        remaining_http = max(0, int(max_http))
        processed_rows = 0
        target_rows = 0
        http_requests = 0
        feed_results: list[dict[str, Any]] = []

        for feed in feeds:
            if remaining_rows <= 0 or remaining_http <= 0:
                break
            if not feed.enabled:
                continue
            if not feed.location_filters:
                feed_results.append(
                    {
                        "feed_key": feed.feed_key,
                        "provider": feed.provider,
                        "status": "skipped_missing_location_filters",
                    }
                )
                continue

            auto_disabled_key = self._feed_state_key(feed.feed_key, "auto_disabled")
            if str(state.get(auto_disabled_key, "false")).strip().lower() == "true":
                feed_results.append(
                    {
                        "feed_key": feed.feed_key,
                        "provider": feed.provider,
                        "status": "skipped_auto_disabled",
                    }
                )
                continue

            fetch_result = self._fetch_company_feed(feed, max_rows=remaining_rows, max_http=remaining_http)
            http_requests += int(fetch_result.http_requests)
            remaining_http -= int(fetch_result.http_requests)

            updates: dict[str, str] = {
                self._feed_state_key(feed.feed_key, "last_http_status"): str(fetch_result.http_status or "none"),
            }

            prepared_jobs, prepared_tags, prepared_target_count = self._prepare_records(fetch_result.rows)
            persisted_rows = 0
            persisted_target_count = 0
            persist_error: str | None = None
            if prepared_jobs:
                try:
                    existing = self.storage.fetch_existing_jobs([int(job["id"]) for job in prepared_jobs])
                    events = self._build_events(jobs=prepared_jobs, existing=existing)
                    self.storage.persist_batch(jobs=prepared_jobs, tags_by_job_id=prepared_tags, events=events)
                    persisted_rows = len(prepared_jobs)
                    persisted_target_count = prepared_target_count
                except Exception as exc:  # noqa: BLE001
                    persist_error = str(exc)
                    logger.warning("Company feed persist failed for %s: %s", feed.feed_key, exc)

            processed_rows += persisted_rows
            target_rows += persisted_target_count
            remaining_rows -= persisted_rows

            miss_key = self._feed_state_key(feed.feed_key, "consecutive_miss_count")
            auto_key = self._feed_state_key(feed.feed_key, "auto_disabled")
            if persisted_target_count > 0:
                updates[miss_key] = "0"
                updates[auto_key] = "false"
                updates[self._feed_state_key(feed.feed_key, "last_success_at")] = datetime.now(UTC).isoformat()
            else:
                previous_miss = int(str(state.get(miss_key, "0")) or "0")
                next_miss = previous_miss + 1
                updates[miss_key] = str(next_miss)
                if next_miss >= self.feed_consecutive_miss_threshold:
                    updates[auto_key] = "true"

            self.storage.upsert_ingestion_state(updates)
            state.update(updates)

            status = "ok"
            if persist_error:
                status = "persist_error"
            elif fetch_result.error:
                status = "error"
            elif fetch_result.http_status and fetch_result.http_status >= 400:
                status = "http_error"

            feed_results.append(
                {
                    "feed_key": feed.feed_key,
                    "provider": feed.provider,
                    "status": status,
                    "fetched_rows": len(fetch_result.rows),
                    "persisted_rows": persisted_rows,
                    "target_rows": persisted_target_count,
                    "http_status": fetch_result.http_status,
                    "error": persist_error or fetch_result.error,
                }
            )

        return {
            "enabled": bool(self.enable_company_feeds),
            "processed_rows": processed_rows,
            "target_rows": target_rows,
            "http_requests": http_requests,
            "feeds_run": len(feed_results),
            "feed_results": feed_results,
        }

    def verify_company_sources(
        self,
        *,
        company_names: list[str],
        max_rows: int = 20,
        max_http_per_provider: int = 2,
        registry_path: str = "pipeline/config/company_registry.json",
    ) -> dict[str, Any]:
        registry_entries = company_registry_map(registry_path)
        requested = [name.strip().lower() for name in company_names if name.strip()]
        entries = [registry_entries[name] for name in requested if name in registry_entries]

        provider_keywords = (
            "engineer",
            "developer",
            "software",
            "backend",
            "frontend",
            "mobile",
            "platform",
            "java",
            "python",
            "kotlin",
            "react",
            "fullstack",
        )

        report_rows: list[dict[str, Any]] = []
        for entry in entries:
            attempts: list[dict[str, Any]] = []
            recommended_status = entry.status
            recommended_provider: str | None = entry.provider
            recommended_identifier: str | None = entry.provider_identifier
            structured_connected = False

            def classify_attempt_status(
                *,
                provider: str,
                fetch_result: FeedFetchResult | None = None,
                prepared_target_count: int = 0,
                discovery: dict[str, Any] | None = None,
                fallback_status: str | None = None,
            ) -> str:
                if prepared_target_count > 0:
                    return "connected_candidate"
                if fetch_result and fetch_result.provider_status:
                    return fetch_result.provider_status
                discovery_status = str(discovery.get("status") or "").strip().lower() if discovery else ""
                http_status = int(fetch_result.http_status or 0) if fetch_result and fetch_result.http_status else 0
                rows_before_filters = int(fetch_result.provider_rows_before_filters or 0) if fetch_result else 0

                if discovery_status == "environment_dns_failure":
                    return "environment_dns_failure"
                if discovery_status == "blocked" or http_status in {401, 403}:
                    return "blocked_by_bot_protection"
                if discovery_status == "not_found" and provider == "workday":
                    return "requires_custom_adapter"
                if http_status == 404:
                    return "wrong_provider_or_slug"
                if rows_before_filters > 0 or (fetch_result and len(fetch_result.rows) > 0):
                    return "provider_present_but_zero_matching_rows"
                if provider == "html_fallback":
                    return "html_fallback_candidate"
                return fallback_status or "wrong_provider_or_slug"

            for provider in entry.provider_order:
                if provider == "html_fallback":
                    if structured_connected or entry.priority_tier != "A":
                        continue
                    identifier = entry.career_page_url
                elif entry.provider == provider and entry.provider_identifier:
                    identifier = entry.provider_identifier
                elif provider in {"lever", "greenhouse", "smartrecruiters"}:
                    identifier = entry.company_canonical.replace(" ", "")
                elif provider == "jobs2web":
                    identifier = entry.provider_identifier or entry.career_page_url
                elif provider == "teamtailor":
                    identifier = (
                        entry.provider_identifier
                        or entry.career_page_url
                        or entry.company_canonical.replace(" ", "")
                    )
                elif provider == "workday":
                    identifier = entry.provider_identifier or entry.career_page_url
                else:
                    identifier = None

                if not identifier:
                    attempts.append(
                        {
                            "provider": provider,
                            "identifier": None,
                            "http_status": None,
                            "endpoint_url": None,
                            "rows_fetched": 0,
                            "target_rows": 0,
                            "location_filtering_supported": False,
                            "field_completeness": 0.0,
                            "status": "skipped_missing_identifier",
                        }
                    )
                    continue

                discovery: dict[str, Any] | None = None
                if provider == "workday" and not entry.provider_identifier:
                    discovery = discover_workday_endpoint(
                        identifier,
                        timeout_seconds=self.request_timeout_seconds,
                    )
                    endpoint_url = str(discovery.get("endpoint_url") or "").strip()
                    if not endpoint_url:
                        attempts.append(
                            {
                                "provider": provider,
                                "identifier": identifier,
                                "http_status": discovery.get("http_status"),
                                "endpoint_url": None,
                                "rows_fetched": 0,
                                "target_rows": 0,
                                "location_filtering_supported": False,
                                "field_completeness": 0.0,
                                "status": classify_attempt_status(
                                    provider=provider,
                                    discovery=discovery,
                                ),
                                "error": f"discovery_{discovery.get('status') or 'unknown'}",
                            }
                        )
                        continue
                    identifier = endpoint_url

                feed = CompanyFeed(
                    feed_key=f"verify_{entry.company_canonical}_{provider}",
                    provider=provider,
                    slug_or_url=identifier,
                    company_canonical=entry.company_canonical,
                    display_name=entry.display_name,
                    enabled=True,
                    priority=0,
                    location_filters=tuple(item.title() for item in entry.markets if item),
                    keywords_any=provider_keywords,
                )

                fetch_result = self._fetch_company_feed(feed, max_rows=max_rows, max_http=max_http_per_provider)
                _, _, prepared_target_count = self._prepare_records(fetch_result.rows)

                completeness_count = 0
                if fetch_result.rows:
                    sample = fetch_result.rows[0]
                    completeness_count = sum(
                        1
                        for field in ("id", "headline", "description", "source_url", "publication_date")
                        if sample.get(field)
                    )
                field_completeness = round(completeness_count / 5, 2)

                attempt = {
                    "provider": provider,
                    "identifier": identifier,
                    "http_status": fetch_result.http_status,
                    "endpoint_url": fetch_result.endpoint_url,
                    "rows_fetched": len(fetch_result.rows),
                    "rows_before_filters": fetch_result.provider_rows_before_filters,
                    "target_rows": prepared_target_count,
                    "location_filtering_supported": fetch_result.location_filtering_supported,
                    "field_completeness": field_completeness,
                    "status": classify_attempt_status(
                        provider=provider,
                        fetch_result=fetch_result,
                        prepared_target_count=prepared_target_count,
                        discovery=discovery,
                        fallback_status="provider_present_but_zero_matching_rows" if fetch_result.error is None else None,
                    ),
                    "error": fetch_result.error,
                }
                if discovery is not None:
                    attempt["discovery_status"] = discovery.get("status")
                    attempt["career_page_url"] = discovery.get("career_page_url")
                    candidates = discovery.get("candidates")
                    if candidates:
                        attempt["discovery_candidates"] = candidates
                attempts.append(attempt)

                if prepared_target_count > 0:
                    recommended_status = "connected"
                    recommended_provider = provider
                    recommended_identifier = identifier
                    if provider != "html_fallback":
                        structured_connected = True
                    break

            if recommended_status != "connected":
                attempt_statuses = {str(attempt.get("status") or "") for attempt in attempts}
                if "environment_dns_failure" in attempt_statuses:
                    recommended_status = entry.status or "planned"
                elif "provider_present_but_zero_matching_rows" in attempt_statuses:
                    recommended_status = "planned"
                elif (
                    entry.priority_tier == "A"
                    and {"blocked_by_bot_protection", "requires_custom_adapter", "html_fallback_candidate"}
                    & attempt_statuses
                ):
                    recommended_status = "html_fallback_candidate"
                elif entry.priority_tier == "A":
                    recommended_status = "planned"
                else:
                    recommended_status = "blocked"

            report_rows.append(
                {
                    "company_canonical": entry.company_canonical,
                    "display_name": entry.display_name,
                    "priority_tier": entry.priority_tier,
                    "current_status": entry.status,
                    "recommended_status": recommended_status,
                    "recommended_provider": recommended_provider,
                    "recommended_identifier": recommended_identifier,
                    "attempts": attempts,
                }
            )

        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "companies": report_rows,
        }

    def run_smoke(self, *, limit: int = 1) -> int:
        try:
            rows = list(self.client.iter_snapshot(limit=limit))
        except Exception as exc:  # noqa: BLE001
            # Snapshot can timeout due to payload size; stream fallback keeps smoke checks reliable.
            logger.warning("Snapshot smoke failed, falling back to stream smoke: %s", exc)
            rows, _ = self.client.get_stream_events(since=None, limit=limit)
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

    @staticmethod
    def _parse_state_datetime(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)

    def maybe_refresh_digest(self) -> bool:
        now = datetime.now(UTC)
        state = self.storage.get_ingestion_state(["last_digest_generated_at"])
        last_generated_at = self._parse_state_datetime(state.get("last_digest_generated_at"))

        if last_generated_at is not None:
            age = now - last_generated_at
            if age < timedelta(minutes=self.digest_refresh_minutes):
                return False

        window_days = int(self.digest_window_days)
        window_type = f"rolling_{window_days}d"
        period_end = now
        period_start = period_end - timedelta(days=window_days)

        try:
            generate_weekly_digest(
                self.storage,
                period_start=period_start,
                period_end=period_end,
                target_only=True,
                window_type=window_type,
                window_days=window_days,
            )
            self.storage.upsert_ingestion_state({"last_digest_generated_at": now.isoformat()})
            logger.info("Digest refresh complete. window_type=%s window_days=%s", window_type, window_days)
            return True
        except Exception as exc:  # noqa: BLE001
            # Digest should never impact ingestion reliability.
            logger.exception("Digest refresh failed: %s", exc)
            return False

    def run_poll_forever(self) -> None:
        # Startup refresh to avoid stale digest after worker restart/no-event periods.
        try:
            self.maybe_refresh_digest()
        except Exception as exc:  # noqa: BLE001
            logger.exception("Startup digest refresh unexpectedly failed: %s", exc)
        try:
            self.maybe_run_compaction()
        except Exception as exc:  # noqa: BLE001
            logger.exception("Startup compaction unexpectedly failed: %s", exc)

        while True:
            started_at = time.monotonic()
            try:
                stream_rows = self.run_stream_once(limit=self.batch_size)
                self._poll_counter += 1

                if self.enable_company_feeds and (self._poll_counter % self.feed_interval_polls == 0):
                    leftover_row_budget = max(0, self.batch_size - int(stream_rows))
                    company_rows_budget = min(leftover_row_budget, self.feed_row_budget)
                    if company_rows_budget > 0:
                        feed_report = self.run_company_feeds_once(
                            max_rows=company_rows_budget,
                            max_http=self.feed_http_budget,
                        )
                        logger.info(
                            "Company feed sync complete. processed_rows=%s target_rows=%s http_requests=%s",
                            feed_report.get("processed_rows", 0),
                            feed_report.get("target_rows", 0),
                            feed_report.get("http_requests", 0),
                        )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Stream poll failed: %s", exc)
            else:
                # Refresh digest only after successful stream persistence.
                # This runs even for zero-row polls so digest freshness is maintained
                # during quiet periods when no new events arrive.
                try:
                    self.maybe_refresh_digest()
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Post-poll digest refresh unexpectedly failed: %s", exc)
                try:
                    self.maybe_run_compaction()
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Post-poll compaction unexpectedly failed: %s", exc)

            elapsed = time.monotonic() - started_at
            sleep_seconds = max(0, self.poll_seconds - int(elapsed))
            time.sleep(sleep_seconds)

    def dump_state(self) -> str:
        state = self.storage.get_ingestion_state()
        return json.dumps(state, indent=2)
