from __future__ import annotations

import html
import json
import logging
import re
from typing import Any
from urllib.parse import urljoin

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

TEAMTAILOR_HTML_HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
}

_TAG_RE = re.compile(r"<[^>]+>")
_JOB_LINK_RE = re.compile(
    r"<a[^>]+href=\"(?P<url>[^\"]+/jobs/[^\"]+|/jobs/[^\"]+)\"[^>]*>(?P<body>.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
_JOB_CARD_RE = re.compile(
    r"<li[^>]*>\s*<div[^>]*>\s*"
    r"<a[^>]+href=\"(?P<url>[^\"]+/jobs/[^\"]+|/jobs/[^\"]+)\"[^>]*>(?P<title>.*?)</a>\s*"
    r"<div[^>]+class=\"[^\"]*text-md[^\"]*\"[^>]*>(?P<meta>.*?)</div>",
    re.IGNORECASE | re.DOTALL,
)
_SPAN_RE = re.compile(r"<span[^>]*>(?P<text>.*?)</span>", re.IGNORECASE | re.DOTALL)
_JSONLD_RE = re.compile(
    r"<script[^>]+type=\"application/ld\+json\"[^>]*>(?P<body>.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)
_TECH_TITLE_HINTS = (
    "developer",
    "engineer",
    "software",
    "fullstack",
    "backend",
    "frontend",
    "front end",
    "mobile",
    "android",
    "ios",
    "data",
    "platform",
    "cloud",
    "qa",
    "test",
    "security",
    "devops",
    "sre",
    "java",
    "python",
    "kotlin",
    "react",
    "machine learning",
    "analytics engineer",
)


def _clean_html_text(value: str | None) -> str:
    if not value:
        return ""
    text = html.unescape(value)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_teamtailor_base_url(identifier: str) -> str:
    if identifier.endswith("/jobs.json"):
        return identifier[: -len("/jobs.json")].rstrip("/")
    if identifier.endswith("/jobs"):
        return identifier[: -len("/jobs")].rstrip("/")
    if identifier.endswith("/jobs/"):
        return identifier[: -len("/jobs/")].rstrip("/")
    if identifier.endswith("/"):
        return identifier.rstrip("/")
    return identifier


def _request_teamtailor_html(endpoint: str, *, timeout_seconds: int) -> tuple[str, int, str]:
    def _do_request() -> requests.Response:
        response = requests.get(endpoint, timeout=timeout_seconds, headers=TEAMTAILOR_HTML_HEADERS)
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient Teamtailor status {response.status_code} for {endpoint}",
                response=response,
            )
        return response

    try:
        response = run_with_backoff(
            _do_request,
            retries=3,
            context=f"teamtailor-html:{endpoint}",
            retriable_exceptions=(requests.RequestException, requests.HTTPError),
            should_retry=lambda exc: not error_indicates_dns_failure(str(exc)),
        )
        return response.text, int(response.status_code), endpoint
    except Exception as exc:
        if not error_indicates_dns_failure(str(exc)):
            raise
        body, status, effective_url = curl_fetch_text(
            endpoint,
            headers=TEAMTAILOR_HTML_HEADERS,
            timeout_seconds=timeout_seconds,
        )
        return body, status, effective_url


def _extract_teamtailor_html_jobs(html_text: str, *, base_url: str) -> list[dict[str, str]]:
    jobs: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for card_match in _JOB_CARD_RE.finditer(html_text):
        source_url = urljoin(base_url + "/", card_match.group("url"))
        if source_url in seen_urls:
            continue
        seen_urls.add(source_url)

        headline = _clean_html_text(card_match.group("title"))
        if not headline:
            continue

        metadata_spans = [
            _clean_html_text(span.group("text")) for span in _SPAN_RE.finditer(card_match.group("meta"))
        ]
        metadata_spans = [span for span in metadata_spans if span and span != "·"]

        department = metadata_spans[0] if metadata_spans else ""
        location = ""
        for span in metadata_spans[1:] if len(metadata_spans) > 1 else metadata_spans:
            lower_span = span.lower()
            if any(
                token in lower_span
                for token in ("stockholm", "sweden", "göteborg", "gothenburg", "södertälje", "växjö", "malmö", "linköping")
            ):
                location = span
                break
        if not location and len(metadata_spans) > 1:
            location = metadata_spans[1]
        elif not location and metadata_spans:
            location = metadata_spans[-1]

        jobs.append(
            {
                "headline": headline,
                "description": department,
                "location": location,
                "source_url": source_url,
            }
        )

    if jobs:
        return jobs

    for link_match in _JOB_LINK_RE.finditer(html_text):
        source_url = urljoin(base_url + "/", link_match.group("url"))
        if source_url in seen_urls:
            continue
        seen_urls.add(source_url)

        link_body = link_match.group("body")
        spans = [_clean_html_text(span.group("text")) for span in _SPAN_RE.finditer(link_body)]
        spans = [span for span in spans if span and span != "·"]

        headline = spans[0] if spans else _clean_html_text(link_body)
        if not headline:
            continue

        metadata_spans = spans[1:] if len(spans) > 1 else []

        department = metadata_spans[0] if metadata_spans else ""
        location = ""
        for span in metadata_spans[1:] if len(metadata_spans) > 1 else metadata_spans:
            lower_span = span.lower()
            if any(token in lower_span for token in ("stockholm", "sweden", "göteborg", "gothenburg", "södertälje")):
                location = span
                break
        if not location and metadata_spans:
            location = metadata_spans[-1]

        jobs.append(
            {
                "headline": headline,
                "description": department,
                "location": location,
                "source_url": source_url,
            }
        )
    return jobs


def _pick_jobposting_jsonld(html_text: str) -> dict[str, Any] | None:
    for match in _JSONLD_RE.finditer(html_text):
        body = match.group("body") or ""
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            continue

        candidates = payload if isinstance(payload, list) else [payload]
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            type_value = candidate.get("@type")
            types = type_value if isinstance(type_value, list) else [type_value]
            normalized = {str(item).strip().lower() for item in types if item}
            if "jobposting" in normalized:
                return candidate
    return None


def _extract_jobposting_location(payload: dict[str, Any]) -> str:
    job_location = payload.get("jobLocation")
    candidates = job_location if isinstance(job_location, list) else [job_location]
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        address = candidate.get("address")
        if isinstance(address, dict):
            parts = [
                str(address.get("addressLocality") or "").strip(),
                str(address.get("addressRegion") or "").strip(),
                str(address.get("addressCountry") or "").strip(),
            ]
            location = ", ".join(part for part in parts if part)
            if location:
                return location
    return ""


def _looks_like_potential_tech_title(headline: str, description: str) -> bool:
    combined = f"{headline} {description}".lower()
    return any(token in combined for token in _TECH_TITLE_HINTS)


def _enrich_teamtailor_job_from_detail(
    job: dict[str, str],
    *,
    timeout_seconds: int,
) -> dict[str, str]:
    source_url = str(job.get("source_url") or "").strip()
    if not source_url:
        return job

    detail_html, _, _ = _request_teamtailor_html(source_url, timeout_seconds=timeout_seconds)
    payload = _pick_jobposting_jsonld(detail_html)
    if not payload:
        return job

    enriched = dict(job)
    description = _clean_html_text(str(payload.get("description") or ""))
    if description:
        enriched["description"] = description

    title = _clean_html_text(str(payload.get("title") or ""))
    if title:
        enriched["headline"] = title

    location = _extract_jobposting_location(payload)
    if location:
        enriched["location"] = location

    date_posted = str(payload.get("datePosted") or "").strip()
    if date_posted:
        enriched["publication_date"] = date_posted

    language = str(payload.get("inLanguage") or "").strip()
    if language:
        enriched["lang"] = language[:5].lower()

    return enriched


def _fetch_teamtailor_custom_site_jobs(
    feed: CompanyFeed,
    *,
    timeout_seconds: int,
    max_rows: int,
    max_http: int,
) -> FeedFetchResult:
    base_url = _normalize_teamtailor_base_url(feed.slug_or_url)
    candidate_urls = []
    jobs_url = base_url + "/jobs"
    candidate_urls.append(jobs_url)
    if jobs_url != feed.slug_or_url:
        candidate_urls.append(feed.slug_or_url)

    html_text = ""
    html_status = 0
    endpoint_url = jobs_url
    error: str | None = None

    for candidate in candidate_urls:
        try:
            html_text, html_status, endpoint_url = _request_teamtailor_html(candidate, timeout_seconds=timeout_seconds)
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
            continue
        if html_status < 400 and "jobs/" in html_text:
            break
    else:
        return FeedFetchResult(
            rows=[],
            http_requests=1,
            http_status=html_status or None,
            endpoint_url=endpoint_url,
            error=error or f"http_{html_status or 'unknown'}",
            provider_status="environment_dns_failure"
            if error_indicates_dns_failure(error)
            else "wrong_provider_or_slug",
        )

    extracted_jobs = _extract_teamtailor_html_jobs(html_text, base_url=base_url)
    provider_rows = len(extracted_jobs)
    rows: list[dict[str, Any]] = []
    http_requests = 1
    for index, job in enumerate(extracted_jobs, start=1):
        headline = job.get("headline", "").strip()
        description = job.get("description", "").strip()
        location = job.get("location", "").strip()
        if not headline:
            continue
        if not matches_location(location, feed.location_filters):
            continue

        keyword_text = f"{headline} {description}"
        listing_keyword_match = matches_any_keyword(keyword_text, feed.keywords_any)
        title_hint_match = _looks_like_potential_tech_title(headline, description)
        if not listing_keyword_match and not title_hint_match:
            continue

        needs_detail = len(description) < 80 or (title_hint_match and not listing_keyword_match)
        if needs_detail and http_requests < max_http:
            try:
                job = _enrich_teamtailor_job_from_detail(job, timeout_seconds=timeout_seconds)
                http_requests += 1
                headline = job.get("headline", "").strip()
                description = job.get("description", "").strip()
                location = job.get("location", "").strip()
                keyword_text = f"{headline} {description}"
                listing_keyword_match = matches_any_keyword(keyword_text, feed.keywords_any)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Teamtailor detail fetch failed for %s: %s", job.get("source_url"), exc)

        if not matches_location(location, feed.location_filters):
            continue
        if not listing_keyword_match:
            continue

        rows.append(
            {
                "id": f"teamtailor:{feed.feed_key}:{index}",
                "headline": headline,
                "description": description,
                "employer_name": feed.company_canonical,
                "workplace_address": {
                    "city": location,
                    "municipality": location,
                    "region": location,
                },
                "source_url": job.get("source_url"),
                "publication_date": job.get("publication_date"),
                "updated_at": job.get("publication_date"),
                "source_name": "teamtailor",
                "source_provider": "teamtailor",
                "source_kind": "direct_company_ats",
                "source_company_key": feed.company_canonical,
                "is_direct_company_source": True,
                "lang": job.get("lang") or "en",
            }
        )
        if len(rows) >= max_rows:
            break

    return FeedFetchResult(
        rows=rows,
        http_requests=http_requests,
        http_status=html_status,
        endpoint_url=endpoint_url,
        provider_rows_before_filters=provider_rows,
        provider_status="provider_present_but_zero_matching_rows" if provider_rows > 0 and not rows else None,
    )


def _pick(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ""):
            return value
    return None


def _request_teamtailor_json(feed: CompanyFeed, *, timeout_seconds: int) -> tuple[Any, int, str]:
    if feed.slug_or_url.startswith("http://") or feed.slug_or_url.startswith("https://"):
        base_url = _normalize_teamtailor_base_url(feed.slug_or_url)
        endpoint = base_url + "/jobs.json"
    else:
        endpoint = f"https://{feed.slug_or_url}.teamtailor.com/jobs.json"

    params: dict[str, Any] = {}
    if feed.location_filters:
        params["location"] = feed.location_filters[0]

    headers = {"accept": "application/json"}

    def _do_request() -> requests.Response:
        response = requests.get(endpoint, params=params, timeout=timeout_seconds, headers=headers)
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient Teamtailor status {response.status_code} for {feed.feed_key}",
                response=response,
            )
        return response

    try:
        response = run_with_backoff(
            _do_request,
            retries=3,
            context=f"teamtailor:{feed.feed_key}",
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
            headers=headers,
            timeout_seconds=timeout_seconds,
        )
        return requests.models.complexjson.loads(body), status, effective_url


def fetch_teamtailor_jobs(
    feed: CompanyFeed,
    *,
    timeout_seconds: int,
    max_rows: int,
    max_http: int = 1,
) -> FeedFetchResult:
    if feed.slug_or_url.startswith("http://") or feed.slug_or_url.startswith("https://"):
        return _fetch_teamtailor_custom_site_jobs(
            feed,
            timeout_seconds=timeout_seconds,
            max_rows=max_rows,
            max_http=max_http,
        )

    try:
        payload, http_status, endpoint_url = _request_teamtailor_json(feed, timeout_seconds=timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Teamtailor fetch failed for %s: %s", feed.feed_key, exc)
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

    jobs: list[dict[str, Any]] = []
    if isinstance(payload, list):
        jobs = [row for row in payload if isinstance(row, dict)]
    elif isinstance(payload, dict):
        for key in ("jobs", "data", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                jobs = [row for row in value if isinstance(row, dict)]
                break

    rows: list[dict[str, Any]] = []
    for job in jobs:
        headline = str(_pick(job, "title", "headline", "name") or "").strip()
        description = str(_pick(job, "description", "body", "summary", "content") or "").strip()
        location = str(_pick(job, "location", "city", "municipality", "region") or "").strip()

        if not matches_location(location, feed.location_filters):
            continue
        if not matches_any_keyword(f"{headline} {description}", feed.keywords_any):
            continue

        job_id = _pick(job, "id", "uuid", "external_id")
        if job_id is None:
            continue

        rows.append(
            {
                "id": f"teamtailor:{feed.feed_key}:{job_id}",
                "headline": headline,
                "description": description,
                "employer_name": feed.company_canonical,
                "workplace_address": {
                    "city": location,
                    "municipality": location,
                    "region": location,
                },
                "source_url": _pick(job, "url", "apply_url", "external_url", "source_url"),
                "publication_date": _pick(job, "published_at", "created_at", "created"),
                "updated_at": _pick(job, "updated_at", "modified", "published_at", "created_at"),
                "source_name": "teamtailor",
                "source_provider": "teamtailor",
                "source_kind": "direct_company_ats",
                "source_company_key": feed.company_canonical,
                "is_direct_company_source": True,
                "lang": "en",
            }
        )
        if len(rows) >= max_rows:
            break

    return FeedFetchResult(rows=rows, http_requests=1, http_status=http_status, endpoint_url=endpoint_url)
