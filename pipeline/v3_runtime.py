from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml

from .company_registry import company_registry_map
from .storage import SupabaseStorage

if TYPE_CHECKING:
    from .ingest import IngestionPipeline


_HIGH_SIGNAL_BANDS = {"trusted", "verified"}
_GRAD_STAGES = {"graduate", "trainee", "junior"}
_SENIOR_TITLE_PATTERN = re.compile(
    r"\b(senior|lead|principal|staff|architect|manager|head of|director|vp|vice president|"
    r"experienced|expert|seasoned|erfaren|erfarna|erfaret|erfarenhet|flerårig|fleråriga|"
    r"flerarig|flerariga|gedigen erfarenhet)\b",
    flags=re.IGNORECASE,
)
_DEFAULT_FEED_QUALITY_THRESHOLDS_PATH = "pipeline/config/feed_quality_thresholds.yaml"
_DEFAULT_FEED_QUALITY_PROFILES: dict[str, dict[str, Any]] = {
    "strict": {
        "min_runs": 4,
        "trusted": {
            "min_success_rate": 0.95,
            "min_target_hit_rate": 0.7,
            "min_total_target_rows": 8,
            "min_target_share_of_persisted": 0.55,
        },
        "verified": {
            "min_success_rate": 0.85,
            "min_target_hit_rate": 0.45,
            "min_total_target_rows": 4,
            "min_target_share_of_persisted": 0.35,
        },
        "candidate": {
            "min_success_rate": 0.6,
        },
    },
    "balanced": {
        "min_runs": 4,
        "trusted": {
            "min_success_rate": 0.9,
            "min_target_hit_rate": 0.6,
            "min_total_target_rows": 6,
            "min_target_share_of_persisted": 0.45,
        },
        "verified": {
            "min_success_rate": 0.75,
            "min_target_hit_rate": 0.35,
            "min_total_target_rows": 3,
            "min_target_share_of_persisted": 0.25,
        },
        "candidate": {
            "min_success_rate": 0.5,
        },
    },
    "lenient": {
        "min_runs": 3,
        "trusted": {
            "min_success_rate": 0.85,
            "min_target_hit_rate": 0.45,
            "min_total_target_rows": 4,
            "min_target_share_of_persisted": 0.35,
        },
        "verified": {
            "min_success_rate": 0.65,
            "min_target_hit_rate": 0.2,
            "min_total_target_rows": 2,
            "min_target_share_of_persisted": 0.15,
        },
        "candidate": {
            "min_success_rate": 0.4,
        },
    },
}
UTC = timezone.utc


def _bool(value: Any) -> bool:
    return value is True


def _to_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
        return parsed
    except Exception:
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _load_feed_quality_profiles(path: str) -> dict[str, dict[str, Any]]:
    try:
        payload = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return dict(_DEFAULT_FEED_QUALITY_PROFILES)
    if not isinstance(payload, dict):
        return dict(_DEFAULT_FEED_QUALITY_PROFILES)

    profiles = payload.get("profiles")
    if not isinstance(profiles, dict):
        return dict(_DEFAULT_FEED_QUALITY_PROFILES)

    loaded: dict[str, dict[str, Any]] = {}
    for name, values in profiles.items():
        key = str(name).strip().lower()
        if key not in {"strict", "balanced", "lenient"}:
            continue
        if isinstance(values, dict):
            loaded[key] = values

    if not loaded:
        return dict(_DEFAULT_FEED_QUALITY_PROFILES)

    merged = dict(_DEFAULT_FEED_QUALITY_PROFILES)
    merged.update(loaded)
    return merged


def _resolve_feed_quality_thresholds(
    *,
    profile: str,
    path: str,
    min_runs_override: int | None,
) -> dict[str, Any]:
    profiles = _load_feed_quality_profiles(path)
    normalized = str(profile or "strict").strip().lower()
    selected = dict(profiles.get(normalized) or profiles.get("strict") or _DEFAULT_FEED_QUALITY_PROFILES["strict"])

    selected["min_runs"] = max(1, int(min_runs_override if min_runs_override is not None else selected.get("min_runs", 4)))

    trusted = dict(selected.get("trusted") or {})
    verified = dict(selected.get("verified") or {})
    candidate = dict(selected.get("candidate") or {})

    # Keep strict defaults for missing keys.
    strict_default = _DEFAULT_FEED_QUALITY_PROFILES["strict"]
    trusted_default = strict_default["trusted"]
    verified_default = strict_default["verified"]
    candidate_default = strict_default["candidate"]

    resolved = {
        "profile": normalized if normalized in profiles else "strict",
        "min_runs": selected["min_runs"],
        "trusted": {
            "min_success_rate": _to_float(trusted.get("min_success_rate"), _to_float(trusted_default["min_success_rate"])),
            "min_target_hit_rate": _to_float(
                trusted.get("min_target_hit_rate"), _to_float(trusted_default["min_target_hit_rate"])
            ),
            "min_total_target_rows": _to_int(
                trusted.get("min_total_target_rows"), _to_int(trusted_default["min_total_target_rows"])
            ),
            "min_target_share_of_persisted": _to_float(
                trusted.get("min_target_share_of_persisted"),
                _to_float(trusted_default["min_target_share_of_persisted"]),
            ),
        },
        "verified": {
            "min_success_rate": _to_float(
                verified.get("min_success_rate"), _to_float(verified_default["min_success_rate"])
            ),
            "min_target_hit_rate": _to_float(
                verified.get("min_target_hit_rate"), _to_float(verified_default["min_target_hit_rate"])
            ),
            "min_total_target_rows": _to_int(
                verified.get("min_total_target_rows"), _to_int(verified_default["min_total_target_rows"])
            ),
            "min_target_share_of_persisted": _to_float(
                verified.get("min_target_share_of_persisted"),
                _to_float(verified_default["min_target_share_of_persisted"]),
            ),
        },
        "candidate": {
            "min_success_rate": _to_float(
                candidate.get("min_success_rate"), _to_float(candidate_default["min_success_rate"])
            )
        },
    }
    return resolved


def _restricted_market_role(job: dict[str, Any]) -> bool:
    return _bool(job.get("swedish_required")) or _bool(job.get("citizenship_required")) or _bool(
        job.get("security_clearance_required")
    )


def _senior_role_signal(job: dict[str, Any]) -> bool:
    title = str(job.get("headline") or "")
    if _SENIOR_TITLE_PATTERN.search(title):
        return True
    stage = str(job.get("career_stage") or "").strip().lower()
    if stage in {"senior", "lead", "staff", "principal"}:
        return True

    years_required = job.get("years_required_min")
    if years_required is not None:
        try:
            if float(years_required) >= 3:
                return True
        except Exception:
            pass

    reasons = job.get("reason_codes")
    if isinstance(reasons, list):
        reason_set = {str(value).strip().lower() for value in reasons}
        if "career_stage_senior" in reason_set or "years_required_3plus" in reason_set:
            return True
    return False


def passes_default_eligibility(job: dict[str, Any]) -> bool:
    return (
        _bool(job.get("is_active"))
        and not _bool(job.get("is_noise"))
        and not _restricted_market_role(job)
        and not _senior_role_signal(job)
    )


def lens_matches(
    job: dict[str, Any],
    *,
    lens: str,
    feed_registry: dict[str, dict[str, Any]],
    include_jobtech_in_high_signal: bool,
) -> bool:
    relevance = _to_int(job.get("relevance_score"), 0)
    is_noise = _bool(job.get("is_noise"))
    stage = str(job.get("career_stage") or "").strip().lower()
    years_required = job.get("years_required_min")

    if lens == "broad":
        return _bool(job.get("is_active")) and not is_noise and not _restricted_market_role(job)

    if not passes_default_eligibility(job):
        return False

    if lens == "graduate_trainee":
        years_value = None
        if years_required is not None:
            try:
                years_value = float(years_required)
            except Exception:
                years_value = None

        return (
            relevance >= 15
            and (
                _bool(job.get("is_grad_program"))
                or stage in _GRAD_STAGES
                or (years_value is not None and years_value <= 2)
            )
        )

    # high_signal (default)
    if not _bool(job.get("is_target_role")):
        return False
    if relevance < 30:
        return False

    source_kind = str(job.get("source_kind") or "").strip().lower()
    if source_kind == "jobtech":
        return include_jobtech_in_high_signal

    feed_key = str(job.get("source_feed_key") or "").strip().lower()
    if not feed_key:
        return False

    feed = feed_registry.get(feed_key) or {}
    band = str(feed.get("quality_band") or "unrated").strip().lower()
    return _bool(feed.get("enabled")) and _bool(feed.get("high_signal_eligible")) and band in _HIGH_SIGNAL_BANDS


def sync_feed_registry_from_yaml(
    storage: SupabaseStorage,
    *,
    config_path: str,
    only_keys: list[str] | None = None,
) -> dict[str, Any]:
    from .sources.base import load_company_feeds

    feeds = load_company_feeds(config_path)
    key_filter = {key.strip().lower() for key in (only_keys or []) if key.strip()}
    if key_filter:
        feeds = [feed for feed in feeds if feed.feed_key in key_filter]

    rows: list[dict[str, Any]] = []
    for feed in feeds:
        rows.append(
            {
                "feed_key": feed.feed_key,
                "provider": feed.provider,
                "company_canonical": feed.company_canonical,
                "enabled": bool(feed.enabled),
                "high_signal_eligible": bool(feed.enabled),
                "quality_band": "verified" if bool(feed.enabled) else "candidate",
            }
        )

    upserted = storage.upsert_source_feed_registry_rows(rows)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "config_path": config_path,
        "feeds_seen": len(feeds),
        "rows_upserted": upserted,
        "feed_keys": [feed.feed_key for feed in feeds],
    }


def refresh_feed_quality(
    storage: SupabaseStorage,
    *,
    lookback_days: int = 14,
    min_runs: int | None = None,
    threshold_profile: str = "strict",
    thresholds_path: str = _DEFAULT_FEED_QUALITY_THRESHOLDS_PATH,
    apply: bool = False,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    cutoff = (now - timedelta(days=max(1, int(lookback_days)))).isoformat()
    thresholds = _resolve_feed_quality_thresholds(
        profile=threshold_profile,
        path=thresholds_path,
        min_runs_override=min_runs,
    )

    registry_rows = storage.fetch_source_feed_registry()
    probe_rows = storage.fetch_source_feed_probe_runs_since(since_iso=cutoff)

    metrics: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "runs": 0,
            "successful_runs": 0,
            "target_hit_runs": 0,
            "total_target_rows": 0,
            "total_persisted_rows": 0,
            "total_removed_rows": 0,
            "total_http_requests": 0,
        }
    )

    for row in probe_rows:
        feed_key = str(row.get("feed_key") or "").strip().lower()
        if not feed_key:
            continue

        bucket = metrics[feed_key]
        bucket["runs"] += 1
        http_status = row.get("http_status")
        error_text = str(row.get("error_text") or "").strip()
        is_success = not error_text and (http_status is None or int(http_status) < 400)
        if is_success:
            bucket["successful_runs"] += 1
        target_rows = _to_int(row.get("target_rows"), 0)
        if target_rows > 0:
            bucket["target_hit_runs"] += 1
        bucket["total_target_rows"] += target_rows
        bucket["total_persisted_rows"] += _to_int(row.get("persisted_rows"), 0)
        bucket["total_removed_rows"] += _to_int(row.get("removed_rows"), 0)
        bucket["total_http_requests"] += _to_int(row.get("http_requests"), 0)

    recommendations: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    min_runs_effective = _to_int(thresholds.get("min_runs"), 4)
    trusted = thresholds["trusted"]
    verified = thresholds["verified"]
    candidate = thresholds["candidate"]

    def _evaluate_band(
        *,
        success_rate: float,
        target_hit_rate: float,
        total_target_rows: int,
        target_share_of_persisted: float,
    ) -> tuple[str, bool, list[str]]:
        reasons: list[str] = []

        trusted_failures: list[str] = []
        if success_rate < _to_float(trusted["min_success_rate"]):
            trusted_failures.append("trusted_success_rate")
        if target_hit_rate < _to_float(trusted["min_target_hit_rate"]):
            trusted_failures.append("trusted_target_hit_rate")
        if total_target_rows < _to_int(trusted["min_total_target_rows"]):
            trusted_failures.append("trusted_total_target_rows")
        if target_share_of_persisted < _to_float(trusted["min_target_share_of_persisted"]):
            trusted_failures.append("trusted_target_share")
        if not trusted_failures:
            return "trusted", True, ["meets_trusted_thresholds"]

        verified_failures: list[str] = []
        if success_rate < _to_float(verified["min_success_rate"]):
            verified_failures.append("verified_success_rate")
        if target_hit_rate < _to_float(verified["min_target_hit_rate"]):
            verified_failures.append("verified_target_hit_rate")
        if total_target_rows < _to_int(verified["min_total_target_rows"]):
            verified_failures.append("verified_total_target_rows")
        if target_share_of_persisted < _to_float(verified["min_target_share_of_persisted"]):
            verified_failures.append("verified_target_share")
        if not verified_failures:
            return "verified", True, ["meets_verified_thresholds"]

        if success_rate >= _to_float(candidate["min_success_rate"]):
            reasons.extend(verified_failures)
            reasons.append("candidate_due_to_low_yield")
            return "candidate", False, reasons

        reasons.extend(verified_failures)
        reasons.append("blocked_due_to_low_success_rate")
        return "blocked", False, reasons

    for row in registry_rows:
        feed_key = str(row.get("feed_key") or "").strip().lower()
        bucket = metrics.get(feed_key, {})
        runs = _to_int(bucket.get("runs"), 0)
        successful_runs = _to_int(bucket.get("successful_runs"), 0)
        target_hit_runs = _to_int(bucket.get("target_hit_runs"), 0)
        total_target_rows = _to_int(bucket.get("total_target_rows"), 0)
        total_persisted_rows = _to_int(bucket.get("total_persisted_rows"), 0)
        total_removed_rows = _to_int(bucket.get("total_removed_rows"), 0)
        total_http_requests = _to_int(bucket.get("total_http_requests"), 0)

        success_rate = (successful_runs / runs) if runs > 0 else 0.0
        target_hit_rate = (target_hit_runs / runs) if runs > 0 else 0.0
        target_share_of_persisted = (total_target_rows / total_persisted_rows) if total_persisted_rows > 0 else 0.0
        target_rows_per_run = (total_target_rows / runs) if runs > 0 else 0.0
        target_rows_per_http_request = (total_target_rows / total_http_requests) if total_http_requests > 0 else 0.0

        current_band = str(row.get("quality_band") or "unrated").strip().lower()
        current_high_signal = _bool(row.get("high_signal_eligible"))

        if runs < min_runs_effective:
            if runs >= 2 and successful_runs == 0:
                next_band = "blocked"
                next_high_signal = False
                reason_codes = [f"hard_fail_no_success_runs={runs}"]
            else:
                next_band = current_band
                next_high_signal = current_high_signal
                reason_codes = [f"insufficient_runs<{min_runs_effective}"]
        else:
            next_band, next_high_signal, reason_codes = _evaluate_band(
                success_rate=success_rate,
                target_hit_rate=target_hit_rate,
                total_target_rows=total_target_rows,
                target_share_of_persisted=target_share_of_persisted,
            )

        recommendations.append(
            {
                "feed_key": feed_key,
                "runs": runs,
                "successful_runs": successful_runs,
                "success_rate": round(success_rate, 3),
                "target_hit_runs": target_hit_runs,
                "target_hit_rate": round(target_hit_rate, 3),
                "total_target_rows": total_target_rows,
                "total_persisted_rows": total_persisted_rows,
                "total_removed_rows": total_removed_rows,
                "total_http_requests": total_http_requests,
                "target_share_of_persisted": round(target_share_of_persisted, 3),
                "target_rows_per_run": round(target_rows_per_run, 3),
                "target_rows_per_http_request": round(target_rows_per_http_request, 3),
                "current_band": current_band,
                "recommended_band": next_band,
                "current_high_signal_eligible": current_high_signal,
                "recommended_high_signal_eligible": next_high_signal,
                "reason_codes": reason_codes,
            }
        )

        if next_band != current_band or next_high_signal != current_high_signal:
            updates.append(
                {
                    "feed_key": feed_key,
                    "provider": row.get("provider"),
                    "company_canonical": row.get("company_canonical"),
                    "enabled": bool(row.get("enabled", True)),
                    "quality_band": next_band,
                    "high_signal_eligible": next_high_signal,
                }
            )

    applied_count = 0
    if apply and updates:
        applied_count = storage.upsert_source_feed_registry_rows(updates)

    band_rank = {"trusted": 0, "verified": 1, "candidate": 2, "blocked": 3, "unrated": 4}
    recommendations.sort(
        key=lambda item: (
            band_rank.get(str(item.get("recommended_band") or "unrated"), 9),
            -_to_int(item.get("runs"), 0),
            str(item.get("feed_key") or ""),
        )
    )
    return {
        "generated_at": now.isoformat(),
        "lookback_days": int(lookback_days),
        "threshold_profile": str(thresholds.get("profile") or "strict"),
        "thresholds_path": thresholds_path,
        "thresholds_used": thresholds,
        "probe_rows_considered": len(probe_rows),
        "registry_rows": len(registry_rows),
        "changes_detected": len(updates),
        "applied": bool(apply),
        "applied_count": int(applied_count),
        "recommendations": recommendations,
    }


def promote_company_feeds(
    storage: SupabaseStorage,
    *,
    mode: str = "report",
    feed_keys: list[str] | None = None,
) -> dict[str, Any]:
    normalized_mode = str(mode or "report").strip().lower()
    if normalized_mode not in {"report", "apply"}:
        raise ValueError("mode must be one of: report, apply")

    key_filter = {key.strip().lower() for key in (feed_keys or []) if key.strip()}
    rows = storage.fetch_source_feed_registry()

    candidates: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    for row in rows:
        feed_key = str(row.get("feed_key") or "").strip().lower()
        if key_filter and feed_key not in key_filter:
            continue

        band = str(row.get("quality_band") or "unrated").strip().lower()
        enabled = _bool(row.get("enabled"))
        high_signal = _bool(row.get("high_signal_eligible"))
        promotable = enabled and band in _HIGH_SIGNAL_BANDS and not high_signal
        if not promotable:
            continue

        candidate = {
            "feed_key": feed_key,
            "provider": row.get("provider"),
            "company_canonical": row.get("company_canonical"),
            "quality_band": band,
            "enabled": enabled,
            "high_signal_eligible": high_signal,
        }
        candidates.append(candidate)
        updates.append(
            {
                **candidate,
                "high_signal_eligible": True,
            }
        )

    applied_count = 0
    if normalized_mode == "apply" and updates:
        applied_count = storage.upsert_source_feed_registry_rows(updates)

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "mode": normalized_mode,
        "candidates": candidates,
        "candidate_count": len(candidates),
        "applied_count": applied_count,
    }


def verify_company_sources_batch(
    pipeline: IngestionPipeline,
    *,
    statuses: list[str],
    max_companies: int,
    max_rows: int,
    max_http_per_provider: int,
    registry_path: str,
) -> dict[str, Any]:
    registry = company_registry_map(registry_path)
    status_filter = {status.strip().lower() for status in statuses if status.strip()}

    companies: set[str] = set()
    for canonical, entry in registry.items():
        if status_filter and entry.status not in status_filter:
            continue
        companies.add(entry.company_canonical or canonical)

    ordered_companies = sorted(companies)
    if max_companies > 0:
        ordered_companies = ordered_companies[:max_companies]

    if not ordered_companies:
        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "companies_requested": 0,
            "companies": [],
        }

    report = pipeline.verify_company_sources(
        company_names=ordered_companies,
        max_rows=max_rows,
        max_http_per_provider=max_http_per_provider,
        registry_path=registry_path,
    )
    report["companies_requested"] = len(ordered_companies)
    return report


def send_alerts(storage: SupabaseStorage, *, frequency: str) -> dict[str, Any]:
    result = storage.call_generate_saved_search_alerts(frequency=frequency)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "frequency": str(frequency).strip().lower(),
        "processed_searches": _to_int(result.get("processed_searches"), 0),
        "inserted_alerts": _to_int(result.get("inserted_alerts"), 0),
    }


def useful_coverage_report(
    storage: SupabaseStorage,
    *,
    target_companies: set[str] | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    registry_rows = storage.fetch_source_feed_registry()
    active_jobs = storage.fetch_active_jobs_for_coverage()
    registry = {str(row.get("feed_key") or "").strip().lower(): row for row in registry_rows}

    by_feed: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "active_jobs": 0,
            "target_jobs": 0,
            "jobs_with_apply_link": 0,
            "direct_jobs": 0,
        }
    )
    covered_companies: set[str] = set()
    for job in active_jobs:
        feed_key = str(job.get("source_feed_key") or "").strip().lower() or "jobtech_or_unknown"
        bucket = by_feed[feed_key]
        bucket["active_jobs"] += 1
        if _bool(job.get("is_target_role")) and not _bool(job.get("is_noise")):
            bucket["target_jobs"] += 1
            canonical = str(job.get("company_canonical") or job.get("employer_name") or "").strip().lower()
            if canonical:
                covered_companies.add(canonical)
        if str(job.get("source_url") or "").strip():
            bucket["jobs_with_apply_link"] += 1
        if _bool(job.get("is_direct_company_source")) or str(job.get("source_kind") or "") == "direct_company_ats":
            bucket["direct_jobs"] += 1

    feeds: list[dict[str, Any]] = []
    useful_feed_count = 0
    for feed_key, counts in sorted(by_feed.items()):
        feed = registry.get(feed_key, {})
        useful = (
            feed_key != "jobtech_or_unknown"
            and _bool(feed.get("enabled"))
            and str(feed.get("quality_band") or "").lower() in _HIGH_SIGNAL_BANDS
            and counts["target_jobs"] > 0
            and counts["jobs_with_apply_link"] == counts["active_jobs"]
        )
        useful_feed_count += int(useful)
        feeds.append(
            {
                "feed_key": feed_key,
                "company_canonical": feed.get("company_canonical"),
                "quality_band": feed.get("quality_band"),
                "enabled": _bool(feed.get("enabled")),
                "useful_verified": useful,
                **counts,
            }
        )

    normalized_targets = {str(value).strip().lower() for value in (target_companies or set()) if str(value).strip()}
    missing_targets = sorted(normalized_targets - covered_companies)
    missing_rate = int(round((len(missing_targets) / len(normalized_targets)) * 100)) if normalized_targets else 0
    return {
        "generated_at": now.isoformat(),
        "active_jobs_scanned": len(active_jobs),
        "registry_feeds": len(registry_rows),
        "useful_verified_feeds": useful_feed_count,
        "target_companies_total": len(normalized_targets),
        "target_companies_with_relevant_active_jobs": len(normalized_targets & covered_companies),
        "missing_target_company_rate_pct": missing_rate,
        "missing_target_companies": missing_targets,
        "feeds": feeds,
    }


def recalculate_user_ranking(
    storage: SupabaseStorage,
    *,
    lookback_days: int = 90,
    user_id: str | None = None,
    apply: bool = False,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    cutoff = (now - timedelta(days=max(1, int(lookback_days)))).isoformat()

    query = storage.client.table("job_feedback_events").select(
        "user_id,signal_type,employer_name,role_family,created_at"
    ).gte("created_at", cutoff)
    if user_id:
        query = query.eq("user_id", user_id)
    response = storage._execute(lambda: query.limit(100000).execute(), context="fetch job_feedback_events")
    rows = response.data or []

    per_user: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "positive": 0,
            "negative": 0,
            "company_scores": defaultdict(int),
            "role_scores": defaultdict(int),
        }
    )

    positive_signals = {"apply", "save", "follow_company"}
    negative_signals = {"hide", "skip"}

    for row in rows:
        uid = str(row.get("user_id") or "").strip()
        if not uid:
            continue
        signal = str(row.get("signal_type") or "").strip().lower()
        company = str(row.get("employer_name") or "").strip().lower()
        role = str(row.get("role_family") or "").strip().lower()

        bucket = per_user[uid]
        if signal in positive_signals:
            bucket["positive"] += 1
            if company:
                bucket["company_scores"][company] += 2
            if role:
                bucket["role_scores"][role] += 2
        elif signal in negative_signals:
            bucket["negative"] += 1
            if company:
                bucket["company_scores"][company] -= 2
            if role:
                bucket["role_scores"][role] -= 2

    update_rows: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []

    for uid, bucket in per_user.items():
        company_scores: dict[str, int] = dict(bucket["company_scores"])
        role_scores: dict[str, int] = dict(bucket["role_scores"])

        preferred_companies = sorted([name for name, score in company_scores.items() if score > 0])[:40]
        demoted_companies = sorted([name for name, score in company_scores.items() if score < 0])[:40]
        preferred_roles = sorted([name for name, score in role_scores.items() if score > 0])[:20]
        demoted_roles = sorted([name for name, score in role_scores.items() if score < 0])[:20]

        delta_raw = int(bucket["positive"]) - int(bucket["negative"])
        high_signal_delta = max(-25, min(25, delta_raw))

        update_row = {
            "user_id": uid,
            "high_signal_score_delta": high_signal_delta,
            "preferred_companies": preferred_companies,
            "demoted_companies": demoted_companies,
            "preferred_role_families": preferred_roles,
            "demoted_role_families": demoted_roles,
            "updated_at": now.isoformat(),
        }
        update_rows.append(update_row)

        summaries.append(
            {
                "user_id": uid,
                "positive_signals": int(bucket["positive"]),
                "negative_signals": int(bucket["negative"]),
                "high_signal_score_delta": high_signal_delta,
                "preferred_companies": preferred_companies,
                "demoted_companies": demoted_companies,
                "preferred_role_families": preferred_roles,
                "demoted_role_families": demoted_roles,
            }
        )

    applied_count = 0
    if apply and update_rows:
        for chunk in storage._chunked(update_rows):
            storage._execute(
                lambda chunk=chunk: storage.client.table("user_ranking_state").upsert(
                    chunk, on_conflict="user_id"
                ).execute(),
                context="upsert user_ranking_state",
            )
        applied_count = len(update_rows)

    summaries.sort(key=lambda row: row["user_id"])
    return {
        "generated_at": now.isoformat(),
        "lookback_days": int(lookback_days),
        "rows_scanned": len(rows),
        "users_computed": len(summaries),
        "apply": bool(apply),
        "applied_count": int(applied_count),
        "users": summaries,
    }


def _fetch_jobs_for_precision(
    storage: SupabaseStorage,
    *,
    period_days: int,
    limit: int,
) -> list[dict[str, Any]]:
    cutoff = (datetime.now(UTC) - timedelta(days=max(1, int(period_days)))).isoformat()
    response = storage._execute(
        lambda: storage.client.table("jobs")
        .select(
            "id,headline,employer_name,published_at,relevance_score,is_active,is_target_role,is_noise,"
            "source_kind,source_feed_key,is_grad_program,career_stage,years_required_min"
        )
        .gte("published_at", cutoff)
        .order("relevance_score", desc=True)
        .order("published_at", desc=True)
        .limit(max(1, int(limit)))
        .execute(),
        context="fetch jobs for precision export",
    )
    return response.data or []


def evaluate_precision_export(
    storage: SupabaseStorage,
    *,
    lens: str,
    top_n: int,
    period_days: int,
    output_csv: str,
) -> dict[str, Any]:
    normalized_lens = str(lens or "high_signal").strip().lower()
    if normalized_lens not in {"high_signal", "broad", "graduate_trainee"}:
        raise ValueError("lens must be one of: high_signal, broad, graduate_trainee")

    jobs = _fetch_jobs_for_precision(storage, period_days=period_days, limit=max(top_n * 6, top_n))
    feed_registry_rows = storage.fetch_source_feed_registry()
    feed_registry = {str(row.get("feed_key") or "").strip().lower(): row for row in feed_registry_rows}

    matched = [
        row
        for row in jobs
        if lens_matches(
            row,
            lens=normalized_lens,
            feed_registry=feed_registry,
            include_jobtech_in_high_signal=False,
        )
    ][: max(1, int(top_n))]

    output_path = Path(output_csv)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "job_id",
                "lens",
                "headline",
                "employer_name",
                "published_at",
                "relevance_score",
                "source_kind",
                "source_feed_key",
                "human_label",
                "reviewer_key",
                "rationale",
            ],
        )
        writer.writeheader()
        for row in matched:
            writer.writerow(
                {
                    "job_id": row.get("id"),
                    "lens": normalized_lens,
                    "headline": row.get("headline"),
                    "employer_name": row.get("employer_name"),
                    "published_at": row.get("published_at"),
                    "relevance_score": row.get("relevance_score"),
                    "source_kind": row.get("source_kind"),
                    "source_feed_key": row.get("source_feed_key"),
                    "human_label": "",
                    "reviewer_key": "",
                    "rationale": "",
                }
            )

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "lens": normalized_lens,
        "period_days": int(period_days),
        "top_n": int(top_n),
        "rows_exported": len(matched),
        "output_csv": str(output_path),
    }


def evaluate_precision_ingest_labels(
    storage: SupabaseStorage,
    *,
    input_csv: str,
    default_reviewer_key: str,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    input_path = Path(input_csv)
    with input_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            label_text = str(row.get("human_label") or "").strip()
            if label_text not in {"0", "1"}:
                continue
            job_id = str(row.get("job_id") or "").strip()
            lens = str(row.get("lens") or "high_signal").strip().lower()
            if not job_id:
                continue
            reviewer_key = str(row.get("reviewer_key") or "").strip() or default_reviewer_key
            if not reviewer_key:
                continue
            rows.append(
                {
                    "job_id": int(job_id),
                    "lens": lens,
                    "label": int(label_text),
                    "reviewer_key": reviewer_key,
                    "rationale": str(row.get("rationale") or "").strip() or None,
                }
            )

    upserted = storage.upsert_relevance_labels(rows)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "input_csv": str(input_path),
        "labels_parsed": len(rows),
        "labels_upserted": upserted,
    }


def evaluate_precision_report(storage: SupabaseStorage, *, lens: str | None = None) -> dict[str, Any]:
    normalized_lens = str(lens).strip().lower() if lens else None
    if normalized_lens and normalized_lens not in {"high_signal", "broad", "graduate_trainee"}:
        raise ValueError("lens must be one of: high_signal, broad, graduate_trainee")

    labels = storage.fetch_relevance_labels(lens=normalized_lens)
    if not labels:
        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "lens": normalized_lens,
            "total_labels": 0,
            "precision": None,
            "by_lens": {},
        }

    by_lens: dict[str, dict[str, Any]] = defaultdict(lambda: {"total": 0, "positive": 0})
    for row in labels:
        current_lens = str(row.get("lens") or "").strip().lower()
        label = _to_int(row.get("label"), 0)
        bucket = by_lens[current_lens]
        bucket["total"] += 1
        bucket["positive"] += 1 if label == 1 else 0

    metrics: dict[str, Any] = {}
    total_labels = 0
    total_positive = 0
    for key, bucket in by_lens.items():
        total = _to_int(bucket.get("total"), 0)
        pos = _to_int(bucket.get("positive"), 0)
        precision = round((pos / total), 4) if total > 0 else None
        metrics[key] = {"total": total, "positive": pos, "precision": precision}
        total_labels += total
        total_positive += pos

    overall_precision = round((total_positive / total_labels), 4) if total_labels > 0 else None
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "lens": normalized_lens,
        "total_labels": total_labels,
        "positive_labels": total_positive,
        "precision": overall_precision,
        "by_lens": metrics,
    }


def write_report_files(
    *,
    report: dict[str, Any],
    json_path: str | None = None,
    markdown_path: str | None = None,
    title: str = "V3 Report",
) -> None:
    if json_path:
        path = Path(json_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if markdown_path:
        lines = [f"# {title}", "", "```json", json.dumps(report, indent=2), "```", ""]
        path = Path(markdown_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines), encoding="utf-8")
