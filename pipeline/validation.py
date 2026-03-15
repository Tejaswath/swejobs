from __future__ import annotations

import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .storage import SupabaseStorage
from .target_profile import TargetProfile


def _pct(numerator: int, denominator: int) -> int:
    if denominator <= 0:
        return 0
    return int(round((numerator / denominator) * 100))


def usefulness_report(
    storage: SupabaseStorage,
    profile: TargetProfile,
    *,
    sample_size: int = 50,
    min_relevant_pct: int = 70,
    max_noise_pct: int = 15,
    report_path: str = "pipeline/reports/usefulness_report.json",
) -> dict[str, Any]:
    sample = storage.sample_target_jobs(limit=sample_size)

    if not sample:
        report = {
            "generated_at": datetime.now(UTC).isoformat(),
            "sample_size": 0,
            "relevant_pct": 0,
            "noise_pct": 0,
            "passes_threshold": False,
            "thresholds": {
                "min_relevant_pct": min_relevant_pct,
                "max_noise_pct": max_noise_pct,
            },
            "notes": ["No target jobs found. Run ingestion first."],
        }
    else:
        include_set = profile.include_role_families
        relevant_count = sum(1 for row in sample if row.get("role_family") in include_set)
        noise_count = sum(1 for row in sample if bool(row.get("is_noise")))

        relevant_pct = int(round((relevant_count / len(sample)) * 100))
        noise_pct = int(round((noise_count / len(sample)) * 100))

        report = {
            "generated_at": datetime.now(UTC).isoformat(),
            "sample_size": len(sample),
            "relevant_pct": relevant_pct,
            "noise_pct": noise_pct,
            "passes_threshold": relevant_pct >= min_relevant_pct and noise_pct <= max_noise_pct,
            "thresholds": {
                "min_relevant_pct": min_relevant_pct,
                "max_noise_pct": max_noise_pct,
            },
            "top_examples": sample[:10],
        }

    path = Path(report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def _to_markdown_table(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "_No rows_"
    headers = [
        "id",
        "headline",
        "company",
        "tier",
        "role_family",
        "career_stage",
        "years_required_min",
        "swedish_required",
        "consultancy_flag",
        "relevance_score",
        "published_at",
    ]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    str(row.get("id", "")),
                    str(row.get("headline", "")).replace("|", "/"),
                    str(row.get("company_canonical") or row.get("employer_name") or "").replace("|", "/"),
                    str(row.get("company_tier", "unknown")),
                    str(row.get("role_family", "")),
                    str(row.get("career_stage", "unknown")),
                    str(row.get("years_required_min", "")),
                    str(bool(row.get("swedish_required", False))),
                    str(bool(row.get("consultancy_flag", False))),
                    str(row.get("relevance_score", "")),
                    str(row.get("published_at", "")),
                ]
            )
            + " |"
        )
    return "\n".join(lines)


def launch_readiness_report(
    storage: SupabaseStorage,
    profile: TargetProfile,
    *,
    top_relevant_size: int = 20,
    top_early_career_size: int = 50,
    top_consultancy_size: int = 20,
    noise_sample_size: int = 200,
    min_top_20_relevant_pct: int = 85,
    min_top_50_early_career_pct: int = 40,
    max_top_20_consultancy_share_pct: int = 25,
    max_noise_sample_200_pct: int = 5,
    report_json_path: str = "pipeline/reports/launch_gate_report.json",
    report_markdown_path: str | None = "docs/launch_gate_report.md",
) -> dict[str, Any]:
    generated_at = datetime.now(UTC).isoformat()
    include_set = profile.include_role_families
    minimum_target_score = int(profile.scoring.get("minimum_target_score", 18))
    early_career_stages = {"graduate", "trainee", "junior"}

    base_limit = max(top_relevant_size, top_early_career_size, top_consultancy_size, noise_sample_size)
    base_rows = storage.sample_target_jobs(limit=base_limit)
    top_relevant_rows = base_rows[:top_relevant_size]
    top_early_career_rows = base_rows[:top_early_career_size]
    top_consultancy_rows = base_rows[:top_consultancy_size]
    noise_sample_rows = base_rows[:noise_sample_size]

    top_20_relevant_count = sum(
        1
        for row in top_relevant_rows
        if row.get("role_family") in include_set
        and not bool(row.get("is_noise"))
        and int(row.get("relevance_score") or 0) >= minimum_target_score
    )
    top_50_early_career_count = sum(
        1
        for row in top_early_career_rows
        if bool(row.get("is_grad_program"))
        or str(row.get("career_stage") or "unknown").strip().lower() in early_career_stages
    )
    top_20_consultancy_count = sum(1 for row in top_consultancy_rows if bool(row.get("consultancy_flag")))
    noise_sample_count = sum(
        1
        for row in noise_sample_rows
        if bool(row.get("is_noise")) or str(row.get("role_family") or "").strip().lower() == "noise"
    )

    top_20_relevant_pct = _pct(top_20_relevant_count, len(top_relevant_rows))
    top_50_early_career_pct = _pct(top_50_early_career_count, len(top_early_career_rows))
    top_20_consultancy_share_pct = _pct(top_20_consultancy_count, len(top_consultancy_rows))
    noise_sample_200_pct = _pct(noise_sample_count, len(noise_sample_rows))

    passes_launch_gate = (
        top_20_relevant_pct >= min_top_20_relevant_pct
        and top_50_early_career_pct >= min_top_50_early_career_pct
        and top_20_consultancy_share_pct <= max_top_20_consultancy_share_pct
        and noise_sample_200_pct <= max_noise_sample_200_pct
    )

    report = {
        "generated_at": generated_at,
        "top_20_relevant_pct": top_20_relevant_pct,
        "top_50_early_career_pct": top_50_early_career_pct,
        "top_20_consultancy_share_pct": top_20_consultancy_share_pct,
        "noise_sample_200_pct": noise_sample_200_pct,
        "passes_launch_gate": passes_launch_gate,
        "thresholds": {
            "min_top_20_relevant_pct": min_top_20_relevant_pct,
            "min_top_50_early_career_pct": min_top_50_early_career_pct,
            "max_top_20_consultancy_share_pct": max_top_20_consultancy_share_pct,
            "max_noise_sample_200_pct": max_noise_sample_200_pct,
        },
        "counts": {
            "top_20_relevant_count": top_20_relevant_count,
            "top_20_total": len(top_relevant_rows),
            "top_50_early_career_count": top_50_early_career_count,
            "top_50_total": len(top_early_career_rows),
            "top_20_consultancy_count": top_20_consultancy_count,
            "top_20_consultancy_total": len(top_consultancy_rows),
            "noise_sample_200_count": noise_sample_count,
            "noise_sample_200_total": len(noise_sample_rows),
        },
        "definitions": {
            "top_20_relevant_pct": "Rows in top-20 where role_family is included, is_noise is false, and relevance_score >= minimum_target_score.",
            "top_50_early_career_pct": "Rows in top-50 where is_grad_program is true OR career_stage is graduate/trainee/junior.",
            "top_20_consultancy_share_pct": "Rows in top-20 where consultancy_flag is true.",
            "noise_sample_200_pct": "Rows in top-200 where is_noise is true OR role_family is noise.",
        },
        "top_20_preview": top_relevant_rows,
        "top_50_preview": top_early_career_rows[:20],
    }

    json_file = Path(report_json_path)
    json_file.parent.mkdir(parents=True, exist_ok=True)
    json_file.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if report_markdown_path:
        notes: list[str] = []
        if len(top_relevant_rows) < top_relevant_size:
            notes.append(f"Top relevant sample has only {len(top_relevant_rows)} rows (expected {top_relevant_size}).")
        if len(top_early_career_rows) < top_early_career_size:
            notes.append(
                f"Top early-career sample has only {len(top_early_career_rows)} rows (expected {top_early_career_size})."
            )
        if len(noise_sample_rows) < noise_sample_size:
            notes.append(f"Noise sample has only {len(noise_sample_rows)} rows (expected {noise_sample_size}).")

        md_lines = [
            "# Launch Gate Report",
            "",
            f"Generated at: `{generated_at}`",
            "",
            "## Gate Result",
            "",
            f"- passes_launch_gate: **{passes_launch_gate}**",
            "",
            "## Metrics",
            "",
            f"- top_20_relevant_pct: **{top_20_relevant_pct}%** (threshold: >= {min_top_20_relevant_pct}%)",
            f"- top_50_early_career_pct: **{top_50_early_career_pct}%** (threshold: >= {min_top_50_early_career_pct}%)",
            f"- top_20_consultancy_share_pct: **{top_20_consultancy_share_pct}%** (threshold: <= {max_top_20_consultancy_share_pct}%)",
            f"- noise_sample_200_pct: **{noise_sample_200_pct}%** (threshold: <= {max_noise_sample_200_pct}%)",
            "",
            "## Notes",
            "",
            *(f"- {note}" for note in notes),
            *([] if notes else ["- None"]),
            "",
            "## Top 20 Preview",
            "",
            _to_markdown_table(top_relevant_rows),
            "",
        ]
        md_file = Path(report_markdown_path)
        md_file.parent.mkdir(parents=True, exist_ok=True)
        md_file.write_text("\n".join(md_lines), encoding="utf-8")

    return report


def precision_review_phase15(
    storage: SupabaseStorage,
    profile: TargetProfile,
    *,
    top_n: int = 100,
    period_days: int = 14,
    markdown_path: str = "docs/precision_review_phase1_5.md",
    json_path: str = "pipeline/reports/precision_review_phase1_5.json",
) -> dict[str, Any]:
    now = datetime.now(UTC)
    period_start = now.astimezone(UTC).replace(microsecond=0) - timedelta(days=period_days)
    period_end = now.astimezone(UTC).replace(microsecond=0)

    sample = storage.sample_target_jobs(limit=top_n)
    top20 = sample[:20]
    include_set = profile.include_role_families
    early_career_stages = {"graduate", "trainee", "junior"}

    auto_relevant_top20 = sum(
        1
        for row in top20
        if row.get("role_family") in include_set
        and not bool(row.get("is_noise"))
        and int(row.get("relevance_score") or 0) >= profile.scoring.get("minimum_target_score", 18)
    )
    top20_precision_estimate = int(round((auto_relevant_top20 / len(top20)) * 100)) if top20 else 0
    early_career_hits = sum(
        1
        for row in sample
        if bool(row.get("is_grad_program")) or str(row.get("career_stage") or "unknown") in early_career_stages
    )
    early_career_hit_rate = int(round((early_career_hits / len(sample)) * 100)) if sample else 0
    clear_noise_count = sum(
        1 for row in sample if bool(row.get("is_noise")) or str(row.get("role_family") or "") == "noise"
    )

    tier_counts = Counter(str(row.get("company_tier") or "unknown") for row in sample)
    stage_counts = Counter(str(row.get("career_stage") or "unknown") for row in sample)

    main_companies = sorted(profile.main_companies)
    company_rows = storage.fetch_jobs_for_companies(
        company_names=main_companies,
        period_start=period_start.isoformat(),
        period_end=period_end.isoformat(),
    )
    company_count_map: dict[str, int] = {name: 0 for name in main_companies}
    for row in company_rows:
        canonical = str(row.get("company_canonical") or "").strip()
        if canonical in company_count_map:
            company_count_map[canonical] += 1

    with_matches = [name for name, count in company_count_map.items() if count > 0]
    zero_matches = [name for name, count in company_count_map.items() if count == 0]
    missing_company_rate_pct = (
        int(round((len(zero_matches) / len(main_companies)) * 100)) if main_companies else 0
    )

    report = {
        "generated_at": now.isoformat(),
        "window_days": period_days,
        "sample_size": len(sample),
        "top20_precision_estimate_pct": top20_precision_estimate,
        "early_career_hit_rate_pct": early_career_hit_rate,
        "clear_noise_count": clear_noise_count,
        "company_tier_distribution": dict(tier_counts),
        "career_stage_distribution": dict(stage_counts),
        "source_gap": {
            "main_companies_total": len(main_companies),
            "companies_with_matches": len(with_matches),
            "companies_with_zero_matches": len(zero_matches),
            "missing_company_rate_pct": missing_company_rate_pct,
            "with_matches": with_matches,
            "zero_matches": zero_matches,
        },
        "linkedin_comparison": {
            "status": "manual_required",
            "notes": "Compare against LinkedIn for the same 14-day window and fill this section manually.",
        },
        "top100_rows": sample,
    }

    json_file = Path(json_path)
    json_file.parent.mkdir(parents=True, exist_ok=True)
    json_file.write_text(json.dumps(report, indent=2), encoding="utf-8")

    md = [
        "# Phase 1.5 Precision Review",
        "",
        f"Generated at: `{report['generated_at']}`",
        f"Window: last `{period_days}` days",
        "",
        "## Metrics",
        "",
        f"- Top 20 precision estimate: **{top20_precision_estimate}%**",
        f"- Early-career hit rate (top {len(sample)}): **{early_career_hit_rate}%**",
        f"- Clear noise count (top {len(sample)}): **{clear_noise_count}**",
        "",
        "## Source Gap (Main Companies)",
        "",
        f"- Main companies total: **{len(main_companies)}**",
        f"- With matches: **{len(with_matches)}**",
        f"- Zero matches: **{len(zero_matches)}**",
        f"- Missing-company rate: **{missing_company_rate_pct}%**",
        "",
        "### Companies With Matches",
        "",
        ", ".join(with_matches) if with_matches else "_None_",
        "",
        "### Companies With Zero Matches",
        "",
        ", ".join(zero_matches) if zero_matches else "_None_",
        "",
        "## Manual Review Checklist (Required)",
        "",
        "- Review top 100 rows below and mark truly relevant vs noise.",
        "- Compare against LinkedIn for the same 14-day period for target companies.",
        "- Decide gate: tune relevance first vs proceed to connectors.",
        "",
        "## Top 100 Best Matches",
        "",
        _to_markdown_table(sample),
        "",
    ]
    md_file = Path(markdown_path)
    md_file.parent.mkdir(parents=True, exist_ok=True)
    md_file.write_text("\n".join(md), encoding="utf-8")
    return report
