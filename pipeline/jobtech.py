from __future__ import annotations

import json
import logging
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from typing import Any

import requests

from .retry_utils import run_with_backoff

logger = logging.getLogger(__name__)


class JobTechClient:
    def __init__(
        self,
        *,
        snapshot_url: str,
        stream_url: str,
        taxonomy_url: str,
        api_key: str | None,
        timeout_seconds: int,
    ) -> None:
        self.snapshot_url = snapshot_url
        self.stream_url = stream_url
        self.taxonomy_url = taxonomy_url
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        if api_key:
            self.session.headers.update({"api-key": api_key})

    def _get(self, url: str, **kwargs: Any) -> requests.Response:
        def _request() -> requests.Response:
            response = self.session.get(url, timeout=self.timeout_seconds, **kwargs)
            if response.status_code == 429 or response.status_code >= 500:
                raise requests.HTTPError(
                    f"Transient status {response.status_code} for {url}",
                    response=response,
                )
            return response

        return run_with_backoff(
            _request,
            retries=6,
            context=f"GET {url}",
            retriable_exceptions=(requests.RequestException, requests.HTTPError),
        )

    @staticmethod
    def _format_stream_datetime(value: str | None, *, default_minutes_back: int = 5) -> str:
        if not value:
            value = (datetime.now(UTC) - timedelta(minutes=default_minutes_back)).isoformat()

        text = str(value).strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            # Already in API-friendly shape or unparseable; trim to second precision.
            return text[:19]

        if dt.tzinfo is not None:
            dt = dt.astimezone(UTC).replace(tzinfo=None)
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    def iter_snapshot(self, limit: int | None = None) -> Generator[dict[str, Any], None, None]:
        """Yield ads from snapshot endpoint supporting NDJSON and JSON payloads."""
        response = self._get(self.snapshot_url, stream=True)
        response.raise_for_status()

        emitted = 0
        content_type = (response.headers.get("content-type") or "").lower()
        if "ndjson" in content_type or "jsonl" in content_type:
            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Failed to parse snapshot NDJSON line")
                    continue

                if isinstance(item, dict):
                    yield item
                    emitted += 1
                    if limit is not None and emitted >= limit:
                        return
            return

        # Stream-parse JSON arrays without loading the entire snapshot in memory.
        decoder = json.JSONDecoder()
        buffer = ""
        top_level: str | None = None  # "array" | "object"

        for chunk in response.iter_content(chunk_size=64 * 1024, decode_unicode=True):
            if not chunk:
                continue
            buffer += chunk

            while True:
                buffer = buffer.lstrip()
                if not buffer:
                    break

                if top_level is None:
                    if buffer.startswith("["):
                        top_level = "array"
                        buffer = buffer[1:]
                        continue
                    top_level = "object"

                if top_level == "array":
                    buffer = buffer.lstrip()
                    if not buffer:
                        break
                    if buffer.startswith("]"):
                        return

                    try:
                        item, idx = decoder.raw_decode(buffer)
                    except json.JSONDecodeError:
                        break

                    buffer = buffer[idx:].lstrip()
                    if buffer.startswith(","):
                        buffer = buffer[1:]

                    if isinstance(item, dict):
                        yield item
                        emitted += 1
                        if limit is not None and emitted >= limit:
                            return
                    continue

                # top-level JSON object fallback
                try:
                    item, _ = decoder.raw_decode(buffer)
                except json.JSONDecodeError:
                    break
                if isinstance(item, dict):
                    yield item
                return

    def get_stream_events(self, since: str | None, limit: int | None = None) -> tuple[list[dict[str, Any]], str | None]:
        """Fetch one stream page and return (events, next_cursor)."""
        updated_after = self._format_stream_datetime(since, default_minutes_back=5)
        updated_before = self._format_stream_datetime(datetime.now(UTC).isoformat(), default_minutes_back=0)

        params: dict[str, Any] = {
            "updated-after": updated_after,
            "updated-before": updated_before,
        }
        if limit:
            params["limit"] = limit

        response = self._get(self.stream_url, params=params, headers={"accept": "application/json"})
        if response.status_code == 400:
            # Backwards-compatible fallback for older stream API versions.
            legacy_params: dict[str, Any] = {"date": updated_after}
            if limit:
                legacy_params["limit"] = limit
            response = self._get(self.stream_url, params=legacy_params, headers={"accept": "application/json"})

        response.raise_for_status()
        payload = response.json()

        events: list[dict[str, Any]] = []
        next_cursor: str | None = updated_before

        if isinstance(payload, list):
            events = [x for x in payload if isinstance(x, dict)]
        elif isinstance(payload, dict):
            next_cursor = (
                payload.get("next")
                or payload.get("next_cursor")
                or payload.get("cursor")
                or payload.get("last_timestamp")
            )
            for key in ("events", "ads", "items", "data", "hits"):
                candidate = payload.get(key)
                if isinstance(candidate, list):
                    events = [x for x in candidate if isinstance(x, dict)]
                    break

        return events, next_cursor

    def fetch_taxonomy(self, limit: int | None = None) -> list[dict[str, Any]]:
        response = self._get(self.taxonomy_url)
        response.raise_for_status()
        payload = response.json()

        items: list[dict[str, Any]] = []
        if isinstance(payload, list):
            items = [x for x in payload if isinstance(x, dict)]
        elif isinstance(payload, dict):
            for key in ("concepts", "data", "items", "hits"):
                candidate = payload.get(key)
                if isinstance(candidate, list):
                    items = [x for x in candidate if isinstance(x, dict)]
                    break

        if limit is not None:
            items = items[:limit]
        return items
