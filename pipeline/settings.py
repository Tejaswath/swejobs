from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    jobtech_api_key: str | None
    poll_seconds: int
    timezone: str
    log_level: str
    target_profile_path: str
    request_timeout_seconds: int
    batch_size: int
    jobtech_snapshot_url: str
    jobtech_stream_url: str
    jobtech_taxonomy_url: str


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def load_settings() -> Settings:
    return Settings(
        supabase_url=_required("SUPABASE_URL"),
        supabase_service_role_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
        jobtech_api_key=os.getenv("JOBTECH_API_KEY"),
        poll_seconds=int(os.getenv("POLL_SECONDS", "60")),
        timezone=os.getenv("TZ", "Europe/Stockholm"),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        target_profile_path=os.getenv("TARGET_PROFILE_PATH", "pipeline/config/target_profile.yaml"),
        request_timeout_seconds=int(os.getenv("REQUEST_TIMEOUT_SECONDS", "30")),
        batch_size=int(os.getenv("BATCH_SIZE", "200")),
        jobtech_snapshot_url=os.getenv("JOBTECH_SNAPSHOT_URL", "https://jobstream.api.jobtechdev.se/snapshot"),
        jobtech_stream_url=os.getenv("JOBTECH_STREAM_URL", "https://jobstream.api.jobtechdev.se/stream"),
        jobtech_taxonomy_url=os.getenv(
            "JOBTECH_TAXONOMY_URL",
            "https://taxonomy.api.jobtechdev.se/v1/taxonomy/main/concepts",
        ),
    )
