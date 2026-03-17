from __future__ import annotations

from datetime import UTC, datetime
import logging
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


def _epoch_millis_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        millis = int(value)
    except (TypeError, ValueError):
        return None
    if millis <= 0:
        return None
    return datetime.fromtimestamp(millis / 1000, tz=UTC).isoformat()


def _request_lever_json(feed: CompanyFeed, *, timeout_seconds: int) -> tuple[Any, int, str]:
    endpoint = (
        feed.slug_or_url
        if feed.slug_or_url.startswith("http://") or feed.slug_or_url.startswith("https://")
        else f"https://api.lever.co/v0/postings/{feed.slug_or_url}"
    )
    params: dict[str, Any] = {"mode": "json"}
    if feed.location_filters:
        params["location"] = feed.location_filters[0]

    def _do_request() -> requests.Response:
        response = requests.get(endpoint, params=params, timeout=timeout_seconds)
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient Lever status {response.status_code} for {feed.feed_key}",
                response=response,
            )
        return response

    try:
        response = run_with_backoff(
            _do_request,
            retries=4,
            context=f"lever:{feed.feed_key}",
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


def fetch_lever_jobs(
    feed: CompanyFeed,
    *,
    timeout_seconds: int,
    max_rows: int,
    max_http: int = 1,
) -> FeedFetchResult:
    try:
        payload, http_status, endpoint_url = _request_lever_json(feed, timeout_seconds=timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Lever fetch failed for %s: %s", feed.feed_key, exc)
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

    jobs = payload if isinstance(payload, list) else []
    rows: list[dict[str, Any]] = []
    matching_rows = 0
    for job in jobs:
        if not isinstance(job, dict):
            continue
        headline = str(job.get("text") or "").strip()
        description = str(job.get("descriptionPlain") or job.get("description") or "").strip()
        categories = job.get("categories") if isinstance(job.get("categories"), dict) else {}
        location = str(categories.get("location") or "").strip()

        if not matches_location(location, feed.location_filters):
            continue
        if not matches_any_keyword(f"{headline} {description}", feed.keywords_any):
            continue

        job_id = job.get("id")
        if not job_id:
            continue
        matching_rows += 1

        if len(rows) < max_rows:
            rows.append(
                {
                    "id": f"lever:{feed.feed_key}:{job_id}",
                    "headline": headline,
                    "description": description,
                    "employer_name": feed.company_canonical,
                    "workplace_address": {
                        "city": location,
                        "municipality": location,
                        "region": location,
                    },
                    "source_url": job.get("hostedUrl") or job.get("applyUrl"),
                    "publication_date": _epoch_millis_to_iso(job.get("createdAt")) or _epoch_millis_to_iso(job.get("updatedAt")),
                    "updated_at": _epoch_millis_to_iso(job.get("updatedAt")) or _epoch_millis_to_iso(job.get("createdAt")),
                    "source_name": "lever",
                    "source_provider": "lever",
                    "source_kind": "direct_company_ats",
                    "source_company_key": feed.company_canonical,
                    "is_direct_company_source": True,
                    "lang": "en",
                }
            )

    return FeedFetchResult(
        rows=rows,
        http_requests=1,
        http_status=http_status,
        endpoint_url=endpoint_url,
        provider_rows_before_filters=len(jobs),
        matching_rows_before_limit=matching_rows,
    )
