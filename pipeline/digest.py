from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from .storage import SupabaseStorage


def _pct(part: int, total: int) -> int:
    if total <= 0:
        return 0
    return int(round((part / total) * 100))


def _delta_pct(current: int, previous: int) -> int:
    if previous <= 0:
        return 100 if current > 0 else 0
    return int(round(((current - previous) / previous) * 100))


def _top_pairs(counter: Counter[str], *, limit: int) -> list[dict[str, Any]]:
    return [{"skill": k, "count": v} for k, v in counter.most_common(limit)]


def _top_companies(jobs: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for job in jobs:
        name = (job.get("employer_name") or "Unknown").strip()
        counts[name] += 1
    return [{"name": name, "count": count} for name, count in counts.most_common(limit)]


def _top_role_families(jobs: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for job in jobs:
        family = job.get("role_family") or "noise"
        counts[str(family)] += 1
    return [{"role_family": name, "count": count} for name, count in counts.most_common(limit)]


def _region_breakdown(jobs: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for job in jobs:
        region = str(job.get("region") or "").strip()
        if region:
            counts[region] += 1
            continue

        region_code = str(job.get("region_code") or "").strip()
        if region_code:
            counts[f"Region {region_code}"] += 1
        else:
            counts["Unknown"] += 1
    return [{"region": name, "count": count} for name, count in counts.most_common(limit)]


def _extract_skill_counts(tags: list[dict[str, Any]]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for row in tags:
        tag = str(row.get("tag") or "").strip().lower()
        if tag:
            counts[tag] += 1
    return counts


def _rising_skills(current: Counter[str], previous: Counter[str], limit: int = 10) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for skill, cur_count in current.items():
        prev_count = previous.get(skill, 0)
        delta = cur_count - prev_count
        if delta <= 0:
            continue
        pct_change = 100 if prev_count == 0 else int(round((delta / prev_count) * 100))
        rows.append(
            {
                "skill": skill,
                "count": cur_count,
                "previous_count": prev_count,
                "delta": delta,
                "pct_change": pct_change,
                "delta_pct": pct_change,
            }
        )

    rows.sort(key=lambda r: (r["delta"], r["count"]), reverse=True)
    return rows[:limit]


def _study_focus(top_skills: list[dict[str, Any]], rising_skills: list[dict[str, Any]]) -> dict[str, str]:
    primary = rising_skills[0]["skill"] if rising_skills else (top_skills[0]["skill"] if top_skills else "N/A")
    secondary = (
        rising_skills[1]["skill"]
        if len(rising_skills) > 1
        else (top_skills[1]["skill"] if len(top_skills) > 1 else "N/A")
    )

    if primary == "N/A":
        why = "Insufficient live data to generate a study focus recommendation yet."
    else:
        why = (
            f"{primary} frequently appears in your target roles and is showing positive week-over-week momentum."
        )

    return {
        "primary_skill": primary,
        "secondary_skill": secondary,
        "why": why,
    }


def generate_weekly_digest(
    storage: SupabaseStorage,
    *,
    period_start: datetime,
    period_end: datetime,
    target_only: bool = True,
    window_type: str | None = None,
    window_days: int | None = None,
) -> dict[str, Any]:
    period_start = period_start.astimezone(UTC)
    period_end = period_end.astimezone(UTC)
    duration = period_end - period_start
    inferred_days = max(1, int(round(duration.total_seconds() / 86400)))

    if window_type is None:
        window_type = f"rolling_{window_days or inferred_days}d"
    if window_days is None:
        if window_type == "calendar_week":
            window_days = 7
        else:
            window_days = inferred_days

    prev_start = period_start - duration
    prev_end = period_start

    period_jobs = storage.fetch_jobs_between(period_start.isoformat(), period_end.isoformat(), target_only=target_only)
    prev_jobs = storage.fetch_jobs_between(prev_start.isoformat(), prev_end.isoformat(), target_only=target_only)

    period_job_ids = [int(job["id"]) for job in period_jobs if job.get("id") is not None]
    prev_job_ids = [int(job["id"]) for job in prev_jobs if job.get("id") is not None]

    period_skill_counts = _extract_skill_counts(storage.fetch_tags_for_jobs(period_job_ids))
    prev_skill_counts = _extract_skill_counts(storage.fetch_tags_for_jobs(prev_job_ids))

    top_skills = _top_pairs(period_skill_counts, limit=20)
    rising_skills = _rising_skills(period_skill_counts, prev_skill_counts, limit=10)

    total_new_jobs = len(period_jobs)
    prev_total_new_jobs = len(prev_jobs)
    total_removed_jobs = storage.fetch_event_counts("removed", period_start.isoformat(), period_end.isoformat())

    remote_jobs = sum(1 for job in period_jobs if bool(job.get("remote_flag")))
    english_jobs = sum(1 for job in period_jobs if str(job.get("lang") or "") in {"en", "mixed"})

    digest_json: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "window_type": window_type,
        "window_days": window_days,
        "total_new_jobs": total_new_jobs,
        "total_removed_jobs": total_removed_jobs,
        "new_jobs_delta_pct": _delta_pct(total_new_jobs, prev_total_new_jobs),
        "remote_share_pct": _pct(remote_jobs, total_new_jobs),
        "english_pct": _pct(english_jobs, total_new_jobs),
        "top_skills": top_skills,
        "rising_skills": rising_skills,
        "top_employers": _top_companies(period_jobs, limit=12),
        "top_companies_new": _top_companies(period_jobs, limit=12),
        "top_role_families": _top_role_families(period_jobs, limit=10),
        "region_breakdown": _region_breakdown(period_jobs, limit=8),
        "study_focus": _study_focus(top_skills, rising_skills),
    }

    storage.upsert_weekly_digest(
        period_start=period_start.isoformat(),
        period_end=period_end.isoformat(),
        digest_json=digest_json,
    )
    storage.upsert_ingestion_state({"last_digest_period_end": period_end.isoformat()})
    return digest_json


def current_week_period(now: datetime | None = None) -> tuple[datetime, datetime]:
    base = (now or datetime.now(UTC)).astimezone(UTC)
    # Monday-start week in UTC
    start = base - timedelta(days=base.weekday())
    start = datetime(start.year, start.month, start.day, tzinfo=UTC)
    end = start + timedelta(days=7)
    return start, end
