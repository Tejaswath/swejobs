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


def _strip_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _split_location(location: str) -> tuple[str | None, str | None]:
    if not location:
        return None, None
    parts = [part.strip() for part in location.split(",") if part.strip()]
    if len(parts) >= 2:
        return parts[0], parts[-1]
    return location.strip(), None


def _request_greenhouse_json(feed: CompanyFeed, *, timeout_seconds: int) -> tuple[Any, int, str]:
    endpoint = (
        feed.slug_or_url
        if feed.slug_or_url.startswith("http://") or feed.slug_or_url.startswith("https://")
        else f"https://boards-api.greenhouse.io/v1/boards/{feed.slug_or_url}/jobs"
    )
    params: dict[str, Any] = {"content": "true"}
    if feed.location_filters:
        params["location"] = feed.location_filters[0]

    def _do_request() -> requests.Response:
        response = requests.get(endpoint, params=params, timeout=timeout_seconds)
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient Greenhouse status {response.status_code} for {feed.feed_key}",
                response=response,
            )
        return response

    try:
        response = run_with_backoff(
            _do_request,
            retries=4,
            context=f"greenhouse:{feed.feed_key}",
            retriable_exceptions=(requests.RequestException, requests.HTTPError),
            should_retry=lambda exc: not error_indicates_dns_failure(str(exc)),
        )
        return response.json(), int(response.status_code), endpoint
    except Exception as exc:
        if not error_indicates_dns_failure(str(exc)):
            raise
        body, status, effective_url = curl_fetch_text(
            endpoint,
            params=params,
            headers={"accept": "application/json"},
            timeout_seconds=timeout_seconds,
        )
        return requests.models.complexjson.loads(body), status, effective_url


def fetch_greenhouse_jobs(
    feed: CompanyFeed,
    *,
    timeout_seconds: int,
    max_rows: int,
    max_http: int = 1,
) -> FeedFetchResult:
    try:
        payload, http_status, endpoint_url = _request_greenhouse_json(feed, timeout_seconds=timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Greenhouse fetch failed for %s: %s", feed.feed_key, exc)
        message = str(exc)
        return FeedFetchResult(
            rows=[],
            http_requests=1,
            http_status=None,
            error=message,
            provider_status="environment_dns_failure" if error_indicates_dns_failure(message) else None,
        )

    if http_status >= 400:
        return FeedFetchResult(
            rows=[],
            http_requests=1,
            http_status=http_status,
            endpoint_url=endpoint_url,
            error=f"http_{http_status}",
        )

    jobs = payload.get("jobs", []) if isinstance(payload, dict) else []
    if not isinstance(jobs, list):
        return FeedFetchResult(rows=[], http_requests=1, http_status=http_status, error="invalid_payload")

    rows: list[dict[str, Any]] = []
    for job in jobs:
        if not isinstance(job, dict):
            continue
        headline = str(job.get("title") or "").strip()
        description = _strip_html(str(job.get("content") or ""))
        location = str((job.get("location") or {}).get("name") or "").strip()
        city, region = _split_location(location)

        if not matches_location(location, feed.location_filters):
            continue
        if not matches_any_keyword(f"{headline} {description}", feed.keywords_any):
            continue

        job_id = job.get("id")
        if job_id is None:
            continue

        rows.append(
            {
                "id": f"greenhouse:{feed.feed_key}:{job_id}",
                "headline": headline,
                "description": description,
                "employer_name": feed.company_canonical,
                "workplace_address": {
                    "city": city,
                    "region": region,
                    "municipality": city,
                },
                "source_url": job.get("absolute_url"),
                "publication_date": job.get("updated_at") or job.get("created_at"),
                "updated_at": job.get("updated_at") or job.get("created_at"),
                "source_name": "greenhouse",
                "source_provider": "greenhouse",
                "source_kind": "direct_company_ats",
                "source_company_key": feed.company_canonical,
                "is_direct_company_source": True,
                "lang": "en",
            }
        )
        if len(rows) >= max_rows:
            break

    return FeedFetchResult(rows=rows, http_requests=1, http_status=http_status, endpoint_url=endpoint_url)
