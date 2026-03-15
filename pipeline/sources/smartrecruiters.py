from __future__ import annotations

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


def _smartrecruiters_payload_status(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if isinstance(error, dict):
        code = str(error.get("code") or "").strip().lower()
        if "company" in code and "not" in code:
            return "wrong_provider_or_slug"
    if isinstance(error, str) and error.strip():
        message = error.strip().lower()
        if "company" in message and "not" in message:
            return "wrong_provider_or_slug"
    if payload == {}:
        return "wrong_provider_or_slug"
    return None


def _request_smartrecruiters_json(
    feed: CompanyFeed,
    *,
    timeout_seconds: int,
    limit: int,
    offset: int,
) -> tuple[Any, int, str]:
    endpoint = (
        feed.slug_or_url
        if feed.slug_or_url.startswith("http://") or feed.slug_or_url.startswith("https://")
        else f"https://api.smartrecruiters.com/v1/companies/{feed.slug_or_url}/postings"
    )
    params: dict[str, Any] = {"limit": min(limit, 100), "offset": max(0, offset)}

    def _do_request() -> requests.Response:
        response = requests.get(endpoint, params=params, timeout=timeout_seconds)
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient SmartRecruiters status {response.status_code} for {feed.feed_key}",
                response=response,
            )
        return response

    try:
        response = run_with_backoff(
            _do_request,
            retries=4,
            context=f"smartrecruiters:{feed.feed_key}",
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


def fetch_smartrecruiters_jobs(
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
            payload, http_status, endpoint_url = _request_smartrecruiters_json(
                feed,
                timeout_seconds=timeout_seconds,
                limit=max_rows - len(rows),
                offset=offset,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("SmartRecruiters fetch failed for %s: %s", feed.feed_key, exc)
            message = str(exc)
            return FeedFetchResult(
                rows=rows,
                http_requests=max(http_requests, 1),
                http_status=last_status,
                endpoint_url=endpoint_url,
                location_filtering_supported=False,
                error=message,
                provider_status="environment_dns_failure" if error_indicates_dns_failure(message) else None,
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
                provider_status="wrong_provider_or_slug" if http_status == 404 else None,
                provider_rows_before_filters=provider_rows_before_filters,
            )

        payload_status = _smartrecruiters_payload_status(payload)
        if payload_status:
            return FeedFetchResult(
                rows=rows,
                http_requests=http_requests,
                http_status=http_status,
                endpoint_url=endpoint_url,
                location_filtering_supported=False,
                provider_status=payload_status,
                provider_rows_before_filters=provider_rows_before_filters,
            )

        content = payload.get("content", []) if isinstance(payload, dict) else []
        total_found = int(payload.get("totalFound") or 0) if isinstance(payload, dict) else 0
        if not isinstance(content, list):
            provider_status = "wrong_provider_or_slug"
            break
        provider_rows_before_filters += len(content)
        if not content:
            provider_status = "provider_present_but_zero_matching_rows" if total_found == 0 else provider_status
            break

        for job in content:
            if not isinstance(job, dict):
                continue
            headline = str(job.get("name") or "").strip()
            location_obj = job.get("location") if isinstance(job.get("location"), dict) else {}
            city = str(location_obj.get("city") or "").strip()
            region = str(location_obj.get("region") or location_obj.get("country") or "").strip()
            location = " ".join(part for part in (city, region) if part).strip()
            description = str(job.get("jobAd", {}).get("sections", "") or "").strip()

            if not matches_location(location, feed.location_filters):
                continue
            if not matches_any_keyword(f"{headline} {description}", feed.keywords_any):
                continue

            posting_id = job.get("id") or job.get("ref")
            if posting_id is None:
                continue

            rows.append(
                {
                    "id": f"smartrecruiters:{feed.feed_key}:{posting_id}",
                    "headline": headline,
                    "description": description,
                    "employer_name": feed.display_name or feed.company_canonical,
                    "workplace_address": {
                        "city": city,
                        "municipality": city,
                        "region": region,
                    },
                    "source_url": job.get("ref")
                    and (
                        f"https://jobs.smartrecruiters.com/{feed.slug_or_url}/{job.get('id')}"
                        if not str(feed.slug_or_url).startswith("http")
                        else None
                    ),
                    "publication_date": job.get("releasedDate"),
                    "updated_at": job.get("releasedDate"),
                    "source_name": "smartrecruiters",
                    "source_provider": "smartrecruiters",
                    "source_kind": "direct_company_ats",
                    "source_company_key": feed.company_canonical,
                    "is_direct_company_source": True,
                    "lang": "en",
                }
            )
            if len(rows) >= max_rows:
                break

        if len(content) < min(max_rows, 100):
            break
        offset += len(content)

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
