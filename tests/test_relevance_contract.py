from __future__ import annotations

import json
import unittest
from pathlib import Path

from pipeline.v3_runtime import lens_matches


class RelevanceContractTests(unittest.TestCase):
    def test_explore_query_selects_active_state_required_by_eligibility(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertIn('"id, is_active, headline, headline_en, description, description_en, employer_name', jobs_page)

    def test_explore_imports_detail_panel_icons(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        lucide_import = jobs_page.split('from "lucide-react";', 1)[0]
        for icon in ("Bookmark", "ChevronsUpDown"):
            with self.subTest(icon=icon):
                self.assertIn(icon, lucide_import)

    def test_explore_defaults_to_for_you_broad_lens(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertIn('{ id: "broad", label: "For You"', jobs_page)
        self.assertIn('return "broad";', jobs_page)
        self.assertIn('setLens("broad");', jobs_page)

    def test_explore_accepts_public_lens_url_aliases(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertIn('normalized === "graduate"', jobs_page)
        self.assertIn('normalized === "high-signal"', jobs_page)
        self.assertIn('next.set("lens", nextLens)', jobs_page)

    def test_view_posting_does_not_auto_track_application(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertIn("View posting", jobs_page)
        self.assertNotIn("const trackApplyClick = () =>", jobs_page)
        self.assertNotIn("onClick={trackApplyClick}", jobs_page)
        self.assertIn('upsertTracking.mutate({ status: "applied", notes })', jobs_page)

    def test_explore_does_not_duplicate_senior_eligibility_regex(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertNotIn("SENIOR_TITLE_PATTERN", jobs_page)
        self.assertIn("hasSeniorRoleSignal", jobs_page)

    def test_explore_deduplicates_exact_company_title_across_locations(self) -> None:
        jobs_page = Path("src/pages/Jobs.tsx").read_text(encoding="utf-8")
        self.assertIn('return `${company}::${title}`;', jobs_page)
        self.assertNotIn('return `${company}::${title}::${location}`;', jobs_page)

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
