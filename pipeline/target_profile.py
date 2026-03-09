from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class TargetProfile:
    data: dict[str, Any]

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
    def watched_companies(self) -> set[str]:
        return {str(v).lower() for v in self.data.get("watched_companies", [])}

    @property
    def stretch_skills(self) -> set[str]:
        return {str(v).lower() for v in self.data.get("skills", {}).get("stretch", [])}

    @property
    def scoring(self) -> dict[str, int]:
        defaults = {
            "minimum_target_score": 25,
            "noise_threshold": 0,
            "title_allowlist_weight": 35,
            "role_family_weight": 25,
            "company_watch_weight": 20,
            "region_weight": 10,
            "language_weight": 10,
            "remote_weight": 10,
            "stretch_weight": 5,
            "exclusion_penalty": 60,
        }
        incoming = self.data.get("scoring", {})
        return {**defaults, **{k: int(v) for k, v in incoming.items()}}


def load_target_profile(path: str) -> TargetProfile:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise RuntimeError(f"Target profile must be a mapping, got {type(raw)}")
    return TargetProfile(data=raw)
