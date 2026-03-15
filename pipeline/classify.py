from __future__ import annotations

from datetime import UTC, datetime
import re
from dataclasses import dataclass
from typing import Any

from .target_profile import TargetProfile


ROLE_PATTERNS: dict[str, tuple[str, ...]] = {
    "full_stack": (
        r"\bfull[- ]?stack\b",
        r"\bfullstack\b",
        r"\bfullstackutvecklare\b",
    ),
    "software_engineering": (
        r"\bsoftware engineer\b",
        r"\bsoftware developer\b",
        r"\bapplication engineer\b",
        r"\bsystemutvecklare\b",
        r"\bmjukvaruutvecklare\b",
    ),
    "backend": (
        r"\bbackend\b",
        r"\bback-end\b",
        r"\bbackendutvecklare\b",
        r"\bjava\b",
        r"\bpython\b",
        r"\bnode\b",
        r"\bapi\b",
        r"\bmicroservice",
        r"\bserver-side\b",
    ),
    "frontend": (
        r"\bfrontend\b",
        r"\bfront-end\b",
        r"\bfrontendutvecklare\b",
        r"\bfront end developer\b",
        r"\breact\b",
        r"\bvue\b",
        r"\bangular\b",
        r"\btypescript\b",
    ),
    "mobile": (
        r"\bandroid\b",
        r"\bios\b",
        r"\bkotlin\b",
        r"\bswift\b",
        r"\bmobile engineer\b",
        r"\bmobile developer\b",
        r"\breact native\b",
    ),
    "security": (
        r"\bsecurity engineer\b",
        r"\bcyber\b",
        r"\binformation security\b",
        r"\bsystems[äa]kerhet\w*\b",
        r"\biam\b",
        r"\bappsec\b",
        r"\bdevsecops\b",
    ),
    "ai_ml": (
        r"\bmachine learning\b",
        r"\bml engineer\b",
        r"\bai engineer\b",
        r"\bartificial intelligence\b",
        r"\bmlops\b",
        r"\bllm\b",
        r"\bcomputer vision\b",
        r"\bdeep learning\b",
        r"\bnlp\b",
    ),
    "data_engineering": (
        r"\bdata engineer\b",
        r"\bdata platform\b",
        r"\banalytics engineer\b",
        r"\betl\b",
        r"\bspark\b",
        r"\bdbt\b",
        r"\bdata warehouse\b",
        r"\bbig data\b",
    ),
    "devops_platform": (
        r"\bdevops\b",
        r"\bsre\b",
        r"\bplatform engineer\b",
        r"\bcloud engineer\b",
        r"\bsite reliability\b",
        r"\bkubernetes\b",
        r"\bterraform\b",
    ),
    "qa_test": (
        r"\bqa\b",
        r"\btest engineer\b",
        r"\btestledare\b",
        r"\bautomation test\b",
        r"\bsdet\b",
        r"\bquality assurance\b",
    ),
}

SOFTWARE_GENERIC_FALLBACK_PATTERNS: tuple[str, ...] = (
    r"\bsoftware engineer\b",
    r"\bsoftware developer\b",
    r"\bapplication engineer\b",
    r"\bsystemutvecklare\b",
    r"\bmjukvaruutvecklare\b",
)

GRAD_PROGRAM_PATTERNS: tuple[str, ...] = (
    r"\bgraduate\b",
    r"\bnew grad\b",
    r"\bearly career\b",
    r"\byoung talent\b",
    r"\bnyexaminerad\b",
    r"\bentry level\b",
)

TRAINEE_PROGRAM_PATTERNS: tuple[str, ...] = (
    r"\btrainee\b",
    r"\btraineeprogram\b",
    r"\btrainee program\b",
    r"\bacademy program\b",
    r"\bfuture talent\b",
)

JUNIOR_PATTERNS: tuple[str, ...] = (
    r"\bjunior\b",
    r"\bentry[- ]?level\b",
    r"\bassociate\b",
    r"\bnyexaminerad\b",
    r"\bintern\b",
)

MID_PATTERNS: tuple[str, ...] = (
    r"\bmid[- ]level\b",
    r"\bintermediate\b",
)

SENIOR_PATTERNS: tuple[str, ...] = (
    r"\bsenior\b",
    r"\blead\b",
    r"\bprincipal\b",
    r"\bstaff engineer\b",
    r"\barchitect\b",
)

CONSULTANCY_PATTERNS: tuple[str, ...] = (
    r"\bconsulting\b",
    r"\bkonsult\b",
    r"\bkonsultuppdrag\b",
    r"\brecruitment\b",
    r"\brekrytering\b",
    r"\bstaffing\b",
    r"\bbemanning\b",
    r"\binterim\b",
    r"\bfor our client\b",
    r"\bför vår kund\b",
)

STAFFING_IDENTITY_PATTERNS: tuple[str, ...] = (
    r"\brecruit(?:er|ment)?\b",
    r"\bstaffing\b",
    r"\bbemanning\b",
    r"\bconsult(?:ing|ancy)?\b",
    r"\bkonsult\b",
)

SWEDISH_REQUIRED_PATTERNS: tuple[str, ...] = (
    r"\bfluent swedish\b",
    r"\bswedish (is )?required\b",
    r"\brequired language[: ]+swedish\b",
    r"\bsvenska (i tal och skrift|krävs|är ett krav)\b",
    r"\bkrav[: ]+svenska\b",
    r"\bgoda kunskaper i svenska\b",
    r"\bmåste tala svenska\b",
)

CITIZENSHIP_REQUIRED_PATTERNS: tuple[str, ...] = (
    r"\bswedish citizenship\b",
    r"\beu citizenship\b",
    r"\bcitizenship is required\b",
    r"\bmust be (?:a )?swedish citizen\b",
    r"\bmust be eligible to work in sweden without sponsorship\b",
    r"\bsvenskt medborgarskap\b",
    r"\bsvensk medborgare\b",
)

SECURITY_CLEARANCE_REQUIRED_PATTERNS: tuple[str, ...] = (
    r"\bsecurity clearance\b",
    r"\bsecurity vetting\b",
    r"\bsäkerhetsklassad\b",
    r"\bsäkerhetsprövning\b",
)

YEARS_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(\d{1,2})\s*\+?\s*(?:years|year)\s*(?:of)?\s*(?:experience|exp)\b", re.IGNORECASE),
    re.compile(r"(\d{1,2})\s*-\s*(\d{1,2})\s*(?:years|year)\s*(?:of)?\s*(?:experience|exp)\b", re.IGNORECASE),
    re.compile(r"min(?:imum)?\.?\s*(\d{1,2})\s*(?:years|year)\b", re.IGNORECASE),
    re.compile(r"(\d{1,2})\s*års?\s+erfarenhet", re.IGNORECASE),
    re.compile(r"minst\s+(\d{1,2})\s*år", re.IGNORECASE),
)

LANGUAGE_BUCKET_SV = {"sv"}

ROLE_TIE_BREAK_PRIORITY: list[str] = [
    "mobile",
    "backend",
    "frontend",
    "full_stack",
    "software_engineering",
    "security",
    "ai_ml",
    "data_engineering",
    "devops_platform",
    "qa_test",
]

ROLE_TIE_BREAK_INDEX = {name: i for i, name in enumerate(ROLE_TIE_BREAK_PRIORITY)}

TIER_WEIGHT_KEY = {
    "A": "main_company_tier_a_weight",
    "B": "main_company_tier_b_weight",
    "C": "main_company_tier_c_weight",
}

CS_SIGNAL_FAMILIES: tuple[str, ...] = (
    "full_stack",
    "software_engineering",
    "backend",
    "frontend",
    "mobile",
    "security",
    "ai_ml",
    "data_engineering",
    "devops_platform",
    "qa_test",
)


@dataclass(frozen=True)
class ClassificationResult:
    role_family: str
    relevance_score: int
    reason_codes: list[str]
    is_target_role: bool
    is_noise: bool
    company_canonical: str
    company_tier: str
    career_stage: str
    career_stage_confidence: float
    is_grad_program: bool
    years_required_min: int | None
    swedish_required: bool
    consultancy_flag: bool
    citizenship_required: bool
    security_clearance_required: bool


def _matches(patterns: tuple[str, ...], text: str) -> int:
    return sum(1 for p in patterns if re.search(p, text, flags=re.IGNORECASE))


def _freshness_days(published_at: Any) -> int | None:
    if not published_at:
        return None
    text = str(published_at).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    delta = datetime.now(UTC) - dt.astimezone(UTC)
    return max(0, int(delta.total_seconds() // 86400))


def _extract_years_required(text: str) -> int | None:
    years: list[int] = []
    for pattern in YEARS_PATTERNS:
        for match in pattern.finditer(text):
            for group in match.groups():
                if not group:
                    continue
                try:
                    parsed = int(group)
                except ValueError:
                    continue
                if 0 < parsed < 40:
                    years.append(parsed)
    if not years:
        return None
    return min(years)


def _detect_career_stage(
    *,
    text: str,
    years_required_min: int | None,
    grad_hits: int,
    trainee_hits: int,
) -> tuple[str, float]:
    if trainee_hits > 0:
        return "trainee", 0.95
    if grad_hits > 0:
        return "graduate", 0.95
    if _matches(JUNIOR_PATTERNS, text) > 0:
        return "junior", 0.85
    if _matches(SENIOR_PATTERNS, text) > 0:
        return "senior", 0.90
    if _matches(MID_PATTERNS, text) > 0:
        return "mid", 0.75
    if years_required_min is not None:
        if years_required_min >= 5:
            return "senior", 0.80
        if years_required_min >= 3:
            return "mid", 0.75
        if years_required_min >= 1:
            return "junior", 0.65
    return "unknown", 0.20


def _pick_role_family(text: str, headline: str) -> tuple[str, int]:
    hits_by_family = {family: _matches(patterns, text) for family, patterns in ROLE_PATTERNS.items()}
    max_hits = max(hits_by_family.values() or [0])
    if max_hits <= 0:
        if _matches(SOFTWARE_GENERIC_FALLBACK_PATTERNS, headline) > 0:
            return "software_engineering", 1
        return "noise", 0

    candidates = [name for name, hits in hits_by_family.items() if hits == max_hits]
    candidates.sort(key=lambda item: ROLE_TIE_BREAK_INDEX.get(item, 999))
    return candidates[0], max_hits


def _has_cs_signal(text: str) -> bool:
    for family in CS_SIGNAL_FAMILIES:
        patterns = ROLE_PATTERNS.get(family, ())
        if _matches(patterns, text) > 0:
            return True
    return False


def _normalize_for_term_match(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9åäö]+", " ", value.lower())
    return re.sub(r"\s+", " ", normalized).strip()


def _contains_exclusion_term(text: str, terms: list[str]) -> bool:
    normalized_text = _normalize_for_term_match(text)
    if not normalized_text:
        return False
    haystack = f" {normalized_text} "
    for term in terms:
        normalized_term = _normalize_for_term_match(term)
        if not normalized_term:
            continue
        if f" {normalized_term} " in haystack:
            return True
    return False


def _is_direct_company_source(job: dict[str, Any]) -> bool:
    if isinstance(job.get("is_direct_company_source"), bool):
        return bool(job.get("is_direct_company_source"))
    source_kind = str(job.get("source_kind") or "").strip().lower()
    if source_kind == "direct_company_ats":
        return True
    source_provider = str(job.get("source_provider") or job.get("source_name") or "").strip().lower()
    return source_provider in {"lever", "greenhouse", "teamtailor", "smartrecruiters", "workday"}


def _add_reason(reason_codes: list[str], code: str) -> None:
    if code not in reason_codes:
        reason_codes.append(code)


def classify_job(job: dict[str, Any], profile: TargetProfile) -> ClassificationResult:
    headline = str(job.get("headline") or "")
    description = str(job.get("description") or "")
    occupation_label = str(job.get("occupation_label") or "")
    employer_name = str(job.get("employer_name") or "")
    region = str(job.get("region") or "").lower()
    region_code = str(job.get("region_code") or "")
    lang = str(job.get("lang") or "").lower()
    remote_flag = bool(job.get("remote_flag"))

    text = f"{headline} {description} {occupation_label}".lower()
    reason_codes: list[str] = []

    grad_hits = _matches(GRAD_PROGRAM_PATTERNS, text)
    trainee_hits = _matches(TRAINEE_PROGRAM_PATTERNS, text)
    is_grad_program = grad_hits > 0 or trainee_hits > 0

    role_family, role_hits = _pick_role_family(text, headline.lower())

    scoring = profile.scoring
    relevance_score = 0

    company_canonical, company_tier = profile.resolve_company(employer_name)
    years_required_min = _extract_years_required(text)
    swedish_required = _matches(SWEDISH_REQUIRED_PATTERNS, text) > 0
    consultancy_signal = _matches(CONSULTANCY_PATTERNS, f"{employer_name} {text}") > 0
    staffing_identity_signal = _matches(STAFFING_IDENTITY_PATTERNS, employer_name.lower()) > 0
    source_company_key = _normalize_for_term_match(str(job.get("source_company_key") or ""))
    employer_company_key = _normalize_for_term_match(employer_name)
    direct_company_source = _is_direct_company_source(job)
    source_company_mismatch = bool(source_company_key and employer_company_key and source_company_key != employer_company_key)
    if direct_company_source:
        consultancy_flag = bool(consultancy_signal and (source_company_mismatch or staffing_identity_signal))
    else:
        consultancy_flag = consultancy_signal
    citizenship_required = _matches(CITIZENSHIP_REQUIRED_PATTERNS, text) > 0
    security_clearance_required = _matches(SECURITY_CLEARANCE_REQUIRED_PATTERNS, text) > 0
    suppression_penalty_total = 0
    career_stage, career_stage_confidence = _detect_career_stage(
        text=text,
        years_required_min=years_required_min,
        grad_hits=grad_hits,
        trainee_hits=trainee_hits,
    )

    has_cs_signal = _has_cs_signal(text)
    grad_without_cs = is_grad_program and not has_cs_signal

    exclusion_text = f"{headline} {occupation_label}"
    has_exclusion = _contains_exclusion_term(exclusion_text, profile.exclude_domains) or grad_without_cs
    if has_exclusion:
        _add_reason(reason_codes, "excluded_domain_hit" if not grad_without_cs else "non_cs_grad_program")
        relevance_score -= scoring.get("exclusion_penalty", 60)

    if role_family != "noise":
        _add_reason(reason_codes, "title_allowlist_match")
        relevance_score += scoring.get("title_allowlist_weight", 0)
        if role_hits > 1:
            relevance_score += min(10, (role_hits - 1) * 2)

    if role_family in profile.include_role_families or role_family in profile.soft_include_role_families:
        _add_reason(reason_codes, "role_family_matched")
        relevance_score += scoring.get("role_family_weight", 0)
    if role_family in profile.soft_include_role_families:
        relevance_score += scoring.get("soft_role_family_weight", 0)

    if company_canonical and company_canonical in profile.watched_companies:
        _add_reason(reason_codes, "watched_company")
        relevance_score += scoring.get("company_watch_weight", 0)

    tier_weight_key = TIER_WEIGHT_KEY.get(company_tier)
    if tier_weight_key:
        relevance_score += scoring.get(tier_weight_key, 0)
        _add_reason(reason_codes, f"company_tier_{company_tier.lower()}")

    if profile.region_codes or profile.region_names:
        if region_code in profile.region_codes or region in profile.region_names:
            _add_reason(reason_codes, "region_matched")
            relevance_score += scoring.get("region_weight", 0)

    if lang in profile.preferred_languages:
        _add_reason(reason_codes, "language_matched")
        relevance_score += scoring.get("language_weight", 0)
    elif lang in LANGUAGE_BUCKET_SV:
        relevance_score -= 4

    if remote_flag and profile.remote_preference in {"remote_only", "remote_or_hybrid"}:
        _add_reason(reason_codes, "remote_matched")
        relevance_score += scoring.get("remote_weight", 0)

    stretch_hit = any(skill in text for skill in profile.stretch_skills)
    if stretch_hit:
        _add_reason(reason_codes, "missing_skill_stretch")
        relevance_score += scoring.get("stretch_weight", 0)

    if is_grad_program:
        _add_reason(reason_codes, "grad_program_detected")
        if trainee_hits > 0:
            relevance_score += scoring.get("entry_trainee_weight", 0)
        else:
            relevance_score += scoring.get("entry_graduate_weight", 0)

    if career_stage == "junior":
        relevance_score += scoring.get("entry_junior_weight", 0)
        _add_reason(reason_codes, "career_stage_junior")
    elif career_stage == "senior":
        relevance_score -= scoring.get("senior_penalty", 0)
        _add_reason(reason_codes, "career_stage_senior")

    if years_required_min is not None and years_required_min >= 3:
        years_penalty = scoring.get("years_3plus_penalty", 0)
        relevance_score -= years_penalty
        suppression_penalty_total += years_penalty
        _add_reason(reason_codes, "years_required_3plus")

    if swedish_required:
        swedish_penalty = scoring.get("swedish_required_penalty", 0)
        relevance_score -= swedish_penalty
        suppression_penalty_total += swedish_penalty
        _add_reason(reason_codes, "swedish_required")

    if citizenship_required:
        citizenship_penalty = scoring.get("citizenship_required_penalty", 28)
        relevance_score -= citizenship_penalty
        suppression_penalty_total += citizenship_penalty
        _add_reason(reason_codes, "citizenship_required")

    if security_clearance_required:
        clearance_penalty = scoring.get("security_clearance_penalty", 22)
        relevance_score -= clearance_penalty
        suppression_penalty_total += clearance_penalty
        _add_reason(reason_codes, "security_clearance_required")

    if consultancy_flag:
        consultancy_penalty = scoring.get("consultancy_penalty", 0)
        relevance_score -= consultancy_penalty
        suppression_penalty_total += consultancy_penalty
        _add_reason(reason_codes, "consultancy_detected")

    freshness_days = _freshness_days(job.get("published_at"))
    if freshness_days is not None and freshness_days <= 14:
        relevance_score += scoring.get("fresh_weight", 0)
        _add_reason(reason_codes, "fresh_post")

    relevance_score = max(-100, min(100, relevance_score))
    target_gate_score = max(-100, min(100, relevance_score + suppression_penalty_total))

    is_target_role = (
        role_family in profile.include_role_families
        and target_gate_score >= scoring.get("minimum_target_score", 18)
        and not has_exclusion
    )

    is_noise = (
        has_exclusion
        or role_family == "noise"
        or target_gate_score <= scoring.get("noise_threshold", -20)
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
        company_canonical=company_canonical,
        company_tier=company_tier,
        career_stage=career_stage,
        career_stage_confidence=round(career_stage_confidence, 3),
        is_grad_program=is_grad_program,
        years_required_min=years_required_min,
        swedish_required=swedish_required,
        consultancy_flag=consultancy_flag,
        citizenship_required=citizenship_required,
        security_clearance_required=security_clearance_required,
    )
