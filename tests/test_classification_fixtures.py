from __future__ import annotations

import json
import unittest
from pathlib import Path

from pipeline.classify import classify_job
from pipeline.target_profile import load_target_profile


class ClassificationFixtureTests(unittest.TestCase):
    def test_precise_title_cleanup_regressions(self) -> None:
        profile = load_target_profile("pipeline/config/target_profile.yaml")
        fixtures = json.loads(
            Path("tests/fixtures/classification_cases.json").read_text(encoding="utf-8")
        )

        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                result = classify_job(fixture["job"], profile)
                self.assertEqual(result.is_noise, fixture["is_noise"])
                self.assertEqual(result.is_target_role, not fixture["is_noise"])
                if fixture.get("reason"):
                    self.assertIn(fixture["reason"], result.reason_codes)


if __name__ == "__main__":
    unittest.main()
