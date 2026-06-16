from __future__ import annotations

import json
import unittest
from pathlib import Path

from pipeline.v3_runtime import lens_matches


class RelevanceContractTests(unittest.TestCase):
    def test_explore_query_selects_active_state_required_by_eligibility(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertIn('"id, is_active, headline, headline_en, employer_name', jobs_page)

    def test_explore_imports_detail_panel_icons(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        lucide_import = jobs_page.split('from "lucide-react";', 1)[0]
        for icon in ("Bookmark", "ChevronsUpDown"):
            with self.subTest(icon=icon):
                self.assertIn(icon, lucide_import)

    def test_apply_link_auto_tracks_application(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertIn("const trackApplyClick = () =>", jobs_page)
        self.assertIn('onClick={trackApplyClick}', jobs_page)
        self.assertIn('upsertTracking.mutate({ status: "applied", notes })', jobs_page)

    def test_explore_does_not_duplicate_senior_eligibility_regex(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertNotIn("SENIOR_TITLE_PATTERN", jobs_page)
        self.assertIn("hasSeniorRoleSignal", jobs_page)

    def test_shared_eligibility_fixtures(self) -> None:
        fixtures = json.loads(Path("tests/fixtures/eligibility_cases.json").read_text(encoding="utf-8"))
        registry = {
            "trusted_feed": {
                "enabled": True,
                "high_signal_eligible": True,
                "quality_band": "trusted",
            }
        }
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                job = fixture["job"]
                self.assertEqual(
                    lens_matches(job, lens="high_signal", feed_registry=registry, include_jobtech_in_high_signal=False),
                    fixture["high_signal"],
                )
                self.assertEqual(
                    lens_matches(
                        job,
                        lens="graduate_trainee",
                        feed_registry=registry,
                        include_jobtech_in_high_signal=False,
                    ),
                    fixture["graduate_trainee"],
                )
