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

    def count_jobs_with_raw_json_before(self, cutoff_iso: str) -> int:
        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id", count="exact")
            .not_.is_("raw_json", "null")
            .lt("published_at", cutoff_iso)
            .limit(1)
            .execute(),
            context="count jobs with raw_json before cutoff",
        )
        return int(response.count or 0)

    def count_inactive_jobs_before(self, cutoff_iso: str) -> int:
        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id", count="exact")
            .eq("is_active", False)
            .lt("published_at", cutoff_iso)
            .limit(1)
            .execute(),
            context="count inactive jobs before cutoff",
        )
        return int(response.count or 0)

    def count_active_jobs_past_deadline(self, deadline_before: str) -> int:
        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id", count="exact")
            .eq("is_active", True)
            .lt("application_deadline_date", deadline_before)
            .limit(1)
            .execute(),
            context="count active jobs past deadline",
        )
        return int(response.count or 0)

    def count_job_events_before(self, cutoff_iso: str) -> int:
        response = self._execute(
            lambda: self.client.table("job_events")
            .select("id", count="exact")
            .lt("event_time", cutoff_iso)
            .limit(1)
            .execute(),
            context="count job events before cutoff",
        )
        return int(response.count or 0)

    def count_weekly_digests_before(self, cutoff_iso: str) -> int:
        response = self._execute(
            lambda: self.client.table("weekly_digests")
            .select("id", count="exact")
            .lt("generated_at", cutoff_iso)
            .limit(1)
            .execute(),
            context="count digests before cutoff",
        )
        return int(response.count or 0)

    def upsert_ingestion_state(self, values: dict[str, str]) -> None:
        rows = [{"key": k, "value": v, "updated_at": datetime.now(UTC).isoformat()} for k, v in values.items()]
        self._execute(
            lambda: self.client.table("ingestion_state").upsert(rows, on_conflict="key").execute(),
            context="upsert ingestion_state",
        )

    def fetch_job_ids_with_raw_json_before(self, *, cutoff_iso: str, limit: int = 500) -> list[int]:
        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id")
            .not_.is_("raw_json", "null")
            .lt("published_at", cutoff_iso)
            .order("id")
            .limit(limit)
            .execute(),
            context="fetch job ids with raw_json before cutoff",
        )
        return [int(row["id"]) for row in (response.data or []) if row.get("id") is not None]

    def fetch_inactive_job_ids_before(self, *, cutoff_iso: str, limit: int = 500) -> list[int]:
        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id")
            .eq("is_active", False)
            .lt("published_at", cutoff_iso)
            .order("id")
            .limit(limit)
            .execute(),
            context="fetch inactive job ids before cutoff",
        )
        return [int(row["id"]) for row in (response.data or []) if row.get("id") is not None]

    def fetch_active_jobs_past_deadline(self, *, deadline_before: str, limit: int = 500) -> list[dict[str, Any]]:
        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id,raw_json,application_deadline_date")
            .eq("is_active", True)
            .lt("application_deadline_date", deadline_before)
            .order("id")
            .limit(limit)
            .execute(),
            context="fetch active jobs past deadline",
        )
        return response.data or []

    def fetch_job_event_ids_before(self, *, cutoff_iso: str, limit: int = 500) -> list[int]:
        response = self._execute(
            lambda: self.client.table("job_events")
            .select("id")
            .lt("event_time", cutoff_iso)
            .order("id")
            .limit(limit)
            .execute(),
            context="fetch job_event ids before cutoff",
        )
        return [int(row["id"]) for row in (response.data or []) if row.get("id") is not None]

    def fetch_weekly_digest_ids_before(self, *, cutoff_iso: str, limit: int = 500) -> list[int]:
        response = self._execute(
            lambda: self.client.table("weekly_digests")
            .select("id")
            .lt("generated_at", cutoff_iso)
            .order("id")
            .limit(limit)
            .execute(),
            context="fetch digest ids before cutoff",
        )
        return [int(row["id"]) for row in (response.data or []) if row.get("id") is not None]

    def clear_raw_json_for_job_ids(self, job_ids: list[int]) -> int:
        if not job_ids:
            return 0
        self._execute(
            lambda job_ids=job_ids: self.client.table("jobs")
            .update({"raw_json": None})
            .in_("id", job_ids)
            .execute(),
            context="clear raw_json for jobs",
        )
        return len(job_ids)

    def delete_jobs_by_ids(self, job_ids: list[int]) -> int:
        if not job_ids:
            return 0
        self._execute(
            lambda job_ids=job_ids: self.client.table("jobs").delete().in_("id", job_ids).execute(),
            context="delete jobs by ids",
        )
        return len(job_ids)

    def delete_job_events_by_ids(self, event_ids: list[int]) -> int:
        if not event_ids:
            return 0
        self._execute(
            lambda event_ids=event_ids: self.client.table("job_events").delete().in_("id", event_ids).execute(),
            context="delete job_events by ids",
        )
        return len(event_ids)

    def delete_weekly_digests_by_ids(self, digest_ids: list[int]) -> int:
        if not digest_ids:
            return 0
        self._execute(
            lambda digest_ids=digest_ids: self.client.table("weekly_digests").delete().in_("id", digest_ids).execute(),
            context="delete weekly_digests by ids",
        )
        return len(digest_ids)

    def fetch_existing_jobs(self, job_ids: list[int]) -> dict[int, dict[str, Any]]:
        if not job_ids:
            return {}

        response = self._execute(
            lambda: self.client.table("jobs").select("id,raw_json,is_active").in_("id", job_ids).execute(),
            context="select existing jobs",
        )
        return {int(row["id"]): row for row in (response.data or [])}

    def fetch_jobs_by_source_urls(self, urls: list[str]) -> dict[str, dict[str, Any]]:
        normalized = [str(url).strip() for url in urls if str(url).strip()]
        if not normalized:
            return {}

        by_url: dict[str, dict[str, Any]] = {}
        for chunk in self._chunked([{"source_url": value} for value in normalized], chunk_size=200):
            values = [row["source_url"] for row in chunk]
            response = self._execute(
                lambda values=values: self.client.table("jobs")
                .select("id,source_url,raw_json,is_active")
                .in_("source_url", values)
                .execute(),
                context="select jobs by source_url",
            )
            for row in response.data or []:
                source_url = str(row.get("source_url") or "").strip()
                if source_url:
                    by_url[source_url] = row
        return by_url

    def fetch_active_jobs_for_company_source(
        self,
        *,
        source_provider: str,
        source_company_key: str,
    ) -> list[dict[str, Any]]:
        if not source_provider or not source_company_key:
            return []

        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id,source_url,raw_json,source_company_key,company_canonical")
            .eq("is_active", True)
            .eq("source_provider", source_provider)
            .limit(10000)
            .execute(),
            context="fetch active jobs for company source",
        )
        rows = response.data or []
        return [
            row
            for row in rows
            if str(row.get("source_company_key") or row.get("company_canonical") or "").strip() == source_company_key
        ]

    def deactivate_jobs(self, job_ids: list[int], *, removed_at: str) -> int:
        if not job_ids:
            return 0

        payload = {
            "is_active": False,
            "removed_at": removed_at,
            "updated_at": removed_at,
        }
        self._execute(
            lambda job_ids=job_ids, payload=payload: self.client.table("jobs").update(payload).in_("id", job_ids).execute(),
            context="deactivate jobs",
        )
        return len(job_ids)

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
            concept_id = concept.get("id") or concept.get("concept_id") or concept.get("taxonomy/id")
            concept_type = (
                concept.get("type")
                or concept.get("concept_type")
                or concept.get("taxonomy/type")
                or "unknown"
            )
            label = (
                concept.get("preferred_label")
                or concept.get("label")
                or concept.get("taxonomy/preferred-label")
            )
            if not concept_id or not label:
                continue
            rows.append(
                {
                    "concept_id": str(concept_id),
                    "concept_type": str(concept_type),
                    "preferred_label": str(label),
                    "ssyk_code": concept.get("ssyk_code") or concept.get("taxonomy/ssyk-code"),
                    "parent_id": concept.get("parent_id") or concept.get("taxonomy/parent-id"),
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

    def fetch_jobs_needing_translation(self, *, limit: int = 20) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(int(limit), 200))
        by_id: dict[int, dict[str, Any]] = {}

        headline_missing = self._execute(
            lambda: self.client.table("jobs")
            .select("id,headline,description,headline_en,description_en,lang,is_active")
            .eq("is_active", True)
            .eq("lang", "sv")
            .is_("headline_en", "null")
            .order("updated_at", desc=True)
            .limit(normalized_limit)
            .execute(),
            context="fetch jobs missing headline_en translation",
        )
        for row in headline_missing.data or []:
            if row.get("id") is None:
                continue
            by_id[int(row["id"])] = row

        if len(by_id) < normalized_limit:
            description_missing = self._execute(
                lambda: self.client.table("jobs")
                .select("id,headline,description,headline_en,description_en,lang,is_active")
                .eq("is_active", True)
                .eq("lang", "sv")
                .is_("description_en", "null")
                .order("updated_at", desc=True)
                .limit(normalized_limit)
                .execute(),
                context="fetch jobs missing description_en translation",
            )
            for row in description_missing.data or []:
                if row.get("id") is None:
                    continue
                by_id[int(row["id"])] = row

        rows = list(by_id.values())
        rows.sort(key=lambda row: int(row.get("id") or 0), reverse=True)
        return rows[:normalized_limit]

    def update_job_translation(self, *, job_id: int, values: dict[str, Any]) -> None:
        if not values:
            return
        payload = dict(values)
        payload["updated_at"] = datetime.now(UTC).isoformat()
        self._execute(
            lambda: self.client.table("jobs").update(payload).eq("id", int(job_id)).execute(),
            context="update job translation fields",
        )

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
            .select("id", count="exact")
            .eq("event_type", event_type)
            .gte("event_time", period_start)
            .lt("event_time", period_end)
            .limit(1)
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
            .select(
                "id,headline,employer_name,company_canonical,company_tier,role_family,"
                "career_stage,is_grad_program,years_required_min,swedish_required,consultancy_flag,"
                "is_target_role,is_noise,relevance_score,reason_codes,published_at"
            )
            .eq("is_active", True)
            .eq("is_target_role", True)
            .order("relevance_score", desc=True)
            .order("published_at", desc=True)
            .limit(limit)
            .execute(),
            context="sample target jobs",
        )
        return response.data or []

    def fetch_jobs_raw_batch(
        self,
        *,
        after_id: int = 0,
        limit: int = 200,
        active_only: bool = False,
    ) -> list[dict[str, Any]]:
        query = (
            self.client.table("jobs")
            .select("id,raw_json,is_active")
            .gt("id", int(after_id))
            .order("id")
            .limit(int(limit))
        )
        if active_only:
            query = query.eq("is_active", True)

        response = self._execute(lambda: query.execute(), context="fetch jobs raw batch")
        return response.data or []

    def fetch_jobs_for_companies(
        self,
        *,
        company_names: list[str],
        period_start: str,
        period_end: str,
    ) -> list[dict[str, Any]]:
        if not company_names:
            return []

        response = self._execute(
            lambda: self.client.table("jobs")
            .select("id,headline,employer_name,company_canonical,company_tier,published_at,is_target_role,relevance_score")
            .eq("is_active", True)
            .gte("published_at", period_start)
            .lt("published_at", period_end)
            .in_("company_canonical", company_names)
            .order("published_at", desc=True)
            .limit(10000)
            .execute(),
            context="fetch jobs for companies",
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
