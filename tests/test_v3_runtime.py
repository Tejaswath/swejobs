from __future__ import annotations

import unittest

from pipeline.v3_runtime import lens_matches, promote_company_feeds, refresh_feed_quality


class V3StorageFake:
    def __init__(self) -> None:
        self.registry_rows = [
            {
                "feed_key": "trusted_feed",
                "provider": "greenhouse",
                "company_canonical": "example",
                "enabled": True,
                "high_signal_eligible": False,
                "quality_band": "verified",
            },
            {
                "feed_key": "weak_feed",
                "provider": "teamtailor",
                "company_canonical": "weakco",
                "enabled": True,
                "high_signal_eligible": True,
                "quality_band": "candidate",
            },
        ]
        self.probe_rows = [
            {
                "feed_key": "trusted_feed",
                "http_status": 200,
                "error_text": None,
                "target_rows": 4,
                "persisted_rows": 4,
                "removed_rows": 0,
            },
            {
                "feed_key": "trusted_feed",
                "http_status": 200,
                "error_text": None,
                "target_rows": 3,
                "persisted_rows": 3,
                "removed_rows": 0,
            },
            {
                "feed_key": "trusted_feed",
                "http_status": 200,
                "error_text": None,
                "target_rows": 2,
                "persisted_rows": 2,
                "removed_rows": 0,
            },
            {
                "feed_key": "trusted_feed",
                "http_status": 200,
                "error_text": None,
                "target_rows": 1,
                "persisted_rows": 1,
                "removed_rows": 0,
            },
            {
                "feed_key": "weak_feed",
                "http_status": 500,
                "error_text": "server error",
                "target_rows": 0,
                "persisted_rows": 0,
                "removed_rows": 0,
            },
            {
                "feed_key": "weak_feed",
                "http_status": 500,
                "error_text": "server error",
                "target_rows": 0,
                "persisted_rows": 0,
                "removed_rows": 0,
            },
            {
                "feed_key": "weak_feed",
                "http_status": 500,
                "error_text": "server error",
                "target_rows": 0,
                "persisted_rows": 0,
                "removed_rows": 0,
            },
            {
                "feed_key": "weak_feed",
                "http_status": 500,
                "error_text": "server error",
                "target_rows": 0,
                "persisted_rows": 0,
                "removed_rows": 0,
            },
        ]
        self.upsert_rows: list[dict] = []

    def fetch_source_feed_registry(self):
        return list(self.registry_rows)

    def fetch_source_feed_probe_runs_since(self, *, since_iso: str, feed_keys=None):
        return list(self.probe_rows)

    def upsert_source_feed_registry_rows(self, rows):
        self.upsert_rows.extend(rows)
        return len(rows)


class V3RuntimeTests(unittest.TestCase):
    def test_high_signal_lens_respects_source_band_and_jobtech_toggle(self) -> None:
        registry = {
            "trusted_feed": {
                "enabled": True,
                "high_signal_eligible": True,
                "quality_band": "trusted",
            }
        }
        base_job = {
            "is_active": True,
            "is_target_role": True,
            "is_noise": False,
            "relevance_score": 50,
            "source_kind": "direct_company_ats",
            "source_feed_key": "trusted_feed",
            "is_grad_program": False,
            "career_stage": "mid",
            "years_required_min": 2,
        }

        self.assertTrue(lens_matches(base_job, lens="high_signal", feed_registry=registry, include_jobtech_in_high_signal=False))

        jobtech_job = {**base_job, "source_kind": "jobtech", "source_feed_key": None}
        self.assertFalse(
            lens_matches(jobtech_job, lens="high_signal", feed_registry=registry, include_jobtech_in_high_signal=False)
        )
        self.assertTrue(
            lens_matches(jobtech_job, lens="high_signal", feed_registry=registry, include_jobtech_in_high_signal=True)
        )

    def test_graduate_lens_threshold(self) -> None:
        registry = {}
        job = {
            "is_active": True,
            "is_target_role": False,
            "is_noise": False,
            "relevance_score": 15,
            "source_kind": "jobtech",
            "source_feed_key": None,
            "is_grad_program": False,
            "career_stage": "junior",
            "years_required_min": 1,
        }
        self.assertTrue(lens_matches(job, lens="graduate_trainee", feed_registry=registry, include_jobtech_in_high_signal=False))

    def test_graduate_lens_rejects_senior_signals(self) -> None:
        registry = {}
        job = {
            "is_active": True,
            "is_target_role": True,
            "is_noise": False,
            "relevance_score": 80,
            "source_kind": "jobtech",
            "source_feed_key": None,
            "headline": "Senior AI Engineer",
            "career_stage": "senior",
            "years_required_min": 0,
            "reason_codes": ["career_stage_senior"],
        }
        self.assertFalse(
            lens_matches(job, lens="graduate_trainee", feed_registry=registry, include_jobtech_in_high_signal=False)
        )

    def test_restricted_market_roles_are_excluded(self) -> None:
        registry = {
            "trusted_feed": {
                "enabled": True,
                "high_signal_eligible": True,
                "quality_band": "trusted",
            }
        }
        job = {
            "is_active": True,
            "is_target_role": True,
            "is_noise": False,
            "relevance_score": 70,
            "source_kind": "direct_company_ats",
            "source_feed_key": "trusted_feed",
            "swedish_required": True,
        }
        self.assertFalse(lens_matches(job, lens="high_signal", feed_registry=registry, include_jobtech_in_high_signal=False))
        self.assertFalse(lens_matches(job, lens="broad", feed_registry=registry, include_jobtech_in_high_signal=False))

    def test_refresh_feed_quality_recommends_trusted_and_blocked(self) -> None:
        storage = V3StorageFake()
        report = refresh_feed_quality(storage, lookback_days=14, min_runs=4, apply=False)

        by_feed = {entry["feed_key"]: entry for entry in report["recommendations"]}
        self.assertEqual(by_feed["trusted_feed"]["recommended_band"], "trusted")
        self.assertEqual(by_feed["weak_feed"]["recommended_band"], "blocked")
        self.assertEqual(report["threshold_profile"], "strict")
        self.assertIn("thresholds_used", report)
        self.assertGreaterEqual(report["changes_detected"], 1)
        self.assertEqual(storage.upsert_rows, [])

    def test_refresh_feed_quality_keeps_current_band_when_runs_below_minimum(self) -> None:
        storage = V3StorageFake()
        storage.probe_rows = storage.probe_rows[:2]
        report = refresh_feed_quality(storage, lookback_days=14, min_runs=4, apply=False)
        by_feed = {entry["feed_key"]: entry for entry in report["recommendations"]}

        self.assertEqual(by_feed["trusted_feed"]["recommended_band"], "verified")
        self.assertEqual(by_feed["trusted_feed"]["reason_codes"], ["insufficient_runs<4"])

    def test_refresh_feed_quality_hard_blocks_repeated_zero_success(self) -> None:
        storage = V3StorageFake()
        storage.probe_rows = [
            {
                "feed_key": "weak_feed",
                "http_status": 500,
                "error_text": "server error",
                "target_rows": 0,
                "persisted_rows": 0,
                "removed_rows": 0,
                "http_requests": 1,
            },
            {
                "feed_key": "weak_feed",
                "http_status": 404,
                "error_text": "http_404",
                "target_rows": 0,
                "persisted_rows": 0,
                "removed_rows": 0,
                "http_requests": 1,
            },
        ]
        report = refresh_feed_quality(storage, lookback_days=14, min_runs=4, apply=False)
        by_feed = {entry["feed_key"]: entry for entry in report["recommendations"]}

        self.assertEqual(by_feed["weak_feed"]["recommended_band"], "blocked")
        self.assertEqual(by_feed["weak_feed"]["recommended_high_signal_eligible"], False)

    def test_promote_company_feeds_apply_updates_registry_only(self) -> None:
        storage = V3StorageFake()
        report = promote_company_feeds(storage, mode="apply")

        self.assertEqual(report["candidate_count"], 1)
        self.assertEqual(report["applied_count"], 1)
        self.assertEqual(storage.upsert_rows[0]["feed_key"], "trusted_feed")
        self.assertTrue(storage.upsert_rows[0]["high_signal_eligible"])


if __name__ == "__main__":
    unittest.main()
