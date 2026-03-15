from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess
import re
from typing import Any
from urllib.parse import urlencode

import yaml


SUPPORTED_FEED_PROVIDERS = {
    "greenhouse",
    "lever",
    "teamtailor",
    "smartrecruiters",
    "workday",
    "jobs2web",
    "html_fallback",
}


@dataclass(frozen=True)
class CompanyFeed:
    feed_key: str
    provider: str
    slug_or_url: str
    company_canonical: str
    display_name: str | None
    enabled: bool
    priority: int
    location_filters: tuple[str, ...]
    keywords_any: tuple[str, ...]


@dataclass(frozen=True)
class FeedFetchResult:
    rows: list[dict[str, Any]]
    http_requests: int
    http_status: int | None
    endpoint_url: str | None = None
    location_filtering_supported: bool = True
    error: str | None = None
    provider_status: str | None = None
    provider_rows_before_filters: int | None = None


def error_indicates_dns_failure(message: str | None) -> bool:
    text = str(message or "").lower()
    markers = (
        "failed to resolve",
        "could not resolve host",
        "name resolutionerror",
        "temporary failure in name resolution",
        "nodename nor servname provided",
        "name or service not known",
        "getaddrinfo failed",
    )
    return any(marker in text for marker in markers)


def curl_fetch_text(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout_seconds: int = 30,
) -> tuple[str, int, str]:
    query = urlencode(
        [(key, str(value)) for key, value in (params or {}).items() if value not in (None, "")]
    )
    target = f"{url}?{query}" if query else url
    marker_status = "__CODEX_HTTP_STATUS__:"
    marker_url = "__CODEX_EFFECTIVE_URL__:"
    cmd = [
        "curl",
        "-sS",
        "-L",
        "--max-time",
        str(max(1, int(timeout_seconds))),
        "--connect-timeout",
        str(max(1, min(10, int(timeout_seconds)))),
    ]
    for key, value in (headers or {}).items():
        cmd.extend(["-H", f"{key}: {value}"])
    cmd.extend(
        [
            "-w",
            f"\n{marker_status}%{{http_code}}\n{marker_url}%{{url_effective}}",
            target,
        ]
    )
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        error = (result.stderr or result.stdout or "").strip() or f"curl_exit_{result.returncode}"
        raise RuntimeError(error)

    output = result.stdout or ""
    status_idx = output.rfind(marker_status)
    url_idx = output.rfind(marker_url)
    if status_idx < 0 or url_idx < 0 or url_idx < status_idx:
        raise RuntimeError("curl_missing_status_markers")

    body = output[:status_idx].rstrip("\n")
    status_text = output[status_idx + len(marker_status) : output.find("\n", status_idx)].strip()
    effective_url = output[url_idx + len(marker_url) :].strip()
    try:
        status = int(status_text)
    except ValueError as exc:
        raise RuntimeError(f"curl_invalid_status:{status_text}") from exc
    return body, status, effective_url or target


def _normalize_text(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9åäö]+", " ", str(value).lower())
    return re.sub(r"\s+", " ", normalized).strip()


def _as_tuple_strings(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        normalized = value.strip()
        return (normalized,) if normalized else ()
    if not isinstance(value, list):
        return ()
    result: list[str] = []
    for item in value:
        text = str(item).strip()
        if text:
            result.append(text)
    return tuple(result)


def load_company_feeds(config_path: str) -> list[CompanyFeed]:
    path = Path(config_path)
    if not path.exists():
        return []
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return []

    entries = payload.get("feeds")
    if not isinstance(entries, list):
        return []

    feeds: list[CompanyFeed] = []
    for row in entries:
        if not isinstance(row, dict):
            continue
        provider = str(row.get("provider") or "").strip().lower()
        if provider not in SUPPORTED_FEED_PROVIDERS:
            continue

        feed_key = str(row.get("feed_key") or "").strip().lower()
        slug_or_url = str(row.get("slug_or_url") or "").strip()
        company_canonical = str(row.get("company_canonical") or "").strip()
        if not feed_key or not slug_or_url or not company_canonical:
            continue

        feeds.append(
            CompanyFeed(
                feed_key=feed_key,
                provider=provider,
                slug_or_url=slug_or_url,
                company_canonical=company_canonical,
                display_name=str(row.get("display_name") or "").strip() or None,
                enabled=bool(row.get("enabled", True)),
                priority=int(row.get("priority", 100)),
                location_filters=_as_tuple_strings(row.get("location_filters")),
                keywords_any=_as_tuple_strings(row.get("keywords_any")),
            )
        )

    feeds.sort(key=lambda item: (item.priority, item.feed_key))
    return feeds


def matches_any_keyword(text: str, keywords_any: tuple[str, ...]) -> bool:
    if not keywords_any:
        return True
    normalized_text = _normalize_text(text)
    if not normalized_text:
        return False
    haystack = f" {normalized_text} "
    for keyword in keywords_any:
        normalized_keyword = _normalize_text(keyword)
        if normalized_keyword and f" {normalized_keyword} " in haystack:
            return True
    return False


def matches_location(text: str, location_filters: tuple[str, ...]) -> bool:
    if not location_filters:
        return True
    normalized_text = _normalize_text(text)
    if not normalized_text:
        return False
    haystack = f" {normalized_text} "
    for value in location_filters:
        normalized = _normalize_text(value)
        if normalized and f" {normalized} " in haystack:
            return True
    return False
