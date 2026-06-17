from __future__ import annotations

import json
import logging
import re
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .classify import classify_job
from .jobtech import JobTechClient
from .normalize import normalize_job
from .company_registry import CompanyRegistryEntry, company_registry_map, load_company_registry
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


_DEDUP_STOPWORDS = {
    "a",
    "an",
    "and",
    "at",
    "for",
    "in",
    "of",
    "on",
    "the",
    "to",
    "with",
    "junior",
    "senior",
    "mid",
    "level",
    "stockholm",
    "sweden",
}


def _normalize_match_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9åäö]+", " ", value.lower())).strip()


def _headline_tokens(headline: str) -> set[str]:
    normalized = _normalize_match_text(headline)
    if not normalized:
        return set()
    return {token for token in normalized.split() if len(token) > 2 and token not in _DEDUP_STOPWORDS}


def _jaccard_similarity(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    overlap = len(left & right)
    union = len(left | right)
    if union == 0:
        return 0.0
    return overlap / union


_SENIOR_STAGES = {"senior", "lead", "staff", "principal"}
_GRAD_STAGES = {"graduate", "trainee", "junior"}
_SENIOR_TITLE_RE = re.compile(
    r"\b(senior|lead|principal|staff|architect|manager|head of|director|vp|vice president|experienced|expert|seasoned|erfaren|erfarenhet|flerårig|flerarig|gedigen erfarenhet)\b",
    re.IGNORECASE,
)


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _parse_iso_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text[:10]).date()
    except ValueError:
        return None


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
        timezone: str,
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
        enable_translation: bool,
        max_active_jobs: int = 15000,
        jobtech_topup_no_deadline_ttl_days: int = 30,
        libretranslate_url: str | None = None,
        translation_provider: str = "google_cloud",
        translation_api_key: str = "",
        translation_api_url: str | None = None,
        translation_interval_polls: int = 10,
        translation_batch_size: int = 20,
        translation_max_chars: int = 4000,
        translation_timeout_seconds: int = 20,
    ) -> None:
        self.client = client
        self.storage = storage
        self.profile = profile
        self.batch_size = batch_size
        self.poll_seconds = poll_seconds
        self.digest_window_days = digest_window_days
        self.digest_refresh_minutes = digest_refresh_minutes
        self.local_timezone = ZoneInfo(timezone)
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
        self.max_active_jobs = max(1, int(max_active_jobs))
        self.jobtech_topup_no_deadline_ttl_days = max(1, int(jobtech_topup_no_deadline_ttl_days))
        self.enable_translation = bool(enable_translation)
        self.translation_provider = str(translation_provider or "google_cloud").strip().lower()
        self.translation_api_key = str(translation_api_key or "").strip()
        self.translation_api_url = str(
            translation_api_url
            or libretranslate_url
            or "https://translation.googleapis.com/language/translate/v2",
        ).strip()
        self.translation_interval_polls = max(1, int(translation_interval_polls))
        self.translation_batch_size = max(1, int(translation_batch_size))
        self.translation_max_chars = max(256, int(translation_max_chars))
        self.translation_timeout_seconds = max(5, int(translation_timeout_seconds))
        self._poll_counter = 0

    def maybe_translate_jobs(self) -> int:
        if not self.enable_translation:
            return 0
        if not self.translation_api_url:
            logger.warning("Translation enabled but TRANSLATION_API_URL is empty; skipping translation cycle.")
            return 0
        if self.translation_provider == "google_cloud" and not self.translation_api_key:
            logger.warning("Translation enabled but TRANSLATION_API_KEY is empty; skipping translation cycle.")
            return 0
        if self._poll_counter % self.translation_interval_polls != 0:
            return 0

        try:
            from .translate import batch_translate_jobs

            translated_rows = batch_translate_jobs(
                storage=self.storage,
                provider=self.translation_provider,
                api_url=self.translation_api_url,
                api_key=self.translation_api_key,
                batch_size=self.translation_batch_size,
                max_chars=self.translation_max_chars,
                timeout_seconds=self.translation_timeout_seconds,
            )
            if translated_rows > 0:
                logger.info("Translation cycle complete. translated_rows=%s", translated_rows)
            return translated_rows
        except Exception as exc:  # noqa: BLE001
            logger.exception("Translation cycle failed (non-fatal): %s", exc)
            return 0

    def _classify_and_prepare(self, raw: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        raw_for_normalize = dict(raw)
        is_reclassify_fallback = bool(raw_for_normalize.pop("__reclassify_fallback__", False))
        preserved_payload_hash = raw_for_normalize.pop("__payload_hash__", None)

        job_row, tags = normalize_job(raw_for_normalize)
        classification = classify_job(job_row, self.profile)
        job_row.update(
            {
                "payload_hash": preserved_payload_hash or payload_hash(job_row.get("raw_json") or {}),
                "role_family": classification.role_family,
                "role_family_confidence": classification.role_family_confidence,
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
        if is_reclassify_fallback:
            # Keep compacted rows compacted. We only need current normalized columns
            # for reclassification; do not repopulate raw_json blobs.
            job_row["raw_json"] = None
        if classification.role_family != "noise":
            tags = sorted(set(tags + [classification.role_family]))
        return job_row, tags

    @staticmethod
    def _build_reclassify_fallback_record(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "__reclassify_fallback__": True,
            "id": row.get("id"),
            "headline": row.get("headline"),
            "description": row.get("description"),
            "employer_name": row.get("employer_name"),
            "employer_id": row.get("employer_id"),
            "municipality": row.get("municipality"),
            "municipality_code": row.get("municipality_code"),
            "region": row.get("region"),
            "region_code": row.get("region_code"),
            "occupation_id": row.get("occupation_id"),
            "occupation_label": row.get("occupation_label"),
            "ssyk_code": row.get("ssyk_code"),
            "employment_type": row.get("employment_type"),
            "working_hours": row.get("working_hours"),
            "source_url": row.get("source_url"),
            "application_deadline": row.get("application_deadline"),
            "published_at": row.get("published_at"),
            "updated_at": row.get("updated_at"),
            "lang": row.get("lang"),
            "remote_flag": row.get("remote_flag"),
            "source_name": row.get("source_name"),
            "source_provider": row.get("source_provider"),
            "source_kind": row.get("source_kind"),
            "source_company_key": row.get("source_company_key"),
            "is_direct_company_source": row.get("is_direct_company_source"),
            "source_feed_key": row.get("source_feed_key"),
            "__payload_hash__": row.get("payload_hash"),
            "is_removed": not bool(row.get("is_active", True)),
        }

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
            current_hash = str(job.get("payload_hash") or payload_hash(job.get("raw_json") or {}))
            prev_hash = None
            if previous:
                prev_hash = previous.get("payload_hash")
                if not prev_hash and previous.get("raw_json"):
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

    def _build_removed_events_from_existing(
        self,
        *,
        rows: list[dict[str, Any]],
        event_time: str,
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for row in rows:
            job_id = row.get("id")
            if job_id is None:
                continue
            payload_hash_value = None
            if isinstance(row.get("raw_json"), dict):
                payload_hash_value = payload_hash(row["raw_json"])
            events.append(
                {
                    "job_id": int(job_id),
                    "event_type": "removed",
                    "event_time": event_time,
                    "payload_hash": payload_hash_value,
                }
            )
        return events

    @staticmethod
    def _company_feed_fetch_succeeded(fetch_result: FeedFetchResult, *, persist_error: str | None) -> bool:
        return (
            persist_error is None
            and not fetch_result.error
            and not (fetch_result.http_status and fetch_result.http_status >= 400)
        )

    @staticmethod
    def _can_reconcile_company_feed(
        fetch_result: FeedFetchResult,
        *,
        row_limit: int,
        persist_error: str | None,
    ) -> bool:
        if not IngestionPipeline._company_feed_fetch_succeeded(fetch_result, persist_error=persist_error):
            return False
        if row_limit <= 0:
            return False
        if fetch_result.matching_rows_before_limit is not None:
            return fetch_result.matching_rows_before_limit <= row_limit
        return len(fetch_result.rows) < row_limit

    def _reconcile_missing_company_feed_jobs(
        self,
        *,
        feed: CompanyFeed,
        current_jobs: list[dict[str, Any]],
        fetch_result: FeedFetchResult,
        row_limit: int,
        persist_error: str | None,
    ) -> tuple[int, str]:
        if not self._can_reconcile_company_feed(fetch_result, row_limit=row_limit, persist_error=persist_error):
            return 0, "skipped_row_cap_or_error"

        current_urls = {
            str(job.get("source_url") or "").strip()
            for job in current_jobs
            if str(job.get("source_url") or "").strip()
        }
        active_rows = self.storage.fetch_active_jobs_for_company_source(
            source_provider=feed.provider,
            source_company_key=feed.company_canonical,
        )
        stale_rows = [
            row
            for row in active_rows
            if str(row.get("source_url") or "").strip() not in current_urls
        ]
        if not stale_rows:
            return 0, "ok"

        removed_at = datetime.now(UTC).isoformat()
        stale_ids = [int(row["id"]) for row in stale_rows if row.get("id") is not None]
        if not stale_ids:
            return 0, "ok"

        self.storage.deactivate_jobs(stale_ids, removed_at=removed_at)
        self.storage.insert_job_events(self._build_removed_events_from_existing(rows=stale_rows, event_time=removed_at))
        return len(stale_ids), "ok"

    def _persist_records(
        self,
        *,
        records: list[dict[str, Any]],
        checkpoint_update: dict[str, str] | None,
        drop_irrelevant_jobtech: bool = False,
    ) -> int:
        jobs, tags_by_job_id, _ = self._prepare_records(records)
        if not jobs:
            return 0
        if drop_irrelevant_jobtech:
            jobs, tags_by_job_id = self._filter_persistable_jobtech_rows(jobs, tags_by_job_id)
            if not jobs:
                if checkpoint_update:
                    self.storage.upsert_ingestion_state(checkpoint_update)
                return 0

        existing = self.storage.fetch_existing_jobs([int(job["id"]) for job in jobs])
        events = self._build_events(jobs=jobs, existing=existing)

        self.storage.persist_batch(jobs=jobs, tags_by_job_id=tags_by_job_id, events=events)

        # Checkpoint is only advanced after successful data persistence.
        if checkpoint_update:
            self.storage.upsert_ingestion_state(checkpoint_update)

        return len(jobs)

    @staticmethod
    def _is_jobtech_row(job: dict[str, Any]) -> bool:
        return str(job.get("source_kind") or "").strip().lower() == "jobtech"

    @staticmethod
    def _has_senior_role_signal(job: dict[str, Any]) -> bool:
        headline = str(job.get("headline") or "")
        if _SENIOR_TITLE_RE.search(headline):
            return True
        stage = str(job.get("career_stage") or "").strip().lower()
        if stage in _SENIOR_STAGES:
            return True
        if _to_int(job.get("years_required_min"), -1) >= 3:
            return True
        reason_codes = job.get("reason_codes")
        if isinstance(reason_codes, list):
            reasons = {str(value).strip().lower() for value in reason_codes}
            return "career_stage_senior" in reasons or "years_required_3plus" in reasons
        return False

    @staticmethod
    def _has_market_restriction(job: dict[str, Any]) -> bool:
        return (
            bool(job.get("swedish_required"))
            or bool(job.get("citizenship_required"))
            or bool(job.get("security_clearance_required"))
        )

    @staticmethod
    def _has_explicit_early_career_signal(job: dict[str, Any]) -> bool:
        stage = str(job.get("career_stage") or "").strip().lower()
        years_required = job.get("years_required_min")
        return bool(job.get("is_grad_program")) or stage in _GRAD_STAGES or (
            years_required is not None and _to_int(years_required, 99) <= 2
        )

    def _jobtech_route_tier(self, job: dict[str, Any]) -> str | None:
        if not self._is_persistable_jobtech_row(job):
            return None
        return "graduate" if self._has_explicit_early_career_signal(job) else "broad"

    def _jobtech_rejection_reason(self, job: dict[str, Any]) -> str | None:
        if not self._is_jobtech_row(job):
            return None
        if bool(job.get("is_noise")):
            return "noise"
        if self._has_market_restriction(job):
            return "restricted"
        if self._has_senior_role_signal(job):
            return "senior"

        role_family = str(job.get("role_family") or "").strip().lower()
        if role_family in {"", "noise"}:
            return "non_software_role"
        if bool(job.get("is_target_role")):
            return None

        relevance_score = _to_int(job.get("relevance_score"), 0)
        if relevance_score >= 15 or bool(job.get("remote_flag")):
            return None

        profile_region_codes = {str(value).strip() for value in getattr(self.profile, "region_codes", set()) if str(value).strip()}
        profile_region_names = {
            str(value).strip().lower() for value in getattr(self.profile, "region_names", set()) if str(value).strip()
        }
        if profile_region_codes or profile_region_names:
            region_code = str(job.get("region_code") or "").strip()
            region_name = str(job.get("region") or "").strip().lower()
            if region_code in profile_region_codes or region_name in profile_region_names:
                return None
            return "outside_region"

        return "low_relevance"

    def _is_persistable_jobtech_row(self, job: dict[str, Any]) -> bool:
        if not self._is_jobtech_row(job):
            return True
        return self._jobtech_rejection_reason(job) is None

    def _jobtech_topup_age_rejection_reason(
        self,
        job: dict[str, Any],
        *,
        now: datetime,
        max_age_days: int,
    ) -> str | None:
        deadline_date = _parse_iso_date(job.get("application_deadline_date") or job.get("application_deadline"))
        if deadline_date is not None and deadline_date < now.astimezone(self.local_timezone).date():
            return "expired"

        published_date = _parse_iso_date(job.get("published_at"))
        if published_date is not None:
            cutoff = now.date() - timedelta(days=max(1, int(max_age_days)))
            if published_date < cutoff:
                return "stale"
        return None

    @staticmethod
    def _is_ats_duplicate(job: dict[str, Any], ats_rows: list[dict[str, Any]]) -> bool:
        company = _normalize_match_text(str(job.get("company_canonical") or job.get("employer_name") or ""))
        if not company:
            return False
        location = _normalize_match_text(" ".join([str(job.get("municipality") or ""), str(job.get("region") or "")]))
        headline_tokens = _headline_tokens(str(job.get("headline") or ""))
        if len(headline_tokens) < 2:
            return False

        for existing in ats_rows:
            existing_company = _normalize_match_text(
                str(existing.get("company_canonical") or existing.get("employer_name") or "")
            )
            if company != existing_company:
                continue

            existing_location = _normalize_match_text(
                " ".join([str(existing.get("municipality") or ""), str(existing.get("region") or "")])
            )
            if location and existing_location and location != existing_location:
                continue

            existing_tokens = _headline_tokens(str(existing.get("headline") or ""))
            if _jaccard_similarity(headline_tokens, existing_tokens) >= 0.75:
                return True

        return False

    def _filter_persistable_jobtech_rows(
        self,
        jobs: list[dict[str, Any]],
        tags_by_job_id: dict[int, list[str]],
    ) -> tuple[list[dict[str, Any]], dict[int, list[str]]]:
        filtered_jobs = [job for job in jobs if self._is_persistable_jobtech_row(job)]
        filtered_ids = {int(job["id"]) for job in filtered_jobs}
        dropped = len(jobs) - len(filtered_jobs)
        if dropped:
            logger.info("Dropped %s non-persistable JobTech rows before storage", dropped)
        return filtered_jobs, {job_id: tags for job_id, tags in tags_by_job_id.items() if job_id in filtered_ids}

    def over_storage_budget(self) -> bool:
        try:
            active_jobs = int(self.storage.count_active_jobs())
        except Exception as exc:  # noqa: BLE001
            logger.warning("Active-job budget check failed; continuing ingest. error=%s", exc)
            return False
        if active_jobs >= self.max_active_jobs:
            logger.warning("Active-job budget reached. active_jobs=%s max_active_jobs=%s", active_jobs, self.max_active_jobs)
            return True
        return False

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

        # Fallback dedup to avoid cross-provider duplicates when source URLs differ.
        # Collapse exact company+location+headline rows first, then near-duplicates by headline token overlap.
        semantic_deduped_rows: list[tuple[dict[str, Any], list[str]]] = []
        seen_signatures: dict[tuple[str, str], list[set[str]]] = {}
        seen_exact_signatures: set[tuple[str, str, str]] = set()
        for job_row, tags in deduped_rows:
            company_key = _normalize_match_text(
                str(job_row.get("company_canonical") or job_row.get("employer_name") or "")
            )
            location_key = _normalize_match_text(
                " ".join(
                    [
                        str(job_row.get("municipality") or ""),
                        str(job_row.get("region") or ""),
                    ]
                )
            )
            headline_key = _normalize_match_text(str(job_row.get("headline") or ""))
            headline_key_tokens = _headline_tokens(str(job_row.get("headline") or ""))

            if company_key and location_key and headline_key:
                exact_signature = (company_key, location_key, headline_key)
                if exact_signature in seen_exact_signatures:
                    continue
                seen_exact_signatures.add(exact_signature)

            if company_key and location_key and len(headline_key_tokens) >= 3:
                signature_key = (company_key, location_key)
                prior_tokens = seen_signatures.get(signature_key, [])
                is_duplicate = any(_jaccard_similarity(headline_key_tokens, existing) >= 0.75 for existing in prior_tokens)
                if is_duplicate:
                    continue
                seen_signatures.setdefault(signature_key, []).append(headline_key_tokens)

            semantic_deduped_rows.append((job_row, tags))

        existing_by_url = self.storage.fetch_jobs_by_source_urls(
            [str(job.get("source_url") or "").strip() for job, _ in semantic_deduped_rows]
        )

        jobs: list[dict[str, Any]] = []
        tags_by_job_id: dict[int, list[str]] = {}
        target_count = 0
        seen_job_ids: set[int] = set()
        for job_row, tags in semantic_deduped_rows:
            source_url = str(job_row.get("source_url") or "").strip()
            if source_url:
                existing = existing_by_url.get(source_url)
                if existing and existing.get("id") is not None:
                    job_row["id"] = int(existing["id"])

            job_id = int(job_row["id"])
            if job_id in seen_job_ids:
                logger.warning(
                    "Skipping duplicate normalized job id=%s source_url=%s",
                    job_id,
                    source_url or "none",
                )
                continue
            seen_job_ids.add(job_id)
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
        if self.over_storage_budget():
            logger.warning("Skipping JobTech snapshot because active-job budget is already reached")
            return 0

        processed = 0
        batch: list[dict[str, Any]] = []
        for row in self.client.iter_snapshot(limit=limit):
            batch.append(row)
            if len(batch) >= self.batch_size:
                processed += self._persist_records(
                    records=batch,
                    checkpoint_update=None,
                    drop_irrelevant_jobtech=True,
                )
                batch = []

        if batch:
            processed += self._persist_records(
                records=batch,
                checkpoint_update=None,
                drop_irrelevant_jobtech=True,
            )

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
        fallback_count = 0

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
                    fallback_count += 1
                    records.append(self._build_reclassify_fallback_record(row))
                    logger.debug("Reclassify fallback from normalized row id=%s (raw_json missing)", row.get("id"))

            if records:
                processed += self._persist_records(records=records, checkpoint_update=None)

            try:
                cursor = int(rows[-1]["id"])
            except (KeyError, TypeError, ValueError):
                break

        logger.info(
            "Reclassification complete. rows=%s fallback_rows=%s active_only=%s",
            processed,
            fallback_count,
            active_only,
        )
        return processed

    def run_stream_once(self, *, limit: int | None = None) -> int:
        if self.over_storage_budget():
            self.storage.upsert_ingestion_state({"last_poll_at": datetime.now(UTC).isoformat()})
            logger.warning("Skipping JobTech stream poll because active-job budget is already reached")
            return 0

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
            drop_irrelevant_jobtech=True,
        )
        logger.info("Stream poll processed rows=%s", processed)
        return processed

    def run_jobtech_topup(
        self,
        *,
        limit: int,
        apply: bool = False,
        since_days: int = 21,
        max_age_days: int = 21,
    ) -> dict[str, Any]:
        now = datetime.now(UTC)
        if self.over_storage_budget():
            return {
                "generated_at": now.isoformat(),
                "apply": bool(apply),
                "status": "skipped_active_job_budget",
                "fetched": 0,
                "would_persist": 0,
                "persisted": 0,
            }

        state = self.storage.get_ingestion_state(["last_jobtech_topup_timestamp"])
        since = state.get("last_jobtech_topup_timestamp")
        if not since:
            since = (now - timedelta(days=max(1, int(since_days)))).isoformat()

        events, next_cursor = self.client.get_stream_events(since=since, limit=max(1, int(limit)))
        jobs, tags_by_job_id, _target_count = self._prepare_records(events)

        rejection_counts: dict[str, int] = {}
        candidate_jobs: list[dict[str, Any]] = []
        for job in jobs:
            reason = self._jobtech_rejection_reason(job) or self._jobtech_topup_age_rejection_reason(
                job,
                now=now,
                max_age_days=max_age_days,
            )
            if reason:
                rejection_counts[reason] = rejection_counts.get(reason, 0) + 1
                continue
            candidate_jobs.append(job)

        companies = [
            str(job.get("company_canonical") or job.get("employer_name") or "").strip().lower()
            for job in candidate_jobs
            if self._is_jobtech_row(job)
        ]
        fetch_ats = getattr(self.storage, "fetch_active_ats_jobs_for_companies", None)
        ats_rows = fetch_ats(companies) if callable(fetch_ats) else []

        deduped_jobs: list[dict[str, Any]] = []
        duplicate_count = 0
        for job in candidate_jobs:
            if self._is_jobtech_row(job) and self._is_ats_duplicate(job, ats_rows):
                duplicate_count += 1
                continue
            deduped_jobs.append(job)

        deduped_ids = {int(job["id"]) for job in deduped_jobs}
        filtered_tags = {job_id: tags for job_id, tags in tags_by_job_id.items() if job_id in deduped_ids}
        tier_counts = {"graduate": 0, "broad": 0}
        for job in deduped_jobs:
            tier = self._jobtech_route_tier(job)
            if tier in tier_counts:
                tier_counts[tier] += 1

        report: dict[str, Any] = {
            "generated_at": now.isoformat(),
            "apply": bool(apply),
            "status": "dry_run",
            "cursor": {
                "state_key": "last_jobtech_topup_timestamp",
                "since": since,
                "next": next_cursor or now.isoformat(),
            },
            "limits": {
                "limit": max(1, int(limit)),
                "since_days": max(1, int(since_days)),
                "max_age_days": max(1, int(max_age_days)),
            },
            "fetched": len(events),
            "prepared": len(jobs),
            "rejected": sum(rejection_counts.values()),
            "rejection_counts": rejection_counts,
            "duplicates": duplicate_count,
            "would_persist": len(deduped_jobs),
            "persisted": 0,
            "tier_counts": tier_counts,
            "sample_rows": [
                {
                    "id": job.get("id"),
                    "headline": job.get("headline"),
                    "employer_name": job.get("employer_name"),
                    "career_stage": job.get("career_stage"),
                    "years_required_min": job.get("years_required_min"),
                    "relevance_score": job.get("relevance_score"),
                    "route_tier": self._jobtech_route_tier(job),
                    "source_url": job.get("source_url"),
                }
                for job in deduped_jobs[:10]
            ],
        }

        if not apply:
            return report

        if deduped_jobs:
            existing = self.storage.fetch_existing_jobs([int(job["id"]) for job in deduped_jobs])
            events_to_store = self._build_events(jobs=deduped_jobs, existing=existing)
            self.storage.persist_batch(jobs=deduped_jobs, tags_by_job_id=filtered_tags, events=events_to_store)

        cursor_value = next_cursor or now.isoformat()
        self.storage.upsert_ingestion_state(
            {
                "last_jobtech_topup_timestamp": cursor_value,
                "last_jobtech_topup_at": now.isoformat(),
                "last_poll_at": now.isoformat(),
            }
        )
        report["status"] = "applied"
        report["persisted"] = len(deduped_jobs)
        return report

    def compact_storage(
        self,
        *,
        confirm: bool = False,
        batch_size: int = 500,
        max_batches_per_phase: int = 5,
    ) -> dict[str, Any]:
        now = datetime.now(UTC)
        raw_json_cutoff = (now - timedelta(days=self.compaction_raw_json_days)).isoformat()
        inactive_job_cutoff = (now - timedelta(days=self.compaction_inactive_job_days)).isoformat()
        job_event_cutoff = (now - timedelta(days=self.compaction_job_event_days)).isoformat()
        weekly_digest_cutoff = (now - timedelta(days=self.compaction_weekly_digest_days)).isoformat()

        batch_size = max(1, int(batch_size))
        max_batches_per_phase = max(1, int(max_batches_per_phase))

        report: dict[str, Any] = {
            "generated_at": now.isoformat(),
            "confirm": bool(confirm),
            "batch_size": batch_size,
            "max_batches_per_phase": max_batches_per_phase,
            "cutoffs": {
                "raw_json_before": raw_json_cutoff,
                "inactive_jobs_before": inactive_job_cutoff,
                "job_events_before": job_event_cutoff,
                "weekly_digests_before": weekly_digest_cutoff,
                "jobtech_no_deadline_before": (now - timedelta(days=self.jobtech_topup_no_deadline_ttl_days)).isoformat(),
            },
        }

        if not confirm:
            report["counts"] = {
                "raw_json_rows_older_than_cutoff": self.storage.count_jobs_with_raw_json_before(raw_json_cutoff),
                "inactive_jobs_older_than_cutoff": self.storage.count_inactive_jobs_before(inactive_job_cutoff),
                "job_events_older_than_cutoff": self.storage.count_job_events_before(job_event_cutoff),
                "weekly_digests_older_than_cutoff": self.storage.count_weekly_digests_before(weekly_digest_cutoff),
            }
            report["status"] = "dry_run"
            return report

        no_deadline_cutoff = report["cutoffs"]["jobtech_no_deadline_before"]
        summary = {
            "raw_json_cleared": 0,
            "jobtech_no_deadline_deactivated": 0,
            "inactive_jobs_deleted": 0,
            "inactive_jobs_referenced_preserved": 0,
            "job_events_deleted": 0,
            "weekly_digests_deleted": 0,
        }
        batches = {
            "raw_json": 0,
            "job_events": 0,
            "weekly_digests": 0,
            "jobtech_no_deadline": 0,
            "inactive_jobs": 0,
        }
        phases_at_limit: list[str] = []

        for _ in range(max_batches_per_phase):
            job_ids = self.storage.fetch_job_ids_with_raw_json_before(cutoff_iso=raw_json_cutoff, limit=batch_size)
            if not job_ids:
                break
            batches["raw_json"] += 1
            summary["raw_json_cleared"] += self.storage.clear_raw_json_for_job_ids(job_ids)
            if len(job_ids) < batch_size:
                break
        else:
            phases_at_limit.append("raw_json")

        for _ in range(max_batches_per_phase):
            event_ids = self.storage.fetch_job_event_ids_before(cutoff_iso=job_event_cutoff, limit=batch_size)
            if not event_ids:
                break
            batches["job_events"] += 1
            summary["job_events_deleted"] += self.storage.delete_job_events_by_ids(event_ids)
            if len(event_ids) < batch_size:
                break
        else:
            phases_at_limit.append("job_events")

        for _ in range(max_batches_per_phase):
            digest_ids = self.storage.fetch_weekly_digest_ids_before(cutoff_iso=weekly_digest_cutoff, limit=batch_size)
            if not digest_ids:
                break
            batches["weekly_digests"] += 1
            summary["weekly_digests_deleted"] += self.storage.delete_weekly_digests_by_ids(digest_ids)
            if len(digest_ids) < batch_size:
                break
        else:
            phases_at_limit.append("weekly_digests")

        for _ in range(max_batches_per_phase):
            rows = self.storage.fetch_active_jobtech_no_deadline_before(
                published_before=no_deadline_cutoff,
                limit=batch_size,
            )
            if not rows:
                break
            job_ids = [int(row["id"]) for row in rows if row.get("id") is not None]
            if not job_ids:
                break
            batches["jobtech_no_deadline"] += 1
            removed_at = datetime.now(UTC).isoformat()
            summary["jobtech_no_deadline_deactivated"] += self.storage.deactivate_jobs(job_ids, removed_at=removed_at)
            self.storage.insert_job_events(self._build_removed_events_from_existing(rows=rows, event_time=removed_at))
            if len(job_ids) < batch_size:
                break
        else:
            phases_at_limit.append("jobtech_no_deadline")

        inactive_cursor = 0
        for _ in range(max_batches_per_phase):
            job_ids = self.storage.fetch_inactive_job_ids_before_with_cursor(
                cutoff_iso=inactive_job_cutoff,
                after_id=inactive_cursor,
                limit=batch_size,
            )
            if not job_ids:
                break

            batches["inactive_jobs"] += 1
            inactive_cursor = max(job_ids)
            referenced = self.storage.fetch_referenced_job_ids(job_ids)
            deletable = [job_id for job_id in job_ids if job_id not in referenced]
            summary["inactive_jobs_referenced_preserved"] += len(job_ids) - len(deletable)

            if deletable:
                summary["inactive_jobs_deleted"] += self.storage.delete_jobs_by_ids(deletable)
            if len(job_ids) < batch_size:
                break
        else:
            phases_at_limit.append("inactive_jobs")

        finished_at = datetime.now(UTC).isoformat()
        self.storage.upsert_ingestion_state({"last_compaction_at": finished_at})
        report["status"] = "applied_partial" if phases_at_limit else "applied"
        report["summary"] = summary
        report["batches"] = batches
        report["phases_at_limit"] = phases_at_limit
        return report

    def maybe_run_compaction(self) -> bool:
        state = self.storage.get_ingestion_state(["last_compaction_at"])
        last_compaction = self._parse_state_datetime(state.get("last_compaction_at"))
        if last_compaction is not None:
            age = datetime.now(UTC) - last_compaction
            if age < timedelta(hours=self.compaction_interval_hours):
                return False

        # The worker runs this once daily. A five-batch ceiling can leave a
        # large event backlog growing faster than it drains, so allow a larger
        # still-bounded worker drain while keeping the manual CLI conservative.
        report = self.compact_storage(confirm=True, max_batches_per_phase=50)
        logger.info(
            "Storage compaction complete. raw_json_cleared=%s jobtech_no_deadline_deactivated=%s inactive_jobs_deleted=%s inactive_jobs_referenced_preserved=%s job_events_deleted=%s weekly_digests_deleted=%s",
            report.get("summary", {}).get("raw_json_cleared", 0),
            report.get("summary", {}).get("jobtech_no_deadline_deactivated", 0),
            report.get("summary", {}).get("inactive_jobs_deleted", 0),
            report.get("summary", {}).get("inactive_jobs_referenced_preserved", 0),
            report.get("summary", {}).get("job_events_deleted", 0),
            report.get("summary", {}).get("weekly_digests_deleted", 0),
        )
        return True

    def expire_jobs_past_deadline(
        self,
        *,
        today_local: date | None = None,
        batch_size: int = 500,
        max_batches: int = 10,
    ) -> dict[str, Any]:
        local_day = today_local or datetime.now(self.local_timezone).date()
        deadline_before = local_day.isoformat()
        generated_at = datetime.now(UTC).isoformat()
        expired_rows = 0
        batches = 0
        last_batch_size = 0
        batch_size = max(1, int(batch_size))
        max_batches = max(1, int(max_batches))

        for _ in range(max_batches):
            rows = self.storage.fetch_active_jobs_past_deadline(deadline_before=deadline_before, limit=batch_size)
            if not rows:
                break

            expired_ids = [int(row["id"]) for row in rows if row.get("id") is not None]
            if not expired_ids:
                break

            batches += 1
            last_batch_size = len(expired_ids)
            removed_at = datetime.now(UTC).isoformat()
            self.storage.deactivate_jobs(expired_ids, removed_at=removed_at)
            self.storage.insert_job_events(self._build_removed_events_from_existing(rows=rows, event_time=removed_at))
            expired_rows += len(expired_ids)

            if len(expired_ids) < batch_size:
                break
        limit_reached = batches >= max_batches and last_batch_size >= batch_size

        report = {
            "generated_at": generated_at,
            "deadline_before": deadline_before,
            "expired_rows": expired_rows,
            "batches": batches,
            "limit_reached": limit_reached,
            "status": "partial" if limit_reached else "ok",
        }
        self.storage.upsert_ingestion_state(
            {
                "last_deadline_expiration_at": datetime.now(UTC).isoformat(),
                "last_deadline_expiration_date": deadline_before,
            }
        )
        return report

    def maybe_expire_jobs_past_deadline(
        self,
        *,
        today_local: date | None = None,
        batch_size: int = 500,
        max_batches: int = 10,
    ) -> dict[str, Any]:
        local_day = today_local or datetime.now(self.local_timezone).date()
        deadline_before = local_day.isoformat()
        state = self.storage.get_ingestion_state(["last_deadline_expiration_date"])
        if state.get("last_deadline_expiration_date") == deadline_before:
            return {
                "generated_at": datetime.now(UTC).isoformat(),
                "deadline_before": deadline_before,
                "expired_rows": 0,
                "batches": 0,
                "limit_reached": False,
                "status": "skipped_already_ran_today",
            }
        return self.expire_jobs_past_deadline(
            today_local=local_day,
            batch_size=batch_size,
            max_batches=max_batches,
        )

    @staticmethod
    def _feed_state_key(feed_key: str, suffix: str) -> str:
        return f"feed:{feed_key}:{suffix}"

    @staticmethod
    def _company_state_key(company_canonical: str, suffix: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "_", str(company_canonical).lower()).strip("_")
        return f"company:{normalized}:{suffix}"

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

    @staticmethod
    def _with_feed_metadata(feed: CompanyFeed, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        enriched: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row)
            payload.setdefault("source_name", feed.provider)
            payload.setdefault("source_provider", feed.provider)
            payload.setdefault("source_kind", "direct_company_ats")
            payload.setdefault("source_company_key", feed.company_canonical)
            payload.setdefault("source_feed_key", feed.feed_key)
            payload.setdefault("is_direct_company_source", True)
            enriched.append(payload)
        return enriched

    def run_company_feeds_once(
        self,
        *,
        max_rows: int,
        max_http: int,
        only_keys: list[str] | None = None,
        clear_auto_disable: bool = False,
        start_after_key: str | None = None,
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
        elif start_after_key:
            normalized_cursor = str(start_after_key).strip().lower()
            cursor_index = next(
                (index for index, feed in enumerate(feeds) if feed.feed_key == normalized_cursor),
                None,
            )
            if cursor_index is not None:
                feeds = feeds[cursor_index + 1 :] + feeds[: cursor_index + 1]

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
        probe_rows: list[dict[str, Any]] = []

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

            row_limit_for_feed = remaining_rows
            fetch_result = self._fetch_company_feed(feed, max_rows=row_limit_for_feed, max_http=remaining_http)
            http_requests += int(fetch_result.http_requests)
            remaining_http -= int(fetch_result.http_requests)

            updates: dict[str, str] = {
                self._feed_state_key(feed.feed_key, "last_http_status"): str(fetch_result.http_status or "none"),
            }

            enriched_rows = self._with_feed_metadata(feed, fetch_result.rows)
            prepared_jobs, prepared_tags, prepared_target_count = self._prepare_records(enriched_rows)
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

            removed_rows = 0
            reconciliation_status = "not_run"
            try:
                removed_rows, reconciliation_status = self._reconcile_missing_company_feed_jobs(
                    feed=feed,
                    current_jobs=prepared_jobs,
                    fetch_result=fetch_result,
                    row_limit=row_limit_for_feed,
                    persist_error=persist_error,
                )
            except Exception as exc:  # noqa: BLE001
                reconciliation_status = "error"
                logger.warning("Company feed reconciliation failed for %s: %s", feed.feed_key, exc)

            processed_rows += persisted_rows
            target_rows += persisted_target_count
            remaining_rows -= persisted_rows

            miss_key = self._feed_state_key(feed.feed_key, "consecutive_miss_count")
            auto_key = self._feed_state_key(feed.feed_key, "auto_disabled")
            if self._company_feed_fetch_succeeded(fetch_result, persist_error=persist_error):
                now_iso = datetime.now(UTC).isoformat()
                updates[miss_key] = "0"
                updates[auto_key] = "false"
                updates[self._feed_state_key(feed.feed_key, "last_success_at")] = now_iso
                updates[self._feed_state_key(feed.feed_key, "last_seen_at")] = now_iso
                updates[self._company_state_key(feed.company_canonical, "last_seen_at")] = now_iso
                updates[self._company_state_key(feed.company_canonical, "last_rows_seen")] = str(persisted_rows)
                updates[self._company_state_key(feed.company_canonical, "last_status")] = "ok"
            else:
                previous_miss = int(str(state.get(miss_key, "0")) or "0")
                next_miss = previous_miss + 1
                updates[miss_key] = str(next_miss)
                if next_miss >= self.feed_consecutive_miss_threshold:
                    updates[auto_key] = "true"
                updates[self._company_state_key(feed.company_canonical, "last_status")] = "error"

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
                    "removed_rows": removed_rows,
                    "reconciliation_status": reconciliation_status,
                    "http_status": fetch_result.http_status,
                    "error": persist_error or fetch_result.error,
                }
            )

            probe_rows.append(
                {
                    "feed_key": feed.feed_key,
                    "provider": feed.provider,
                    "run_at": datetime.now(UTC).isoformat(),
                    "http_status": fetch_result.http_status,
                    "http_requests": int(fetch_result.http_requests),
                    "fetched_rows": len(fetch_result.rows),
                    "persisted_rows": persisted_rows,
                    "target_rows": persisted_target_count,
                    "removed_rows": removed_rows,
                    "location_filtering_supported": bool(fetch_result.location_filtering_supported),
                    "error_text": persist_error or fetch_result.error,
                }
            )

        if probe_rows:
            try:
                self.storage.insert_source_feed_probe_runs(probe_rows)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to persist source_feed_probe_runs: %s", exc)

        return {
            "enabled": bool(self.enable_company_feeds),
            "processed_rows": processed_rows,
            "target_rows": target_rows,
            "http_requests": http_requests,
            "feeds_run": len(feed_results),
            "feed_results": feed_results,
        }

    def run_company_feed_cycle(self) -> dict[str, Any]:
        cursor_key = "last_company_feed_cursor"
        state = self.storage.get_ingestion_state([cursor_key])
        report = self.run_company_feeds_once(
            max_rows=self.feed_row_budget,
            max_http=self.feed_http_budget,
            start_after_key=state.get(cursor_key),
        )
        feed_results = report.get("feed_results") or []
        if feed_results:
            last_feed_key = str(feed_results[-1].get("feed_key") or "").strip()
            if last_feed_key:
                self.storage.upsert_ingestion_state({cursor_key: last_feed_key})
                report["last_company_feed_cursor"] = last_feed_key
        return report

    def verify_company_sources(
        self,
        *,
        company_names: list[str],
        max_rows: int = 20,
        max_http_per_provider: int = 2,
        registry_path: str = "pipeline/config/company_registry.json",
    ) -> dict[str, Any]:
        registry_entries = company_registry_map(registry_path)
        provider_fallback_order = ("lever", "greenhouse", "teamtailor", "smartrecruiters", "workday", "html_fallback")
        configured_feed_entries: dict[str, CompanyRegistryEntry] = {}
        for feed in load_company_feeds(self.company_feed_config_path):
            provider_order = tuple(dict.fromkeys((feed.provider, *provider_fallback_order)))
            entry = CompanyRegistryEntry(
                company_canonical=_normalize_match_text(feed.company_canonical),
                display_name=feed.display_name or feed.company_canonical,
                priority_tier="B",
                category="configured_feed",
                status="connected" if feed.enabled else "planned",
                provider=feed.provider,
                provider_identifier=feed.slug_or_url,
                provider_order=provider_order,
                markets=tuple(feed.location_filters),
                notes=f"Derived from configured feed {feed.feed_key}",
                aliases=(),
                career_page_url=feed.slug_or_url if feed.slug_or_url.startswith(("http://", "https://")) else None,
            )
            for key in (entry.company_canonical, _normalize_match_text(entry.display_name)):
                if key:
                    configured_feed_entries.setdefault(key, entry)

        requested = [_normalize_match_text(name) for name in company_names if name.strip()]
        entries: list[CompanyRegistryEntry] = []
        seen_companies: set[str] = set()
        for name in requested:
            entry = registry_entries.get(name) or configured_feed_entries.get(name)
            if entry is None or entry.company_canonical in seen_companies:
                continue
            seen_companies.add(entry.company_canonical)
            entries.append(entry)

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

    def run_poll_forever(self) -> None:
        try:
            report = self.maybe_expire_jobs_past_deadline()
            logger.info(
                "Deadline expiry check complete. status=%s expired_rows=%s deadline_before=%s",
                report.get("status"),
                report.get("expired_rows", 0),
                report.get("deadline_before"),
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Startup deadline expiry unexpectedly failed: %s", exc)
        try:
            self.maybe_run_compaction()
        except Exception as exc:  # noqa: BLE001
            logger.exception("Startup compaction unexpectedly failed: %s", exc)

        while True:
            started_at = time.monotonic()
            try:
                over_budget = self.over_storage_budget()
                if over_budget:
                    logger.warning("Skipping JobTech poll because active-job budget is already reached")
                else:
                    self.run_stream_once(limit=self.batch_size)
                self._poll_counter += 1

                if self.enable_company_feeds and not over_budget and (self._poll_counter % self.feed_interval_polls == 0):
                    feed_report = self.run_company_feed_cycle()
                    logger.info(
                        "Company feed sync complete. processed_rows=%s target_rows=%s http_requests=%s cursor=%s",
                        feed_report.get("processed_rows", 0),
                        feed_report.get("target_rows", 0),
                        feed_report.get("http_requests", 0),
                        feed_report.get("last_company_feed_cursor"),
                    )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Stream poll failed: %s", exc)
            else:
                try:
                    self.maybe_translate_jobs()
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Post-poll translation unexpectedly failed: %s", exc)
                try:
                    report = self.maybe_expire_jobs_past_deadline()
                    logger.info(
                        "Deadline expiry check complete. status=%s expired_rows=%s deadline_before=%s",
                        report.get("status"),
                        report.get("expired_rows", 0),
                        report.get("deadline_before"),
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Post-poll deadline expiry unexpectedly failed: %s", exc)
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
