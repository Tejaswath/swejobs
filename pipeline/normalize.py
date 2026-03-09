from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any


def _get_path(obj: dict[str, Any], path: str) -> Any:
    current: Any = obj
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
        if current is None:
            return None
    return current


def _first(obj: dict[str, Any], *paths: str) -> Any:
    for path in paths:
        value = _get_path(obj, path)
        if value not in (None, ""):
            return value
    return None


def _to_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, dict):
        for key in ("text", "value", "label", "description"):
            if key in value and value[key]:
                return _to_text(value[key])
        return json.dumps(value, ensure_ascii=True)
    if isinstance(value, list):
        parts = [_to_text(v) for v in value]
        joined = " ".join([p for p in parts if p])
        return joined or None
    return str(value)


def _stable_int_id(raw_id: Any) -> int:
    if raw_id is None:
        raise ValueError("Job id is missing")
    if isinstance(raw_id, int):
        return raw_id

    raw_str = str(raw_id).strip()
    if raw_str.isdigit():
        return int(raw_str)

    digest = hashlib.md5(raw_str.encode("utf-8"), usedforsecurity=False).hexdigest()
    return int(digest[:15], 16)


def _parse_datetime(value: Any) -> str | None:
    text = _to_text(value)
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC).isoformat()
    except ValueError:
        return None


def _detect_language(raw: dict[str, Any], headline: str, description: str) -> str:
    language = (_to_text(_first(raw, "language", "source.language")) or "").lower()
    if language in {"sv", "swe", "swedish"}:
        return "sv"
    if language in {"en", "eng", "english"}:
        return "en"

    text = f"{headline} {description}".lower()
    has_swedish = bool(re.search(r"[åäö]", text))
    has_english = any(token in text for token in ("the", "with", "experience", "engineer"))

    if has_swedish and has_english:
        return "mixed"
    if has_swedish:
        return "sv"
    return "en"


def _detect_remote(raw: dict[str, Any], headline: str, description: str) -> bool:
    direct = _first(raw, "remote", "workplace.remote", "working_conditions.remote")
    if isinstance(direct, bool):
        return direct

    text = f"{headline} {description}".lower()
    return any(token in text for token in ("remote", "distans", "hybrid"))


def extract_tags(raw: dict[str, Any], headline: str, description: str) -> list[str]:
    tags: set[str] = set()
    candidates = _first(raw, "keywords", "skills", "competence", "must_have")
    if isinstance(candidates, list):
        for item in candidates:
            text = _to_text(item)
            if text:
                tags.add(text.lower().strip())

    combined = f"{headline} {description}".lower()
    for token in (
        "python",
        "java",
        "javascript",
        "typescript",
        "react",
        "kubernetes",
        "terraform",
        "docker",
        "sql",
        "aws",
        "azure",
        "gcp",
        "spark",
        "dbt",
    ):
        if re.search(rf"\b{re.escape(token)}\b", combined):
            tags.add(token)

    return sorted(tags)


def normalize_job(raw: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    now = datetime.now(UTC).isoformat()

    job_id = _stable_int_id(_first(raw, "id", "uuid", "external_id", "ad_id"))
    headline = _to_text(_first(raw, "headline", "title", "occupation.label")) or "Untitled"
    description = _to_text(_first(raw, "description", "description.text", "summary")) or ""

    employer_name = _to_text(_first(raw, "employer.name", "employer_name", "company.name", "organization"))
    employer_id = _to_text(_first(raw, "employer.id", "employer.organization_number", "company.id"))

    municipality = _to_text(_first(raw, "workplace_address.municipality", "municipality"))
    municipality_code = _to_text(_first(raw, "workplace_address.municipality_code", "municipality_code"))
    region = _to_text(_first(raw, "workplace_address.region", "region"))
    region_code = _to_text(_first(raw, "workplace_address.region_code", "region_code"))

    occupation_id = _to_text(_first(raw, "occupation.concept_id", "occupation_id"))
    occupation_label = _to_text(_first(raw, "occupation.label", "occupation_label"))
    ssyk_code = _to_text(_first(raw, "occupation.ssyk", "ssyk_code"))

    employment_type = _to_text(_first(raw, "employment_type.label", "employment_type"))
    working_hours = _to_text(_first(raw, "working_hours_type.label", "working_hours"))

    source_url = _to_text(_first(raw, "webpage_url", "source_url", "application_details.url"))
    application_deadline = _to_text(_first(raw, "application_deadline", "last_application_date"))

    published_at = _parse_datetime(_first(raw, "publication_date", "published_at", "created"))
    updated_at = _parse_datetime(_first(raw, "updated_at", "modified")) or now

    lang = _detect_language(raw, headline, description)
    remote_flag = _detect_remote(raw, headline, description)

    is_removed = bool(_first(raw, "removed", "is_removed", "deleted", "unpublished"))
    is_active = not is_removed
    removed_at = now if is_removed else None

    tags = extract_tags(raw, headline, description)

    normalized = {
        "id": job_id,
        "headline": headline,
        "description": description,
        "employer_name": employer_name,
        "employer_id": employer_id,
        "municipality": municipality,
        "municipality_code": municipality_code,
        "region": region,
        "region_code": region_code,
        "occupation_id": occupation_id,
        "occupation_label": occupation_label,
        "ssyk_code": ssyk_code,
        "employment_type": employment_type,
        "working_hours": working_hours,
        "application_deadline": application_deadline,
        "source_url": source_url,
        "lang": lang,
        "remote_flag": remote_flag,
        "is_active": is_active,
        "published_at": published_at,
        "updated_at": updated_at,
        "removed_at": removed_at,
        "ingested_at": now,
        "raw_json": raw,
    }

    return normalized, tags
