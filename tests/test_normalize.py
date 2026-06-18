from __future__ import annotations

import unittest

from pipeline.normalize import normalize_job


class NormalizeTests(unittest.TestCase):
    def test_jobtech_prefers_employer_application_url(self) -> None:
        normalized, _ = normalize_job(
            {
                "id": 123,
                "headline": "Junior Software Engineer",
                "webpage_url": "https://arbetsformedlingen.se/platsbanken/annonser/123",
                "application_details": {"url": "https://jobs.example.com/apply/123"},
                "apply_url": "https://fallback.example.com/apply/123",
            }
        )
        self.assertEqual(normalized["source_url"], "https://jobs.example.com/apply/123")

    def test_jobtech_uses_apply_url_before_platsbanken_fallback(self) -> None:
        normalized, _ = normalize_job(
            {
                "id": 124,
                "headline": "Backend Developer",
                "webpage_url": "https://arbetsformedlingen.se/platsbanken/annonser/124",
                "apply_url": "https://jobs.example.com/apply/124",
            }
        )
        self.assertEqual(normalized["source_url"], "https://jobs.example.com/apply/124")

    def test_jobtech_falls_back_to_webpage_url(self) -> None:
        normalized, _ = normalize_job(
            {
                "id": 125,
                "headline": "Data Engineer",
                "webpage_url": "https://arbetsformedlingen.se/platsbanken/annonser/125",
            }
        )
        self.assertEqual(
            normalized["source_url"],
            "https://arbetsformedlingen.se/platsbanken/annonser/125",
        )

    def test_direct_ats_url_precedence_is_unchanged(self) -> None:
        normalized, _ = normalize_job(
            {
                "id": "lever:example:126",
                "headline": "Software Engineer",
                "source_name": "lever",
                "source_kind": "direct_company_ats",
                "webpage_url": "https://jobs.example.com/careers/126",
                "source_url": "https://jobs.example.com/source/126",
                "application_details": {"url": "https://jobs.example.com/apply/126"},
            }
        )
        self.assertEqual(normalized["source_url"], "https://jobs.example.com/careers/126")


if __name__ == "__main__":
    unittest.main()
