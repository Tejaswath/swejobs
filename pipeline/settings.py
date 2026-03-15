from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    jobtech_api_key: str | None
    poll_seconds: int
    digest_window_days: int
    digest_refresh_minutes: int
    timezone: str
    log_level: str
    target_profile_path: str
    request_timeout_seconds: int
    batch_size: int
    jobtech_snapshot_url: str
    jobtech_stream_url: str
    jobtech_taxonomy_url: str
    enable_company_feeds: bool
    company_feed_config_path: str
    feed_interval_polls: int
    feed_http_budget: int
    feed_row_budget: int
    feed_consecutive_miss_threshold: int
    stream_reset_stale_cursor_hours: int
    compaction_interval_hours: int
    compaction_raw_json_days: int
    compaction_inactive_job_days: int
    compaction_job_event_days: int
    compaction_weekly_digest_days: int


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_settings() -> Settings:
    return Settings(
        supabase_url=_required("SUPABASE_URL"),
        supabase_service_role_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
        jobtech_api_key=os.getenv("JOBTECH_API_KEY"),
        poll_seconds=int(os.getenv("POLL_SECONDS", "60")),
        digest_window_days=int(os.getenv("DIGEST_WINDOW_DAYS", "30")),
        digest_refresh_minutes=int(os.getenv("DIGEST_REFRESH_MINUTES", "60")),
        timezone=os.getenv("TZ", "Europe/Stockholm"),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        target_profile_path=os.getenv("TARGET_PROFILE_PATH", "pipeline/config/target_profile.yaml"),
        request_timeout_seconds=int(os.getenv("REQUEST_TIMEOUT_SECONDS", "30")),
        batch_size=int(os.getenv("BATCH_SIZE", "200")),
        jobtech_snapshot_url=os.getenv("JOBTECH_SNAPSHOT_URL", "https://jobstream.api.jobtechdev.se/v2/snapshot"),
        jobtech_stream_url=os.getenv("JOBTECH_STREAM_URL", "https://jobstream.api.jobtechdev.se/v2/stream"),
        jobtech_taxonomy_url=os.getenv(
            "JOBTECH_TAXONOMY_URL",
            "https://taxonomy.api.jobtechdev.se/v1/taxonomy/main/concepts",
        ),
        enable_company_feeds=_bool("ENABLE_COMPANY_FEEDS", False),
        company_feed_config_path=os.getenv("COMPANY_FEED_CONFIG_PATH", "pipeline/config/company_feeds.yaml"),
        feed_interval_polls=int(os.getenv("FEED_INTERVAL_POLLS", "5")),
        feed_http_budget=int(os.getenv("FEED_HTTP_BUDGET", "3")),
        feed_row_budget=int(os.getenv("FEED_ROW_BUDGET", "40")),
        feed_consecutive_miss_threshold=int(os.getenv("FEED_CONSECUTIVE_MISS_THRESHOLD", "10")),
        stream_reset_stale_cursor_hours=int(os.getenv("STREAM_RESET_STALE_CURSOR_HOURS", "24")),
        compaction_interval_hours=int(os.getenv("COMPACTION_INTERVAL_HOURS", "24")),
        compaction_raw_json_days=int(os.getenv("COMPACTION_RAW_JSON_DAYS", "7")),
        compaction_inactive_job_days=int(os.getenv("COMPACTION_INACTIVE_JOB_DAYS", "60")),
        compaction_job_event_days=int(os.getenv("COMPACTION_JOB_EVENT_DAYS", "30")),
        compaction_weekly_digest_days=int(os.getenv("COMPACTION_WEEKLY_DIGEST_DAYS", "180")),
    )
