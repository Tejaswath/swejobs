from __future__ import annotations

import unittest

from pipeline.worker import run_ats_only_cycle


class FakePipeline:
    def __init__(self, *, over_budget: bool = False) -> None:
        self.calls: list[tuple] = []
        self.over_budget = over_budget
        self.storage = None

    def over_storage_budget(self) -> bool:
        self.calls.append(("budget_check",))
        return self.over_budget

    def run_company_feeds_once(self, *, max_rows: int, max_http: int) -> dict:
        self.calls.append(("company_feeds", max_rows, max_http))
        return {"processed_rows": 12, "target_rows": 5, "http_requests": 8, "feeds_run": 4}

    def maybe_translate_jobs(self) -> bool:
        self.calls.append(("translation",))
        return False

    def maybe_expire_jobs_past_deadline(self) -> dict:
        self.calls.append(("deadline_expiry",))
        return {"status": "ok", "expired_rows": 2}

    def maybe_run_compaction(self) -> bool:
        self.calls.append(("compaction",))
        return True

    def run_stream_once(self, *, limit: int) -> int:
        raise AssertionError("ATS-only worker must never poll JobTech")

    def run_jobtech_topup(self, *, limit: int, apply: bool, since_days: int, max_age_days: int) -> dict:
        self.calls.append(("jobtech_topup", limit, apply, since_days, max_age_days))
        return {"status": "applied", "persisted": 3}


class FakeStateStorage:
    def __init__(self) -> None:
        self.state: dict[str, str] = {"last_user_ranking_recalculation_at": "2099-01-01T00:00:00+00:00"}

    def get_ingestion_state(self, keys: list[str] | None = None) -> dict[str, str]:
        if not keys:
            return dict(self.state)
        return {key: self.state[key] for key in keys if key in self.state}

    def upsert_ingestion_state(self, values: dict[str, str]) -> None:
        self.state.update(values)


class WorkerModeTests(unittest.TestCase):
    def test_ats_only_cycle_never_polls_jobtech(self) -> None:
        pipeline = FakePipeline()

        report = run_ats_only_cycle(pipeline, max_rows=2000, max_http=100)

        self.assertEqual(
            pipeline.calls,
            [
                ("deadline_expiry",),
                ("budget_check",),
                ("company_feeds", 2000, 100),
                ("translation",),
                ("compaction",),
            ],
        )
        self.assertEqual(report["company_feeds"]["target_rows"], 5)
        self.assertEqual(report["deadline_expiry"]["expired_rows"], 2)
        self.assertFalse(report["user_ranking"])

    def test_ats_only_cycle_skips_ingest_over_active_job_budget_but_runs_maintenance(self) -> None:
        pipeline = FakePipeline(over_budget=True)

        report = run_ats_only_cycle(pipeline, max_rows=2000, max_http=100)

        self.assertEqual(
            pipeline.calls,
            [
                ("deadline_expiry",),
                ("budget_check",),
                ("translation",),
                ("compaction",),
            ],
        )
        self.assertEqual(report["company_feeds_skipped"], "active_job_budget")
        self.assertEqual(report["deadline_expiry"]["expired_rows"], 2)

    def test_ats_only_cycle_runs_enabled_topup_on_interval(self) -> None:
        pipeline = FakePipeline()

        report = run_ats_only_cycle(
            pipeline,
            max_rows=2000,
            max_http=100,
            jobtech_topup_enabled=True,
            jobtech_topup_limit=50,
            jobtech_topup_interval_cycles=1,
            jobtech_topup_since_days=21,
            jobtech_topup_max_age_days=21,
        )

        self.assertIn(("jobtech_topup", 50, True, 21, 21), pipeline.calls)
        self.assertEqual(report["jobtech_topup"]["persisted"], 3)

    def test_feed_health_separates_failures_from_auto_disabled(self) -> None:
        pipeline = FakePipeline()
        pipeline.storage = FakeStateStorage()
        pipeline.run_company_feeds_once = lambda **_kwargs: {  # type: ignore[method-assign]
            "processed_rows": 1,
            "target_rows": 1,
            "http_requests": 1,
            "feeds_run": 3,
            "feed_results": [
                {"feed_key": "healthy", "status": "ok"},
                {"feed_key": "broken", "status": "http_error"},
                {"feed_key": "paused", "status": "skipped_auto_disabled"},
            ],
        }

        report = run_ats_only_cycle(pipeline, max_rows=20, max_http=3)

        self.assertEqual(report["company_feeds"]["actual_failure_count"], 1)
        self.assertEqual(report["company_feeds"]["auto_disabled_count"], 1)
        self.assertEqual(pipeline.storage.state["worker:last_feed_failure_count"], "1")
        self.assertEqual(pipeline.storage.state["worker:last_feed_failures"], "broken")
        self.assertEqual(pipeline.storage.state["worker:last_feed_auto_disabled_count"], "1")


if __name__ == "__main__":
    unittest.main()
