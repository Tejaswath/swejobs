from __future__ import annotations

import unittest

from pipeline.worker import run_ats_only_cycle


class FakePipeline:
    def __init__(self, *, over_budget: bool = False) -> None:
        self.calls: list[tuple] = []
        self.over_budget = over_budget

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


class WorkerModeTests(unittest.TestCase):
    def test_ats_only_cycle_never_polls_jobtech(self) -> None:
        pipeline = FakePipeline()

        report = run_ats_only_cycle(pipeline, max_rows=2000, max_http=100)

        self.assertEqual(
            pipeline.calls,
            [
                ("budget_check",),
                ("company_feeds", 2000, 100),
                ("translation",),
                ("deadline_expiry",),
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
                ("budget_check",),
                ("translation",),
                ("deadline_expiry",),
                ("compaction",),
            ],
        )
        self.assertEqual(report["company_feeds_skipped"], "active_job_budget")
        self.assertEqual(report["deadline_expiry"]["expired_rows"], 2)


if __name__ == "__main__":
    unittest.main()
