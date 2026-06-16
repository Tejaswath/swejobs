from __future__ import annotations

import unittest

from pipeline.ingest import IngestionPipeline
from pipeline.target_profile import TargetProfile


class FakeStorage:
    def __init__(self) -> None:
        self.persisted_batches: list[dict] = []
        self.state: dict[str, str] = {}
        self.active_jobs = 0

    def fetch_existing_jobs(self, job_ids: list[int]) -> dict[int, dict]:
        return {}

    def fetch_jobs_by_source_urls(self, urls: list[str]) -> dict[str, dict]:
        return {}

    def persist_batch(self, *, jobs: list[dict], tags_by_job_id: dict[int, list[str]], events: list[dict]) -> None:
        self.persisted_batches.append({"jobs": jobs, "tags": tags_by_job_id, "events": events})

    def upsert_ingestion_state(self, values: dict[str, str]) -> None:
        self.state.update(values)

    def count_active_jobs(self) -> int:
        return self.active_jobs


def make_pipeline(storage: FakeStorage) -> IngestionPipeline:
    return IngestionPipeline(
        client=object(),
        storage=storage,
        profile=TargetProfile(data={}, company_tier_map={}, company_alias_map={}),
        batch_size=200,
        poll_seconds=60,
        digest_window_days=30,
        digest_refresh_minutes=60,
        timezone="Europe/Stockholm",
        request_timeout_seconds=30,
        enable_company_feeds=False,
        company_feed_config_path="pipeline/config/company_feeds.yaml",
        feed_interval_polls=5,
        feed_http_budget=3,
        feed_row_budget=40,
        feed_consecutive_miss_threshold=10,
        stream_reset_stale_cursor_hours=24,
        compaction_interval_hours=24,
        compaction_raw_json_days=2,
        compaction_inactive_job_days=60,
        compaction_job_event_days=30,
        compaction_weekly_digest_days=180,
        enable_translation=False,
        max_active_jobs=2,
    )


class JobTechGuardrailTests(unittest.TestCase):
    def test_irrelevant_jobtech_rows_are_not_persisted(self) -> None:
        storage = FakeStorage()
        pipeline = make_pipeline(storage)
        rows = [
            {
                "id": 1,
                "source_kind": "jobtech",
                "source_url": "https://example.test/noise",
                "is_noise": True,
                "is_target_role": False,
                "role_family": "noise",
                "relevance_score": 0,
            },
            {
                "id": 2,
                "source_kind": "jobtech",
                "source_url": "https://example.test/backend",
                "is_noise": False,
                "is_target_role": True,
                "role_family": "backend",
                "relevance_score": 60,
            },
        ]
        pipeline._prepare_records = lambda records: (rows, {1: ["noise"], 2: ["backend"]}, 1)  # type: ignore[method-assign]

        processed = pipeline._persist_records(
            records=[{"id": "ignored"}],
            checkpoint_update={"last_stream_timestamp": "2026-06-16T00:00:00+00:00"},
            drop_irrelevant_jobtech=True,
        )

        self.assertEqual(processed, 1)
        self.assertEqual([job["id"] for job in storage.persisted_batches[0]["jobs"]], [2])
        self.assertEqual(storage.persisted_batches[0]["tags"], {2: ["backend"]})
        self.assertEqual(storage.state["last_stream_timestamp"], "2026-06-16T00:00:00+00:00")

    def test_company_ats_rows_are_not_filtered_by_jobtech_gate(self) -> None:
        storage = FakeStorage()
        pipeline = make_pipeline(storage)
        rows = [
            {
                "id": 10,
                "source_kind": "direct_company_ats",
                "source_url": "https://example.test/company",
                "is_noise": True,
                "is_target_role": False,
                "role_family": "noise",
                "relevance_score": 0,
            }
        ]
        pipeline._prepare_records = lambda records: (rows, {10: ["noise"]}, 0)  # type: ignore[method-assign]

        processed = pipeline._persist_records(
            records=[{"id": "ignored"}],
            checkpoint_update=None,
            drop_irrelevant_jobtech=True,
        )

        self.assertEqual(processed, 1)
        self.assertEqual(storage.persisted_batches[0]["jobs"][0]["id"], 10)

    def test_active_job_budget_is_fail_closed_only_when_limit_is_reached(self) -> None:
        storage = FakeStorage()
        pipeline = make_pipeline(storage)

        storage.active_jobs = 1
        self.assertFalse(pipeline.over_storage_budget())

        storage.active_jobs = 2
        self.assertTrue(pipeline.over_storage_budget())

    def test_jobtech_stream_poll_skips_when_active_job_budget_is_reached(self) -> None:
        storage = FakeStorage()
        storage.active_jobs = 2
        pipeline = make_pipeline(storage)

        processed = pipeline.run_stream_once(limit=10)

        self.assertEqual(processed, 0)
        self.assertIn("last_poll_at", storage.state)
        self.assertEqual(storage.persisted_batches, [])


if __name__ == "__main__":
    unittest.main()
