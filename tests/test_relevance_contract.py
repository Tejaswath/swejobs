from __future__ import annotations

import json
import unittest
from pathlib import Path

from pipeline.v3_runtime import lens_matches


class RelevanceContractTests(unittest.TestCase):
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
