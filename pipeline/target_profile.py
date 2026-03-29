from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


COMPANY_SUFFIX_TOKENS = {
    "ab",
    "aktiebolag",
    "ag",
    "gmbh",
    "group",
    "holding",
    "holdings",
    "inc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "plc",
    "asa",
    "oy",
    "publ",
}


def _normalize_company_name(value: str) -> str:
    text = "".join(ch.lower() if ch.isalnum() else " " for ch in value).strip()
    tokens = [token for token in text.split() if token]
    return " ".join(tokens)


def _strip_company_suffix_tokens(value: str) -> str:
    tokens = [token for token in value.split() if token]
    while len(tokens) > 1 and tokens[-1] in COMPANY_SUFFIX_TOKENS:
        tokens.pop()
    return " ".join(tokens)


def _token_overlap(left: set[str], right: set[str]) -> int:
    if not left or not right:
        return 0
    return len(left & right)


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return raw if isinstance(raw, dict) else {}


@dataclass(frozen=True)
class TargetProfile:
    data: dict[str, Any]
    company_tier_map: dict[str, str]
    company_alias_map: dict[str, str]

    @property
    def include_role_families(self) -> set[str]:
        return set(self.data.get("role_families", {}).get("include", []))

    @property
    def soft_include_role_families(self) -> set[str]:
        return set(self.data.get("role_families", {}).get("soft_include", []))

    @property
    def exclude_domains(self) -> set[str]:
        return set(self.data.get("role_families", {}).get("exclude_domains", []))

    @property
    def region_codes(self) -> set[str]:
        return set(self.data.get("regions", {}).get("include_codes", []))

    @property
    def region_names(self) -> set[str]:
        return {str(v).lower() for v in self.data.get("regions", {}).get("include_names", [])}

    @property
    def preferred_languages(self) -> set[str]:
        return set(self.data.get("language", {}).get("preferred", []))

    @property
    def remote_preference(self) -> str:
        return str(self.data.get("remote", {}).get("preference", "remote_or_hybrid"))

    @property
    def remote_keywords(self) -> set[str]:
        return {str(v).lower() for v in self.data.get("remote", {}).get("remote_keywords", [])}

    @property
    def stretch_skills(self) -> set[str]:
        return {str(v).lower() for v in self.data.get("skills", {}).get("stretch", [])}

    def resolve_company(self, employer_name: str | None) -> tuple[str, str]:
        if not employer_name:
            return "", "unknown"
        normalized = _normalize_company_name(employer_name)
        stripped = _strip_company_suffix_tokens(normalized)

        for candidate in (normalized, stripped):
            if not candidate:
                continue
            canonical = self.company_alias_map.get(candidate)
            if canonical:
                return canonical, self.company_tier_map.get(canonical, "unknown")
            if candidate in self.company_tier_map:
                return candidate, self.company_tier_map.get(candidate, "unknown")

        target_tokens = set(stripped.split()) if stripped else set(normalized.split())
        best_match: tuple[int, int, str] | None = None
        if target_tokens:
            for alias, canonical in self.company_alias_map.items():
                alias_tokens = set(_strip_company_suffix_tokens(alias).split())
                if not alias_tokens:
                    continue
                overlap = _token_overlap(target_tokens, alias_tokens)
                if overlap == 0:
                    continue
                subset_match = alias_tokens.issubset(target_tokens)
                ratio = overlap / max(1, len(alias_tokens))
                if not subset_match and ratio < 0.7:
                    continue
                if len(alias_tokens) == 1 and not subset_match:
                    continue
                ranking = (overlap, len(alias_tokens), canonical)
                if best_match is None or ranking > best_match:
                    best_match = ranking

        if best_match is not None:
            canonical = best_match[2]
            return canonical, self.company_tier_map.get(canonical, "unknown")

        canonical = stripped or normalized
        tier = self.company_tier_map.get(canonical, "unknown")
        return canonical, tier

    @property
    def main_companies(self) -> set[str]:
        return {
            name
            for name, tier in self.company_tier_map.items()
            if tier in {"A", "B"}
        }

    @property
    def watched_companies(self) -> set[str]:
        values = self.data.get("watched_companies", [])
        if not isinstance(values, list):
            return set()
        result: set[str] = set()
        for value in values:
            normalized = _normalize_company_name(str(value))
            if normalized:
                result.add(normalized)
        return result

    @property
    def scoring(self) -> dict[str, int]:
        defaults = {
            "minimum_target_score": 18,
            "noise_threshold": -20,
            "title_allowlist_weight": 18,
            "role_family_weight": 14,
            "soft_role_family_weight": 6,
            "company_watch_weight": 20,
            "main_company_tier_a_weight": 25,
            "main_company_tier_b_weight": 15,
            "main_company_tier_c_weight": 6,
            "entry_graduate_weight": 20,
            "entry_trainee_weight": 20,
            "entry_junior_weight": 15,
            "region_weight": 0,
            "language_weight": 8,
            "remote_weight": 6,
            "fresh_weight": 8,
            "stretch_weight": 4,
            "senior_penalty": 20,
            "years_3plus_penalty": 22,
            "swedish_required_penalty": 22,
            "consultancy_penalty": 12,
            "exclusion_penalty": 60,
        }
        incoming = self.data.get("scoring", {})
        if not isinstance(incoming, dict):
            incoming = {}

        parsed: dict[str, int] = dict(defaults)
        for key, value in incoming.items():
            if key in {"tie_break"}:
                continue
            try:
                parsed[key] = int(value)
            except (TypeError, ValueError):
                continue
        return parsed


def _load_company_tiers(path: Path) -> dict[str, str]:
    payload = _load_yaml(path)
    tiers = payload.get("tiers", {})
    if not isinstance(tiers, dict):
        return {}

    result: dict[str, str] = {}
    for tier, companies in tiers.items():
        tier_name = str(tier).strip().upper()
        if tier_name not in {"A", "B", "C"}:
            continue
        if not isinstance(companies, list):
            continue
        for company in companies:
            normalized = _normalize_company_name(str(company))
            if normalized:
                result[normalized] = tier_name
    return result


def _load_company_aliases(path: Path) -> dict[str, str]:
    payload = _load_yaml(path)
    aliases = payload.get("aliases", {})
    if not isinstance(aliases, dict):
        return {}
    result: dict[str, str] = {}
    for alias, canonical in aliases.items():
        normalized_alias = _normalize_company_name(str(alias))
        stripped_alias = _strip_company_suffix_tokens(normalized_alias)
        normalized_canonical = _normalize_company_name(str(canonical))
        stripped_canonical = _strip_company_suffix_tokens(normalized_canonical)
        if normalized_alias and normalized_canonical:
            result[normalized_alias] = normalized_canonical
            if stripped_alias:
                result.setdefault(stripped_alias, normalized_canonical)
            if stripped_canonical:
                result.setdefault(stripped_canonical, stripped_canonical)
    return result


def load_target_profile(path: str) -> TargetProfile:
    profile_path = Path(path)
    raw = yaml.safe_load(profile_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise RuntimeError(f"Target profile must be a mapping, got {type(raw)}")

    company_config = raw.get("company_maps", {})
    if not isinstance(company_config, dict):
        company_config = {}

    tiers_path = profile_path.parent / str(company_config.get("tiers_file", "company_tiers.yaml"))
    aliases_path = profile_path.parent / str(company_config.get("aliases_file", "company_aliases.yaml"))

    company_tier_map = _load_company_tiers(tiers_path)
    company_alias_map = _load_company_aliases(aliases_path)

    # Ensure canonical names also resolve to themselves.
    for company in list(company_tier_map.keys()):
        company_alias_map.setdefault(company, company)

    return TargetProfile(
        data=raw,
        company_tier_map=company_tier_map,
        company_alias_map=company_alias_map,
    )
