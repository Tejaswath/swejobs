from __future__ import annotations

import unittest

from pipeline.classify import classify_job
from pipeline.target_profile import TargetProfile


def _profile() -> TargetProfile:
    return TargetProfile(
        data={
            "role_families": {
                "include": [
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
                ],
                "soft_include": [],
                "exclude_domains": [],
            },
            "regions": {"include_codes": [], "include_names": []},
            "language": {"preferred": ["en", "mixed"]},
            "remote": {"preference": "remote_or_hybrid"},
            "skills": {"stretch": []},
            "scoring": {
                "minimum_target_score": 0,
                "noise_threshold": -20,
            },
        },
        company_tier_map={},
        company_alias_map={},
    )


class ClassifyRestrictionTests(unittest.TestCase):
    def test_senior_title_wins_over_junior_mentions(self) -> None:
        result = classify_job(
            {
                "headline": "Senior AI Engineer",
                "description": "Mentor junior developers in the team and drive ML platform work.",
                "occupation_label": "Software Engineer",
                "employer_name": "Example AB",
                "lang": "en",
                "remote_flag": True,
            },
            _profile(),
        )
        self.assertEqual(result.career_stage, "senior")
        self.assertIn("career_stage_senior", result.reason_codes)

    def test_experienced_and_expert_titles_are_senior(self) -> None:
        for headline in ("Experienced Computer Vision Engineer", "Expert Deep Learning Engineer"):
            with self.subTest(headline=headline):
                result = classify_job(
                    {
                        "headline": headline,
                        "description": "Build production software.",
                        "occupation_label": "Software Engineer",
                        "employer_name": "Example AB",
                        "lang": "en",
                    },
                    _profile(),
                )
                self.assertEqual(result.career_stage, "senior")
                self.assertIn("career_stage_senior", result.reason_codes)

    def test_swedish_senior_title_variants_are_senior(self) -> None:
        for headline in ("Saab söker erfarna systemingenjörer!", "Fleråriga utvecklare till plattformsteam"):
            with self.subTest(headline=headline):
                result = classify_job(
                    {
                        "headline": headline,
                        "description": "Bygg och underhåll mjukvara.",
                        "occupation_label": "Software Engineer",
                        "employer_name": "Example AB",
                        "lang": "sv",
                    },
                    _profile(),
                )
                self.assertEqual(result.career_stage, "senior")
                self.assertIn("career_stage_senior", result.reason_codes)

    def test_description_technology_tokens_do_not_create_software_role(self) -> None:
        result = classify_job(
            {
                "headline": "Marketing Coordinator",
                "description": "Work with our Python, React, and API engineering teams.",
                "occupation_label": "Marketing",
                "employer_name": "Example AB",
                "lang": "en",
            },
            _profile(),
        )
        self.assertEqual(result.role_family, "noise")
        self.assertEqual(result.role_family_confidence, 0.0)
        self.assertFalse(result.is_target_role)

    def test_generic_developer_title_can_be_confirmed_by_description(self) -> None:
        result = classify_job(
            {
                "headline": "Integrations Developer",
                "description": "Build Python APIs and backend integrations.",
                "occupation_label": "Developer",
                "employer_name": "Example AB",
                "lang": "en",
            },
            _profile(),
        )
        self.assertEqual(result.role_family, "backend")
        self.assertEqual(result.role_family_confidence, 0.7)
        self.assertIn("role_family_description_confirmed", result.reason_codes)
        self.assertTrue(result.is_target_role)

    def test_swedish_numeric_experience_is_detected(self) -> None:
        result = classify_job(
            {
                "headline": "Backend Engineer",
                "description": "Du har minst 3 års erfarenhet av Python.",
                "occupation_label": "Software Engineer",
                "employer_name": "Example AB",
                "lang": "mixed",
            },
            _profile(),
        )
        self.assertEqual(result.years_required_min, 3)
        self.assertIn("years_required_3plus", result.reason_codes)

    def test_swedish_fluency_requirement_is_suppressed(self) -> None:
        result = classify_job(
            {
                "headline": "Backend Engineer",
                "description": "Fluency in Swedish is required. Build APIs in Python.",
                "occupation_label": "Software Engineer",
                "employer_name": "Example AB",
                "lang": "en",
                "remote_flag": True,
            },
            _profile(),
        )
        self.assertTrue(result.swedish_required)
        self.assertFalse(result.is_target_role)
        self.assertTrue(result.is_noise)
        self.assertIn("restricted_market", result.reason_codes)

    def test_no_visa_sponsorship_is_suppressed(self) -> None:
        result = classify_job(
            {
                "headline": "Data Engineer",
                "description": "No visa sponsorship provided. Must have a valid work permit.",
                "occupation_label": "Software Engineer",
                "employer_name": "Example AB",
                "lang": "en",
                "remote_flag": False,
            },
            _profile(),
        )
        self.assertTrue(result.citizenship_required)
        self.assertFalse(result.is_target_role)
        self.assertTrue(result.is_noise)
        self.assertIn("restricted_market", result.reason_codes)


if __name__ == "__main__":
    unittest.main()
