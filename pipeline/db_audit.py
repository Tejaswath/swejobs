"""Read-only database audit for SweJobs pipeline tables.

Run via: ``python -m pipeline.main db-audit``.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)


def _planned_count(storage: Any, table: str, filters: list[tuple[str, str, Any]] | None = None) -> int:
    """Return a fast planner estimate (count='planned') for table rows."""
    try:
        query = storage.client.table(table).select("id", count="planned").limit(1)
        for column, op, value in (filters or []):
            if op == "eq":
                query = query.eq(column, value)
            elif op == "lt":
                query = query.lt(column, value)
        response = query.execute()
        return int(response.count or 0)
    except Exception as exc:
        logger.debug("planned_count %s failed: %s", table, exc)
        return -1


def run_db_audit(storage: Any, settings: Any) -> dict[str, Any]:
    """Query table size proxies and compaction eligibility without mutations."""
    now = datetime.now(UTC)

    raw_json_days = int(getattr(settings, "compaction_raw_json_days", 7))
    inactive_days = int(getattr(settings, "compaction_inactive_job_days", 60))
    events_days = int(getattr(settings, "compaction_job_event_days", 30))
    digests_days = int(getattr(settings, "compaction_weekly_digest_days", 180))
    email_logs_days = int(getattr(settings, "compaction_email_logs_days", 90))
    edge_quota_days = int(getattr(settings, "compaction_edge_function_quota_days", 7))

    raw_json_cutoff = (now - timedelta(days=raw_json_days)).isoformat()
    inactive_cutoff = (now - timedelta(days=inactive_days)).isoformat()
    events_cutoff = (now - timedelta(days=events_days)).isoformat()
    digests_cutoff = (now - timedelta(days=digests_days)).isoformat()
    email_logs_cutoff = (now - timedelta(days=email_logs_days)).isoformat()
    edge_quota_cutoff = (now - timedelta(days=edge_quota_days)).isoformat()

    errors: list[str] = []
    try:
        state = storage.get_ingestion_state(["last_compaction_at", "last_deadline_expiration_at"])
        last_compaction_at = state.get("last_compaction_at")
        last_deadline_expiration_at = state.get("last_deadline_expiration_at")
    except Exception as exc:
        errors.append(f"ingestion_state: {exc}")
        last_compaction_at = None
        last_deadline_expiration_at = None

    return {
        "generated_at": now.isoformat(),
        "last_compaction_at": last_compaction_at,
        "last_deadline_expiration_at": last_deadline_expiration_at,
        "note": "All counts are Postgres planner estimates (count=planned).",
        "table_counts": {
            "jobs_total": _planned_count(storage, "jobs"),
            "jobs_active": _planned_count(storage, "jobs", [("is_active", "eq", True)]),
            "jobs_inactive": _planned_count(storage, "jobs", [("is_active", "eq", False)]),
            "job_events_total": _planned_count(storage, "job_events"),
            "weekly_digests_total": _planned_count(storage, "weekly_digests"),
            "email_logs_total": _planned_count(storage, "email_logs"),
            "edge_function_quota_total": _planned_count(storage, "edge_function_quota"),
        },
        "compaction_eligible": {
            "raw_json_to_clear": _planned_count(storage, "jobs", [("published_at", "lt", raw_json_cutoff)]),
            "inactive_jobs_before_cutoff": _planned_count(
                storage, "jobs", [("is_active", "eq", False), ("published_at", "lt", inactive_cutoff)]
            ),
            "job_events_to_delete": _planned_count(storage, "job_events", [("event_time", "lt", events_cutoff)]),
            "weekly_digests_to_delete": _planned_count(
                storage, "weekly_digests", [("generated_at", "lt", digests_cutoff)]
            ),
            "email_logs_to_delete": _planned_count(storage, "email_logs", [("sent_at", "lt", email_logs_cutoff)]),
            "edge_function_quota_to_delete": _planned_count(
                storage, "edge_function_quota", [("window_start", "lt", edge_quota_cutoff)]
            ),
        },
        "retention_settings": {
            "raw_json_days": raw_json_days,
            "inactive_jobs_days": inactive_days,
            "job_events_days": events_days,
            "weekly_digests_days": digests_days,
            "email_logs_days": email_logs_days,
            "edge_function_quota_days": edge_quota_days,
        },
        "cutoffs": {
            "raw_json_before": raw_json_cutoff,
            "inactive_jobs_before": inactive_cutoff,
            "job_events_before": events_cutoff,
            "weekly_digests_before": digests_cutoff,
            "email_logs_before": email_logs_cutoff,
            "edge_function_quota_before": edge_quota_cutoff,
        },
        "errors": errors,
    }

