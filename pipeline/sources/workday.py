from __future__ import annotations

import logging
import re
from typing import Any

import requests

from ..retry_utils import run_with_backoff
from .base import (
    CompanyFeed,
    FeedFetchResult,
    curl_fetch_text,
    error_indicates_dns_failure,
    matches_any_keyword,
    matches_location,
)

logger = logging.getLogger(__name__)

DISCOVERY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
REQUEST_HEADERS = {
    "User-Agent": DISCOVERY_HEADERS["User-Agent"],
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": DISCOVERY_HEADERS["Accept-Language"],
    "Content-Type": "application/json",
}

WORKDAY_ENDPOINT_RE = re.compile(
    r"https?://[^\"'\\s<>]+/wday/(?:cxs|mxs)/[^\"'\\s<>]+/[^\"'\\s<>]+/jobs(?:/[^\"'\\s<>]+)?",
    re.IGNORECASE,
)


def normalize_workday_endpoint(url: str | None) -> str | None:
    text = str(url or "").strip()
    if not text:
        return None
    text = text.rstrip("/")
    marker_match = re.search(r"/wday/(cxs|mxs)/", text, re.IGNORECASE)
    if not marker_match:
        return None
    marker = marker_match.group(0)
    prefix, suffix = text.split(marker, 1)
    parts = [part for part in suffix.split("/") if part]
    if len(parts) < 3:
        return None
    tenant, site = parts[0], parts[1]
    return f"{prefix}{marker}{tenant}/{site}/jobs"


def discover_workday_endpoint(
    career_page_url: str,
    *,
    timeout_seconds: int,
) -> dict[str, Any]:
    target_url = str(career_page_url or "").strip()
    if not target_url:
        return {"status": "missing_career_page_url", "endpoint_url": None, "career_page_url": None}

    def _do_request() -> requests.Response:
        response = requests.get(
            target_url,
            timeout=timeout_seconds,
            headers=DISCOVERY_HEADERS,
            allow_redirects=True,
        )
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient Workday discovery status {response.status_code} for {target_url}",
                response=response,
            )
        return response

    try:
        response = run_with_backoff(
            _do_request,
            retries=4,
            context=f"workday-discovery:{target_url}",
            retriable_exceptions=(requests.RequestException, requests.HTTPError),
            should_retry=lambda exc: not error_indicates_dns_failure(str(exc)),
        )
        html = response.text or ""
        final_url = str(response.url or target_url)
        http_status = int(response.status_code)
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if not error_indicates_dns_failure(message):
            return {
                "status": "error",
                "endpoint_url": None,
                "career_page_url": target_url,
                "error": message,
            }
        try:
            html, http_status, final_url = curl_fetch_text(
                target_url,
                headers=DISCOVERY_HEADERS,
                timeout_seconds=timeout_seconds,
            )
        except Exception as curl_exc:  # noqa: BLE001
            curl_message = str(curl_exc)
            return {
                "status": "environment_dns_failure" if error_indicates_dns_failure(curl_message) else "error",
                "endpoint_url": None,
                "career_page_url": target_url,
                "error": curl_message,
            }

    candidates = set(WORKDAY_ENDPOINT_RE.findall(html))
    normalized_candidates = sorted(
        {
            normalized
            for normalized in (normalize_workday_endpoint(candidate) for candidate in candidates)
            if normalized
        }
    )

    if not normalized_candidates:
        normalized = normalize_workday_endpoint(final_url)
        if normalized:
            normalized_candidates.append(normalized)

    if not normalized_candidates:
        status = "blocked" if int(http_status) in {401, 403} else "not_found"
        return {
            "status": status,
            "endpoint_url": None,
            "career_page_url": final_url,
            "http_status": http_status,
        }

    return {
        "status": "ok",
        "endpoint_url": normalized_candidates[0],
        "career_page_url": final_url,
        "http_status": http_status,
        "candidates": normalized_candidates,
    }


def _request_workday_json(
    feed: CompanyFeed,
    *,
    timeout_seconds: int,
    limit: int,
    offset: int,
) -> tuple[Any, int, str]:
    raw_identifier = str(feed.slug_or_url or "").strip()
    normalized_endpoint = normalize_workday_endpoint(raw_identifier)
    if normalized_endpoint:
        endpoint = normalized_endpoint
    elif raw_identifier.startswith("http://") or raw_identifier.startswith("https://"):
        discovery = discover_workday_endpoint(raw_identifier, timeout_seconds=timeout_seconds)
        endpoint = str(discovery.get("endpoint_url") or "").strip()
        if not endpoint:
            status = discovery.get("status") or "unknown"
            raise RuntimeError(f"Workday endpoint discovery failed for {feed.feed_key}: {status}")
    else:
        raise RuntimeError("Workday feeds require a verified endpoint URL or career page URL in slug_or_url")

    payload = {
        "limit": min(limit, 20),
        "offset": max(0, offset),
        "searchText": "",
    }
    def _do_request() -> requests.Response:
        response = requests.post(endpoint, json=payload, timeout=timeout_seconds, headers=REQUEST_HEADERS)
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient Workday status {response.status_code} for {feed.feed_key}",
                response=response,
            )
        return response

    response = run_with_backoff(
        _do_request,
        retries=4,
        context=f"workday:{feed.feed_key}",
        retriable_exceptions=(requests.RequestException, requests.HTTPError),
        should_retry=lambda exc: not error_indicates_dns_failure(str(exc)),
    )
    return response.json(), int(response.status_code), endpoint


def _pick(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ""):
            return value
    return None


def fetch_workday_jobs(
    feed: CompanyFeed,
    *,
    timeout_seconds: int,
    max_rows: int,
    max_http: int = 1,
) -> FeedFetchResult:
    rows: list[dict[str, Any]] = []
    http_requests = 0
    last_status: int | None = None
    endpoint_url: str | None = None
    offset = 0
    provider_status: str | None = None
    provider_rows_before_filters = 0

    while http_requests < max_http and len(rows) < max_rows:
        try:
            payload, http_status, endpoint_url = _request_workday_json(
                feed,
                timeout_seconds=timeout_seconds,
                limit=max_rows - len(rows),
                offset=offset,
            )
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            if error_indicates_dns_failure(message):
                provider_status = "environment_dns_failure"
            elif "discovery failed" in message and "blocked" in message:
                provider_status = "blocked_by_bot_protection"
            elif "discovery failed" in message:
                provider_status = "requires_custom_adapter"
            logger.warning("Workday fetch failed for %s: %s", feed.feed_key, exc)
            return FeedFetchResult(
                rows=rows,
                http_requests=max(http_requests, 1),
                http_status=last_status,
                endpoint_url=endpoint_url,
                location_filtering_supported=False,
                error=message,
                provider_status=provider_status,
                provider_rows_before_filters=provider_rows_before_filters,
            )

        http_requests += 1
        last_status = http_status
        if http_status >= 400:
            return FeedFetchResult(
                rows=rows,
                http_requests=http_requests,
                http_status=http_status,
                endpoint_url=endpoint_url,
                location_filtering_supported=False,
                error=f"http_{http_status}",
                provider_status="blocked_by_bot_protection" if http_status in {401, 403} else "wrong_provider_or_slug",
                provider_rows_before_filters=provider_rows_before_filters,
            )

        postings = payload.get("jobPostings", []) if isinstance(payload, dict) else []
        if not isinstance(postings, list):
            provider_status = "requires_custom_adapter"
            break
        provider_rows_before_filters += len(postings)
        if not postings:
            provider_status = "provider_present_but_zero_matching_rows"
            break

        for job in postings:
            if not isinstance(job, dict):
                continue
            bulletin = job.get("bulletFields") if isinstance(job.get("bulletFields"), list) else []
            location = " ".join(str(value).strip() for value in bulletin if value).strip()
            headline = str(_pick(job, "title", "name") or "").strip()
            description = str(_pick(job, "externalPath", "description") or "").strip()

            if not matches_location(location, feed.location_filters):
                continue
            if not matches_any_keyword(f"{headline} {description}", feed.keywords_any):
                continue

            external_path = str(job.get("externalPath") or "").strip()
            posting_id = str(job.get("bulletFields") or job.get("title") or external_path).strip()
            if not posting_id:
                continue

            rows.append(
                {
                    "id": f"workday:{feed.feed_key}:{posting_id}",
                    "headline": headline,
                    "description": description,
                    "employer_name": feed.display_name or feed.company_canonical,
                    "workplace_address": {
                        "city": location,
                        "municipality": location,
                        "region": location,
                    },
                    "source_url": endpoint_url.rstrip("/") + "/" + external_path.lstrip("/") if external_path else None,
                    "publication_date": job.get("postedOn"),
                    "updated_at": job.get("postedOn"),
                    "source_name": "workday",
                    "source_provider": "workday",
                    "source_kind": "direct_company_ats",
                    "source_company_key": feed.company_canonical,
                    "is_direct_company_source": True,
                    "lang": "en",
                }
            )
            if len(rows) >= max_rows:
                break

        offset += len(postings)
        total = int(payload.get("total") or 0) if isinstance(payload, dict) else 0
        if total and offset >= total:
            break
        if not postings:
            break

    if provider_status is None and provider_rows_before_filters > 0 and not rows:
        provider_status = "provider_present_but_zero_matching_rows"

    return FeedFetchResult(
        rows=rows,
        http_requests=max(http_requests, 1),
        http_status=last_status,
        endpoint_url=endpoint_url,
        location_filtering_supported=False,
        provider_status=provider_status,
        provider_rows_before_filters=provider_rows_before_filters,
    )
