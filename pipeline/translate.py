from __future__ import annotations

import html
import logging
import time
from typing import Any

import requests

from .storage import SupabaseStorage

logger = logging.getLogger(__name__)

MAX_RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.0
GOOGLE_CLOUD_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"
GOOGLE_FREE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _split_for_translation(text: str, *, max_chars: int, chunk_size: int = 4500) -> list[str]:
    candidate = text.strip()[:max_chars]
    if not candidate:
        return []

    chunks: list[str] = []
    remaining = candidate
    while remaining:
        if len(remaining) <= chunk_size:
            chunks.append(remaining)
            break

        chunk = remaining[:chunk_size]
        boundary = max(chunk.rfind(". "), chunk.rfind("\n"))
        if boundary > 2000:
            chunk = remaining[: boundary + 1]
        chunks.append(chunk)
        remaining = remaining[len(chunk) :].lstrip()

    return chunks


def _translate_google_cloud(
    *,
    text: str,
    api_key: str,
    api_url: str,
    timeout_seconds: int,
    max_chars: int,
) -> str | None:
    if not api_key:
        return None

    chunks = _split_for_translation(text, max_chars=max_chars)
    if not chunks:
        return None

    translated_parts: list[str] = []
    for chunk_index, chunk in enumerate(chunks):
        success = False
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = requests.post(
                    api_url or GOOGLE_CLOUD_TRANSLATE_URL,
                    params={"key": api_key},
                    json={
                        "q": chunk,
                        "source": "sv",
                        "target": "en",
                        "format": "text",
                    },
                    timeout=max(5, timeout_seconds),
                )
                response.raise_for_status()
                payload = response.json()
                translations = (payload.get("data") or {}).get("translations") or []
                translated = ""
                if translations:
                    translated = html.unescape(str(translations[0].get("translatedText") or "")).strip()
                if translated:
                    translated_parts.append(translated)
                    success = True
                    break
            except (requests.RequestException, ValueError, TypeError) as exc:
                logger.warning(
                    "Google translation failed (chunk=%s attempt=%s): %s",
                    chunk_index + 1,
                    attempt + 1,
                    exc,
                )
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))

        if not success:
            return None

        if chunk_index < len(chunks) - 1:
            time.sleep(0.2)

    return " ".join(translated_parts).strip() or None


def _translate_google_free(
    *,
    text: str,
    api_url: str,
    timeout_seconds: int,
    max_chars: int,
) -> str | None:
    chunks = _split_for_translation(text, max_chars=max_chars)
    if not chunks:
        return None

    translated_parts: list[str] = []
    for chunk_index, chunk in enumerate(chunks):
        success = False
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = requests.get(
                    api_url or GOOGLE_FREE_TRANSLATE_URL,
                    params={
                        "client": "gtx",
                        "sl": "sv",
                        "tl": "en",
                        "dt": "t",
                        "q": chunk,
                    },
                    timeout=max(5, timeout_seconds),
                )
                response.raise_for_status()
                payload = response.json()
                translated_segments = payload[0] if isinstance(payload, list) and payload else []
                translated = "".join(
                    str(segment[0])
                    for segment in translated_segments
                    if isinstance(segment, list) and segment and segment[0]
                ).strip()
                if translated:
                    translated_parts.append(translated)
                    success = True
                    break
            except (requests.RequestException, ValueError, TypeError, IndexError) as exc:
                logger.warning(
                    "Free Google translation failed (chunk=%s attempt=%s): %s",
                    chunk_index + 1,
                    attempt + 1,
                    exc,
                )
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))

        if not success:
            return None

        if chunk_index < len(chunks) - 1:
            time.sleep(0.3)

    return " ".join(translated_parts).strip() or None


def translate_sv_to_en(
    *,
    text: str,
    provider: str,
    api_key: str,
    api_url: str,
    timeout_seconds: int,
    max_chars: int,
) -> str | None:
    candidate = _coerce_text(text)
    if len(candidate) < 10:
        return None

    normalized_provider = provider.strip().lower()
    if normalized_provider in {"google_cloud", "google"}:
        return _translate_google_cloud(
            text=candidate,
            api_key=api_key,
            api_url=api_url or GOOGLE_CLOUD_TRANSLATE_URL,
            timeout_seconds=timeout_seconds,
            max_chars=max_chars,
        )
    if normalized_provider in {"google_free", "google_free_web", "gtx"}:
        return _translate_google_free(
            text=candidate,
            api_url=api_url or GOOGLE_FREE_TRANSLATE_URL,
            timeout_seconds=timeout_seconds,
            max_chars=max_chars,
        )

    logger.warning("Unsupported translation provider '%s'.", normalized_provider)
    return None


def batch_translate_jobs(
    *,
    storage: SupabaseStorage,
    provider: str,
    api_url: str,
    api_key: str,
    batch_size: int,
    max_chars: int,
    timeout_seconds: int,
) -> int:
    jobs = storage.fetch_jobs_needing_translation(limit=batch_size)
    if not jobs:
        return 0

    translated_rows = 0
    for row in jobs:
        job_id = int(row["id"])
        source_headline = _coerce_text(row.get("headline"))
        source_description = _coerce_text(row.get("description"))
        headline_en = _coerce_text(row.get("headline_en"))
        description_en = _coerce_text(row.get("description_en"))

        update_payload: dict[str, Any] = {}

        if not headline_en and source_headline:
            translated_headline = translate_sv_to_en(
                text=source_headline,
                provider=provider,
                api_key=api_key,
                api_url=api_url,
                timeout_seconds=timeout_seconds,
                max_chars=max_chars,
            )
            if translated_headline:
                update_payload["headline_en"] = translated_headline

        if not description_en and source_description:
            translated_description = translate_sv_to_en(
                text=source_description,
                provider=provider,
                api_key=api_key,
                api_url=api_url,
                timeout_seconds=timeout_seconds,
                max_chars=max_chars,
            )
            if translated_description:
                update_payload["description_en"] = translated_description

        if not update_payload:
            continue

        storage.update_job_translation(job_id=job_id, values=update_payload)
        translated_rows += 1
        time.sleep(0.1)

    return translated_rows
