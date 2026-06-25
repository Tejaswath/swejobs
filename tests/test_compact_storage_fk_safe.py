from __future__ import annotations

import unittest

from pipeline.ingest import IngestionPipeline


class CompactStorageFake:
    def __init__(self) -> None:
        self.state: dict[str, str] = {}
        self.raw_json_ids: list[int] = []
        self.event_ids: list[int] = []
        self.digest_ids: list[int] = []
        self.no_deadline_rows: list[dict] = []
        self.inactive_ids: list[int] = [10, 11, 12, 13]
        self.referenced_ids: set[int] = {11, 13}
        self.deleted_job_calls: list[list[int]] = []
        self.deactivated_calls: list[list[int]] = []
        self.inserted_events: list[dict] = []

    def count_jobs_with_raw_json_before(self, cutoff_iso: str) -> int:
        return len(self.raw_json_ids)

    def count_inactive_jobs_before(self, cutoff_iso: str) -> int:
        return len(self.inactive_ids)

    def count_job_events_before(self, cutoff_iso: str) -> int:
        return len(self.event_ids)

    def count_weekly_digests_before(self, cutoff_iso: str) -> int:
        return len(self.digest_ids)

    def fetch_job_ids_with_raw_json_before(self, *, cutoff_iso: str, limit: int = 500) -> list[int]:
        return []

    def clear_raw_json_for_job_ids(self, job_ids: list[int]) -> int:
        return len(job_ids)

    def fetch_job_event_ids_before(self, *, cutoff_iso: str, limit: int = 500) -> list[int]:
        return []

    def delete_job_events_by_ids(self, event_ids: list[int]) -> int:
        return len(event_ids)

    def fetch_weekly_digest_ids_before(self, *, cutoff_iso: str, limit: int = 500) -> list[int]:
        return []

    def delete_weekly_digests_by_ids(self, digest_ids: list[int]) -> int:
        return len(digest_ids)

    def fetch_active_jobtech_no_deadline_before(self, *, published_before: str, limit: int = 500) -> list[dict]:
        rows = self.no_deadline_rows[:limit]
        self.no_deadline_rows = self.no_deadline_rows[limit:]
        return rows

    def deactivate_jobs(self, job_ids: list[int], *, removed_at: str) -> int:
        self.deactivated_calls.append(list(job_ids))
        return len(job_ids)

    def insert_job_events(self, events: list[dict]) -> None:
        self.inserted_events.extend(events)

    def fetch_inactive_job_ids_before_with_cursor(
        self,
        *,
        cutoff_iso: str,
        after_id: int = 0,
        limit: int = 500,
    ) -> list[int]:
        rows = [job_id for job_id in self.inactive_ids if job_id > after_id]
        return rows[:limit]

    def fetch_referenced_job_ids(self, job_ids: list[int]) -> set[int]:
        return {job_id for job_id in job_ids if job_id in self.referenced_ids}

    def delete_jobs_by_ids(self, job_ids: list[int]) -> int:
        self.deleted_job_calls.append(list(job_ids))
        return len(job_ids)

    def count_in_app_alerts_before_retention(self, *, unread_created_before: str, read_read_before: str) -> int:
        return 0

    def fetch_in_app_alert_ids_before_retention_with_cursor(
        self,
        *,
        unread_created_before: str,
        read_read_before: str,
        after_id: int = 0,
        limit: int = 500,
    ) -> list[int]:
        return []

    def delete_in_app_alerts_by_ids(self, alert_ids: list[int]) -> int:
        return len(alert_ids)

    def upsert_ingestion_state(self, values: dict[str, str]) -> None:
        self.state.update(values)


class CompactStorageSafetyTests(unittest.TestCase):
    def _build_pipeline(self, storage: CompactStorageFake) -> IngestionPipeline:
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
            compaction_inactive_job_days=7,
            compaction_job_event_days=14,
            compaction_weekly_digest_days=180,
            compaction_in_app_alert_unread_days=90,
            compaction_in_app_alert_read_days=30,
            enable_translation=False,
            max_active_jobs=15000,
            jobtech_topup_no_deadline_ttl_days=30,
            libretranslate_url="http://localhost:5000/translate",
            translation_interval_polls=10,
            translation_batch_size=20,
            translation_max_chars=4000,
            translation_timeout_seconds=20,
        )

    def test_compact_storage_skips_fk_referenced_inactive_jobs(self) -> None:
        storage = CompactStorageFake()
        pipeline = self._build_pipeline(storage)

        report = pipeline.compact_storage(confirm=True, batch_size=2)

        self.assertEqual(report["status"], "applied")
        self.assertEqual(report["summary"]["inactive_jobs_deleted"], 2)
        self.assertEqual(report["summary"]["inactive_jobs_referenced_preserved"], 2)
        self.assertEqual(storage.deleted_job_calls, [[10], [12]])
        self.assertIn("last_compaction_at", storage.state)

    def test_compact_storage_bounds_each_phase(self) -> None:
        storage = CompactStorageFake()
        storage.raw_json_ids = [1, 2, 3, 4, 5]

        def fetch_raw_json_ids(*, cutoff_iso: str, limit: int = 500) -> list[int]:
            return storage.raw_json_ids[:limit]

        def clear_raw_json(job_ids: list[int]) -> int:
            storage.raw_json_ids = [job_id for job_id in storage.raw_json_ids if job_id not in job_ids]
            return len(job_ids)

        storage.fetch_job_ids_with_raw_json_before = fetch_raw_json_ids
        storage.clear_raw_json_for_job_ids = clear_raw_json
        pipeline = self._build_pipeline(storage)

        report = pipeline.compact_storage(confirm=True, batch_size=2, max_batches_per_phase=2)

        self.assertEqual(report["status"], "applied_partial")
        self.assertEqual(report["summary"]["raw_json_cleared"], 4)
        self.assertEqual(report["batches"]["raw_json"], 2)
        self.assertIn("raw_json", report["phases_at_limit"])
        self.assertEqual(storage.raw_json_ids, [5])

    def test_no_deadline_jobtech_is_deactivated_not_deleted_same_cycle(self) -> None:
        storage = CompactStorageFake()
        storage.no_deadline_rows = [{"id": 90, "raw_json": {"headline": "Old no-deadline JobTech"}}]
        storage.inactive_ids = []
        pipeline = self._build_pipeline(storage)

        report = pipeline.compact_storage(confirm=True, batch_size=10)

        self.assertEqual(report["summary"]["jobtech_no_deadline_deactivated"], 1)
        self.assertEqual(storage.deactivated_calls, [[90]])
        self.assertEqual(storage.deleted_job_calls, [])
        self.assertEqual([event["event_type"] for event in storage.inserted_events], ["removed"])

    def test_compaction_defaults_keep_recovery_and_event_windows(self) -> None:
        storage = CompactStorageFake()
        pipeline = self._build_pipeline(storage)

        self.assertEqual(pipeline.compaction_inactive_job_days, 7)
        self.assertEqual(pipeline.compaction_job_event_days, 14)


if __name__ == "__main__":
    unittest.main()
