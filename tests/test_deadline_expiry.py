from __future__ import annotations

import unittest
from datetime import date

from pipeline.ingest import IngestionPipeline
from pipeline.normalize import normalize_job


class DeadlineStorageFake:
    def __init__(self) -> None:
        self.state: dict[str, str] = {}
        self.expired_rows: list[dict] = []
        self.deactivated_calls: list[tuple[list[int], str]] = []
        self.inserted_events: list[dict] = []

    def get_ingestion_state(self, keys: list[str] | None = None) -> dict[str, str]:
        if not keys:
            return dict(self.state)
        return {key: self.state[key] for key in keys if key in self.state}

    def upsert_ingestion_state(self, values: dict[str, str]) -> None:
        self.state.update(values)

    def fetch_active_jobs_past_deadline(self, *, deadline_before: str, limit: int = 500) -> list[dict]:
        rows = self.expired_rows[:limit]
        self.expired_rows = self.expired_rows[limit:]
        return rows

    def deactivate_jobs(self, job_ids: list[int], *, removed_at: str) -> int:
        self.deactivated_calls.append((list(job_ids), removed_at))
        return len(job_ids)

    def insert_job_events(self, events: list[dict]) -> None:
        self.inserted_events.extend(events)


class DeadlineExpiryTests(unittest.TestCase):
    def _build_pipeline(self, storage: DeadlineStorageFake) -> IngestionPipeline:
        return IngestionPipeline(
            client=object(),
            storage=storage,
            profile=object(),
            batch_size=200,
            poll_seconds=60,
            digest_window_days=30,
            digest_refresh_minutes=60,
            timezone="Europe/Stockholm",
            request_timeout_seconds=30,
            enable_company_feeds=True,
            company_feed_config_path="pipeline/config/company_feeds.yaml",
            feed_interval_polls=5,
            feed_http_budget=3,
            feed_row_budget=40,
            feed_consecutive_miss_threshold=10,
            stream_reset_stale_cursor_hours=24,
            compaction_interval_hours=24,
            compaction_raw_json_days=7,
            compaction_inactive_job_days=60,
            compaction_job_event_days=30,
            compaction_weekly_digest_days=180,
            enable_translation=False,
            libretranslate_url="http://localhost:5000/translate",
            translation_interval_polls=10,
            translation_batch_size=20,
            translation_max_chars=4000,
            translation_timeout_seconds=20,
        )

    def test_normalize_job_canonicalizes_deadline_to_iso_date(self) -> None:
        job, _tags = normalize_job(
            {
                "id": "job-1",
                "headline": "Frontend Engineer",
                "application_deadline": "2026-03-15T23:59:00+01:00",
            }
        )

        self.assertEqual(job["application_deadline"], "2026-03-15")
        self.assertEqual(job["application_deadline_date"], "2026-03-15")

    def test_maybe_expire_jobs_past_deadline_deactivates_overdue_rows_and_is_safe_to_rerun(self) -> None:
        storage = DeadlineStorageFake()
        storage.expired_rows = [
            {"id": 101, "raw_json": {"headline": "Expired A"}, "application_deadline_date": "2026-03-15"},
            {"id": 202, "raw_json": {"headline": "Expired B"}, "application_deadline_date": "2026-03-16"},
        ]
        pipeline = self._build_pipeline(storage)

        first_report = pipeline.maybe_expire_jobs_past_deadline(today_local=date(2026, 3, 17), batch_size=500)
        second_report = pipeline.maybe_expire_jobs_past_deadline(today_local=date(2026, 3, 17), batch_size=500)

        self.assertEqual(first_report["status"], "ok")
        self.assertEqual(first_report["expired_rows"], 2)
        self.assertEqual(second_report["status"], "ok")
        self.assertEqual(second_report["expired_rows"], 0)
        self.assertEqual(len(storage.deactivated_calls), 1)
        self.assertEqual(storage.deactivated_calls[0][0], [101, 202])
        self.assertEqual([event["event_type"] for event in storage.inserted_events], ["removed", "removed"])
        self.assertEqual(storage.state["last_deadline_expiration_date"], "2026-03-17")


if __name__ == "__main__":
    unittest.main()
