from __future__ import annotations

import re
from dataclasses import dataclass

from .target_profile import TargetProfile


ROLE_PATTERNS: dict[str, tuple[str, ...]] = {
    "backend": (
        r"\bbackend\b",
        r"\bback-end\b",
        r"\bpython\b",
        r"\bjava\b",
        r"\bnode\b",
        r"\bapi\b",
        r"\bmicroservice",
    ),
    "frontend": (r"\bfrontend\b", r"\bfront-end\b", r"\breact\b", r"\bvue\b", r"\bangular\b"),
    "full_stack": (r"\bfull\s*stack\b", r"\bfullstack\b"),
    "data": (r"\bdata engineer\b", r"\bdata platform\b", r"\betl\b", r"\bspark\b", r"\bdbt\b"),
    "ml_ai": (r"\bmachine learning\b", r"\bml engineer\b", r"\bai engineer\b", r"\bllm\b"),
    "devops_platform": (
        r"\bdevops\b",
        r"\bsre\b",
        r"\bplatform engineer\b",
        r"\bkubernetes\b",
        r"\bterraform\b",
    ),
    "qa_test": (r"\bqa\b", r"\btest engineer\b", r"\bautomation test\b", r"\bsdet\b"),
    "security": (r"\bsecurity engineer\b", r"\bapplication security\b", r"\bcybersecurity\b"),
    "product_other": (r"\bproduct owner\b", r"\bproduct manager\b", r"\bbusiness analyst\b"),
}


@dataclass(frozen=True)
class ClassificationResult:
    role_family: str
    relevance_score: int
    reason_codes: list[str]
    is_target_role: bool
    is_noise: bool


def _matches(patterns: tuple[str, ...], text: str) -> int:
    return sum(1 for p in patterns if re.search(p, text, flags=re.IGNORECASE))


def classify_job(job: dict, profile: TargetProfile) -> ClassificationResult:
    headline = str(job.get("headline") or "")
    description = str(job.get("description") or "")
    employer_name = str(job.get("employer_name") or "").lower()
    region = str(job.get("region") or "").lower()
    region_code = str(job.get("region_code") or "")
    lang = str(job.get("lang") or "").lower()
    remote_flag = bool(job.get("remote_flag"))

    text = f"{headline} {description}".lower()
    reason_codes: list[str] = []

    scores = {family: _matches(patterns, text) for family, patterns in ROLE_PATTERNS.items()}
    role_family = "noise"
    max_hits = max(scores.values() or [0])
    if max_hits > 0:
        for family, hits in scores.items():
            if hits == max_hits:
                role_family = family
                break

    scoring = profile.scoring
    relevance_score = 0

    has_exclusion = any(word in text for word in profile.exclude_domains)
    if has_exclusion:
        reason_codes.append("excluded_domain_hit")
        relevance_score -= scoring["exclusion_penalty"]
        role_family = "noise"

    if role_family != "noise":
        reason_codes.append("title_allowlist_match")
        relevance_score += scoring["title_allowlist_weight"]

    if role_family in profile.include_role_families or role_family in profile.soft_include_role_families:
        relevance_score += scoring["role_family_weight"]

    if employer_name and employer_name in profile.watched_companies:
        reason_codes.append("company_watched")
        relevance_score += scoring["company_watch_weight"]

    if region_code in profile.region_codes or region in profile.region_names:
        reason_codes.append("region_matched")
        relevance_score += scoring["region_weight"]

    if lang in profile.preferred_languages:
        reason_codes.append("language_matched")
        relevance_score += scoring["language_weight"]

    if remote_flag and profile.remote_preference in {"remote_only", "remote_or_hybrid"}:
        reason_codes.append("remote_matched")
        relevance_score += scoring["remote_weight"]

    stretch_hit = any(skill in text for skill in profile.stretch_skills)
    if stretch_hit:
        reason_codes.append("missing_skill_stretch")
        relevance_score += scoring["stretch_weight"]

    relevance_score = max(-100, min(100, relevance_score))

    is_target_role = (
        role_family in profile.include_role_families
        and relevance_score >= scoring["minimum_target_score"]
        and not has_exclusion
    )

    is_noise = (
        has_exclusion
        or role_family == "noise"
        or relevance_score <= scoring["noise_threshold"]
    )

    if is_noise:
        is_target_role = False
        role_family = "noise"

    return ClassificationResult(
        role_family=role_family,
        relevance_score=relevance_score,
        reason_codes=list(dict.fromkeys(reason_codes)),
        is_target_role=is_target_role,
        is_noise=is_noise,
    )
