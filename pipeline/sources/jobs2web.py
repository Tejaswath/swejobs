from __future__ import annotations

import html
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

HTML_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

ROW_RE = re.compile(r"<tr class=\"data-row\">(.*?)</tr>", re.IGNORECASE | re.DOTALL)
LINK_RE = re.compile(
    r'<a[^>]+class="jobTitle-link"[^>]+href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)
LOCATION_RE = re.compile(r'<span class="jobLocation">\s*(.*?)\s*</span>', re.IGNORECASE | re.DOTALL)
DATE_RE = re.compile(r'<span class="jobDate">\s*(.*?)\s*</span>', re.IGNORECASE | re.DOTALL)
DEPARTMENT_RE = re.compile(r'<span class="jobDepartment">\s*(.*?)\s*</span>', re.IGNORECASE | re.DOTALL)
PAGINATION_RE = re.compile(
    r"Results\s*<b>(?P<start>\d+)\s*[–-]\s*(?P<end>\d+)</b>\s*of\s*<b>(?P<total>\d+)</b>",
    re.IGNORECASE,
)
ITEMPROP_RE = re.compile(
    r'itemprop="(?P<prop>title|description)"[^>]*>\s*(?P<value>.*?)\s*</span>',
    re.IGNORECASE | re.DOTALL,
)
JOB_LOCATION_RE = re.compile(
    r'<p[^>]+class="jobLocation job-location-inline"[^>]*>\s*<span class="jobGeoLocation">(.*?)</span>',
    re.IGNORECASE | re.DOTALL,
)
DATE_POSTED_RE = re.compile(r'itemprop="datePosted"\s+content="([^"]+)"', re.IGNORECASE)
EMPLOYER_RE = re.compile(r'itemprop="hiringOrganization"\s+content="([^"]+)"', re.IGNORECASE)


def _strip_html(value: str) -> str:
    text = html.unescape(value or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _parse_listing_rows(html_text: str, *, base_url: str) -> tuple[list[dict[str, str]], int]:
    matches = PAGINATION_RE.search(html_text)
    total_rows = 0
    if matches:
        try:
            total_rows = int(matches.group("total"))
        except ValueError:
            total_rows = 0

    rows: list[dict[str, str]] = []
    for raw_row in ROW_RE.findall(html_text):
        link_match = LINK_RE.search(raw_row)
        if not link_match:
            continue
        title = _strip_html(link_match.group("title"))
        href = urljoin(base_url, html.unescape(link_match.group("href")))
        location_match = LOCATION_RE.search(raw_row)
        date_match = DATE_RE.search(raw_row)
        department_match = DEPARTMENT_RE.search(raw_row)
        location = _strip_html(location_match.group(1)) if location_match else ""
        posted_at = _strip_html(date_match.group(1)) if date_match else ""
        department = _strip_html(department_match.group(1)) if department_match else ""
        rows.append(
            {
                "headline": title,
                "detail_url": href,
                "location": location,
                "publication_date": posted_at,
                "department": department,
            }
        )
    return rows, total_rows


def _request_html(url: str, *, timeout_seconds: int) -> tuple[str, int, str]:
    def _do_request() -> requests.Response:
        response = requests.get(
            url,
            timeout=timeout_seconds,
            headers=HTML_HEADERS,
            allow_redirects=True,
        )
        if response.status_code in {429, 500, 502, 503, 504}:
            raise requests.HTTPError(
                f"Transient Jobs2Web status {response.status_code} for {url}",
                response=response,
            )
        return response

    try:
        response = run_with_backoff(
            _do_request,
            retries=4,
            context=f"jobs2web:{url}",
            retriable_exceptions=(requests.RequestException, requests.HTTPError),
            should_retry=lambda exc: not error_indicates_dns_failure(str(exc)),
        )
        return response.text or "", int(response.status_code), str(response.url or url)
    except Exception as exc:  # noqa: BLE001
        if not error_indicates_dns_failure(str(exc)):
            raise
        body, status, effective_url = curl_fetch_text(
            url,
            headers=HTML_HEADERS,
            timeout_seconds=timeout_seconds,
        )
        return body, status, effective_url


def _enrich_detail(detail_url: str, *, timeout_seconds: int) -> tuple[dict[str, str], int]:
    html_text, http_status, _ = _request_html(detail_url, timeout_seconds=timeout_seconds)
    result: dict[str, str] = {}
    for itemprop in ITEMPROP_RE.finditer(html_text):
        result[itemprop.group("prop")] = _strip_html(itemprop.group("value"))
    location_match = JOB_LOCATION_RE.search(html_text)
    if location_match:
        result["location"] = _strip_html(location_match.group(1))
    date_match = DATE_POSTED_RE.search(html_text)
    if date_match:
        result["publication_date"] = _strip_html(date_match.group(1))
    employer_match = EMPLOYER_RE.search(html_text)
    if employer_match:
        result["employer_name"] = _strip_html(employer_match.group(1))
    return result, http_status


def fetch_jobs2web_jobs(
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
            location_filtering_supported=True,
            error="jobs2web_requires_absolute_url",
        )

    search_url = feed.slug_or_url.rstrip("/") + "/search/?q=&locationsearch=Sweden"

    try:
        html_text, http_status, effective_url = _request_html(search_url, timeout_seconds=timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        logger.warning("Jobs2Web fetch failed for %s: %s", feed.feed_key, exc)
        return FeedFetchResult(
            rows=[],
            http_requests=1,
            http_status=None,
            endpoint_url=search_url,
            location_filtering_supported=True,
            error=message,
            provider_status="environment_dns_failure" if error_indicates_dns_failure(message) else None,
        )

    if http_status >= 400:
        return FeedFetchResult(
            rows=[],
            http_requests=1,
            http_status=http_status,
            endpoint_url=effective_url,
            location_filtering_supported=True,
            error=f"http_{http_status}",
            provider_status="blocked_by_bot_protection" if http_status in {401, 403} else "wrong_provider_or_slug",
        )

    listing_rows, total_rows = _parse_listing_rows(html_text, base_url=effective_url)
    provider_rows_before_filters = len(listing_rows) or total_rows
    if not listing_rows:
        return FeedFetchResult(
            rows=[],
            http_requests=1,
            http_status=http_status,
            endpoint_url=effective_url,
            location_filtering_supported=True,
            provider_rows_before_filters=provider_rows_before_filters,
            provider_status="provider_present_but_zero_matching_rows" if provider_rows_before_filters > 0 else None,
        )

    prepared: list[dict[str, Any]] = []
    http_requests = 1

    for index, row in enumerate(listing_rows, start=1):
        headline = row["headline"]
        location = row["location"]
        department = row["department"]
        publication_date = row["publication_date"]
        description = department

        if not matches_location(location, feed.location_filters):
            continue
        if not matches_any_keyword(f"{headline} {department}", feed.keywords_any):
            continue

        if http_requests < max_http:
            try:
                detail, detail_status = _enrich_detail(row["detail_url"], timeout_seconds=timeout_seconds)
            except Exception:
                detail = {}
                detail_status = None
            else:
                http_requests += 1
                if detail_status and detail_status >= 400:
                    detail = {}

            headline = detail.get("title") or headline
            description = detail.get("description") or description
            location = detail.get("location") or location
            publication_date = detail.get("publication_date") or publication_date
            employer_name = detail.get("employer_name") or feed.display_name or feed.company_canonical
        else:
            employer_name = feed.display_name or feed.company_canonical

        prepared.append(
            {
                "id": f"jobs2web:{feed.feed_key}:{index}:{headline[:64]}",
                "headline": headline,
                "description": description,
                "employer_name": employer_name,
                "workplace_address": {
                    "city": location,
                    "region": location,
                    "municipality": location,
                },
                "source_url": row["detail_url"],
                "publication_date": publication_date,
                "updated_at": publication_date,
                "source_name": "jobs2web",
                "source_provider": "jobs2web",
                "source_kind": "direct_company_ats",
                "source_company_key": feed.company_canonical,
                "is_direct_company_source": True,
                "lang": "en",
            }
        )
        if len(prepared) >= max_rows:
            break

    provider_status = None
    if provider_rows_before_filters > 0 and not prepared:
        provider_status = "provider_present_but_zero_matching_rows"

    return FeedFetchResult(
        rows=prepared,
        http_requests=http_requests,
        http_status=http_status,
        endpoint_url=effective_url,
        location_filtering_supported=True,
        provider_rows_before_filters=provider_rows_before_filters,
        provider_status=provider_status,
    )
