from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse

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

JSON_LD_RE = re.compile(
    r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)
HREF_RE = re.compile(r"""href=["'](?P<url>[^"'#?][^"']*)["']""", re.IGNORECASE)
JOB_PATH_HINT_RE = re.compile(r"/(jobs?|jobb|karriar|career)(/|$)", re.IGNORECASE)
HTML_HEADERS = {"accept": "text/html,application/xhtml+xml"}


def _strip_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", text).strip()


def _collect_job_postings(payload: Any) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    if isinstance(payload, list):
        for item in payload:
            results.extend(_collect_job_postings(item))
        return results
    if not isinstance(payload, dict):
        return results

    value_type = payload.get("@type")
    if value_type == "JobPosting":
        results.append(payload)
    if isinstance(payload.get("@graph"), list):
        results.extend(_collect_job_postings(payload["@graph"]))
    for value in payload.values():
        if isinstance(value, (dict, list)):
            results.extend(_collect_job_postings(value))
    return results


def _first_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("name", "title", "value", "text"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
    if isinstance(value, list):
        for item in value:
            text = _first_text(item)
            if text:
                return text
    return ""


def _extract_location(job: dict[str, Any]) -> str:
    location = job.get("jobLocation")
    if isinstance(location, list):
        parts = [_extract_location({"jobLocation": item}) for item in location]
        return ", ".join(part for part in parts if part)
    if isinstance(location, dict):
        address = location.get("address")
        if isinstance(address, dict):
            fields = [
                _first_text(address.get("addressLocality")),
                _first_text(address.get("addressRegion")),
                _first_text(address.get("addressCountry")),
            ]
            return ", ".join(field for field in fields if field)
        return _first_text(location)
    return _first_text(location)


def _parse_job_postings_from_html(html: str) -> list[dict[str, Any]]:
    postings: list[dict[str, Any]] = []
    for match in JSON_LD_RE.findall(html):
        raw = match.strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        postings.extend(_collect_job_postings(payload))
    return postings


def _extract_candidate_detail_urls(html: str, *, base_url: str) -> list[str]:
    base = urlparse(base_url)
    base_host = (base.netloc or "").lower()
    candidates: list[str] = []
    seen: set[str] = set()

    for match in HREF_RE.finditer(html):
        raw_url = str(match.group("url") or "").strip()
        if not raw_url:
            continue
        absolute = urljoin(base_url, raw_url)
        parsed = urlparse(absolute)
        host = (parsed.netloc or "").lower()
        path = parsed.path or ""
        if host != base_host:
            continue
        if not JOB_PATH_HINT_RE.search(path):
            continue
        if path.rstrip("/") == urlparse(base_url).path.rstrip("/"):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        candidates.append(absolute)
    return candidates


def _request_html_page(url: str, *, timeout_seconds: int) -> tuple[str, int, str]:
    def _do_request() -> requests.Response:
        response = requests.get(
            url,
            timeout=timeout_seconds,
            headers=HTML_HEADERS,
            allow_redirects=True,
        )
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient HTML fallback status {response.status_code} for {url}",
                response=response,
            )
        return response

    try:
        response = run_with_backoff(
            _do_request,
            retries=4,
            context=f"html-fallback:{url}",
            retriable_exceptions=(requests.RequestException, requests.HTTPError),
            should_retry=lambda exc: not error_indicates_dns_failure(str(exc)),
        )
        return response.text or "", int(response.status_code), str(response.url or url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("HTML fallback fetch failed for %s: %s", url, exc)
        message = str(exc)
        if not error_indicates_dns_failure(message):
            raise
        html, response_status, effective_url = curl_fetch_text(
            url,
            headers=HTML_HEADERS,
            timeout_seconds=timeout_seconds,
        )
        return html, response_status, effective_url


def fetch_html_fallback_jobs(
    feed: CompanyFeed,
    *,
    timeout_seconds: int,
    max_rows: int,
    max_http: int = 1,
) -> FeedFetchResult:
    if not (feed.slug_or_url.startswith("http://") or feed.slug_or_url.startswith("https://")):
        return FeedFetchResult(
            rows=[],
            http_requests=0,
            http_status=None,
            endpoint_url=None,
            location_filtering_supported=False,
            error="html_fallback_requires_absolute_url",
        )

    target_url = feed.slug_or_url

    try:
        html, response_status, effective_url = _request_html_page(target_url, timeout_seconds=timeout_seconds)
        http_requests = 1
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if not error_indicates_dns_failure(message):
            return FeedFetchResult(
                rows=[],
                http_requests=1,
                http_status=None,
                endpoint_url=target_url,
                location_filtering_supported=False,
                error=message,
            )
        try:
            html, response_status, effective_url = _request_html_page(target_url, timeout_seconds=timeout_seconds)
            http_requests = 1
        except Exception as curl_exc:  # noqa: BLE001
            curl_message = str(curl_exc)
            return FeedFetchResult(
                rows=[],
                http_requests=1,
                http_status=None,
                endpoint_url=target_url,
                location_filtering_supported=False,
                error=curl_message,
                provider_status="environment_dns_failure" if error_indicates_dns_failure(curl_message) else None,
            )

    postings = _parse_job_postings_from_html(html)
    detail_urls_considered = 0
    if not postings and max_http > 1:
        for detail_url in _extract_candidate_detail_urls(html, base_url=effective_url)[: max_http - 1]:
            try:
                detail_html, _, _ = _request_html_page(detail_url, timeout_seconds=timeout_seconds)
            except Exception:
                http_requests += 1
                continue
            http_requests += 1
            detail_urls_considered += 1
            postings.extend(_parse_job_postings_from_html(detail_html))
            if postings:
                break

    rows: list[dict[str, Any]] = []
    for idx, posting in enumerate(postings, start=1):
        headline = _first_text(posting.get("title") or posting.get("name"))
        description = _strip_html(_first_text(posting.get("description")))
        location = _extract_location(posting)
        source_url = _first_text(posting.get("url")) or response.url
        posted_at = _first_text(posting.get("datePosted"))
        valid_through = _first_text(posting.get("validThrough"))
        employer_name = _first_text(posting.get("hiringOrganization")) or feed.display_name or feed.company_canonical

        if not headline:
            continue
        if not matches_location(location, feed.location_filters):
            continue
        if not matches_any_keyword(f"{headline} {description}", feed.keywords_any):
            continue

        rows.append(
            {
                "id": f"html_fallback:{feed.feed_key}:{idx}:{headline[:64]}",
                "headline": headline,
                "description": description,
                "employer_name": employer_name,
                "workplace_address": {
                    "city": location,
                    "municipality": location,
                    "region": location,
                },
                "source_url": source_url,
                "publication_date": posted_at or None,
                "updated_at": posted_at or None,
                "application_deadline": valid_through or None,
                "source_name": "html_fallback",
                "source_provider": "html_fallback",
                "source_kind": "html_fallback",
                "source_company_key": feed.company_canonical,
                "is_direct_company_source": True,
                "lang": "en",
            }
        )
        if len(rows) >= max_rows:
            break

    return FeedFetchResult(
        rows=rows,
        http_requests=http_requests,
        http_status=response_status,
        endpoint_url=effective_url,
        location_filtering_supported=False,
        error=None if rows else ("no_jobposting_jsonld" if detail_urls_considered == 0 else "no_detail_jobposting_jsonld"),
    )
