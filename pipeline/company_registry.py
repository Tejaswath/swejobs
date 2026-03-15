from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_COMPANY_REGISTRY_PATH = "pipeline/config/company_registry.json"
DEFAULT_PROVIDER_ORDER = (
    "lever",
    "greenhouse",
    "teamtailor",
    "smartrecruiters",
    "workday",
    "html_fallback",
)
ALLOWED_REGISTRY_STATUSES = {"connected", "planned", "blocked", "html_fallback_candidate"}


def _normalize_company_name(value: str) -> str:
    text = "".join(ch.lower() if ch.isalnum() else " " for ch in str(value)).strip()
    tokens = [token for token in text.split() if token]
    return " ".join(tokens)


def _as_tuple_strings(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        normalized = value.strip()
        return (normalized,) if normalized else ()
    if not isinstance(value, list):
        return ()
    result: list[str] = []
    for item in value:
        text = str(item).strip()
        if text:
            result.append(text)
    return tuple(result)


@dataclass(frozen=True)
class CompanyRegistryEntry:
    company_canonical: str
    display_name: str
    priority_tier: str
    category: str
    status: str
    provider: str | None
    provider_identifier: str | None
    provider_order: tuple[str, ...]
    markets: tuple[str, ...]
    notes: str
    aliases: tuple[str, ...] = ()
    career_page_url: str | None = None


def load_company_registry(config_path: str = DEFAULT_COMPANY_REGISTRY_PATH) -> list[CompanyRegistryEntry]:
    path = Path(config_path)
    if not path.exists():
        return []

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return []

    entries = payload.get("companies")
    if not isinstance(entries, list):
        return []

    companies: list[CompanyRegistryEntry] = []
    for row in entries:
        if not isinstance(row, dict):
            continue

        company_canonical = _normalize_company_name(str(row.get("company_canonical") or ""))
        display_name = str(row.get("display_name") or "").strip()
        priority_tier = str(row.get("priority_tier") or "C").strip().upper()
        category = str(row.get("category") or "unknown").strip().lower()
        status = str(row.get("status") or "planned").strip().lower()
        provider = str(row.get("provider") or "").strip().lower() or None
        provider_identifier = str(row.get("provider_identifier") or "").strip() or None
        notes = str(row.get("notes") or "").strip()

        if not company_canonical or not display_name:
            continue
        if priority_tier not in {"A", "B", "C"}:
            priority_tier = "C"
        if status not in ALLOWED_REGISTRY_STATUSES:
            status = "planned"

        provider_order = _as_tuple_strings(row.get("provider_order")) or DEFAULT_PROVIDER_ORDER
        markets = _as_tuple_strings(row.get("markets"))
        aliases = tuple(
            alias for alias in (_normalize_company_name(v) for v in _as_tuple_strings(row.get("aliases"))) if alias
        )
        career_page_url = str(row.get("career_page_url") or "").strip() or None

        companies.append(
            CompanyRegistryEntry(
                company_canonical=company_canonical,
                display_name=display_name,
                priority_tier=priority_tier,
                category=category,
                status=status,
                provider=provider,
                provider_identifier=provider_identifier,
                provider_order=provider_order,
                markets=markets,
                notes=notes,
                aliases=aliases,
                career_page_url=career_page_url,
            )
        )

    companies.sort(key=lambda item: (item.priority_tier, item.display_name.lower()))
    return companies


def company_registry_map(
    config_path: str = DEFAULT_COMPANY_REGISTRY_PATH,
) -> dict[str, CompanyRegistryEntry]:
    entries = load_company_registry(config_path)
    result: dict[str, CompanyRegistryEntry] = {}
    for entry in entries:
        result[entry.company_canonical] = entry
        for alias in entry.aliases:
            result.setdefault(alias, entry)
    return result
