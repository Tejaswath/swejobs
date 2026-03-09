from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .storage import SupabaseStorage
from .target_profile import TargetProfile


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
