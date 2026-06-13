from __future__ import annotations

import os
import tempfile
import textwrap
import unittest
from unittest.mock import patch

from pipeline.ingest import IngestionPipeline
from pipeline.sources.base import CompanyFeed, FeedFetchResult
from pipeline.sources.teamtailor import _fetch_teamtailor_custom_site_jobs


class FakeStorage:
    def __init__(self) -> None:
        self.state: dict[str, str] = {}
        self.active_rows: list[dict] = []
        self.deactivated_calls: list[tuple[list[int], str]] = []
        self.inserted_events: list[dict] = []
        self.persisted_batches: list[dict] = []

    def get_ingestion_state(self, keys: list[str] | None = None) -> dict[str, str]:
        if not keys:
            return dict(self.state)
        return {key: self.state[key] for key in keys if key in self.state}

    def fetch_existing_jobs(self, job_ids: list[int]) -> dict[int, dict]:
        return {}

    def persist_batch(self, *, jobs: list[dict], tags_by_job_id: dict[int, list[str]], events: list[dict]) -> None:
        self.persisted_batches.append({"jobs": jobs, "tags": tags_by_job_id, "events": events})

    def upsert_ingestion_state(self, values: dict[str, str]) -> None:
        self.state.update(values)

    def fetch_active_jobs_for_company_source(self, *, source_provider: str, source_company_key: str) -> list[dict]:
        return list(self.active_rows)

    def deactivate_jobs(self, job_ids: list[int], *, removed_at: str) -> int:
        self.deactivated_calls.append((list(job_ids), removed_at))
        return len(job_ids)

    def insert_job_events(self, events: list[dict]) -> None:
        self.inserted_events.extend(events)

    def insert_source_feed_probe_runs(self, rows: list[dict]) -> int:
        return len(rows)


class StaticFeedPipeline(IngestionPipeline):
    def __init__(
        self,
        *,
        storage: FakeStorage,
        config_path: str,
        fetch_result: FeedFetchResult,
        prepared_jobs: list[dict] | None = None,
        prepared_tags: dict[int, list[str]] | None = None,
        prepared_target_count: int = 0,
    ) -> None:
        super().__init__(
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
            company_feed_config_path=config_path,
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
            libretranslate_url="",
            translation_interval_polls=10,
            translation_batch_size=20,
            translation_max_chars=4000,
            translation_timeout_seconds=20,
        )
        self._static_fetch_result = fetch_result
        self._static_prepared_jobs = prepared_jobs
        self._static_prepared_tags = prepared_tags or {}
        self._static_prepared_target_count = prepared_target_count

    def _fetch_company_feed(self, feed: CompanyFeed, *, max_rows: int, max_http: int):
        return self._static_fetch_result

    def _prepare_records(self, records: list[dict]):
        if self._static_prepared_jobs is not None:
            tags = self._static_prepared_tags
            return self._static_prepared_jobs, tags, self._static_prepared_target_count
        return super()._prepare_records(records)


class CompanyFeedReconciliationTests(unittest.TestCase):
    def _write_config(self) -> str:
        payload = textwrap.dedent(
            """
            updated_at: "2026-03-17"
            feeds:
              - feed_key: spotify_lever
                display_name: Spotify
                provider: lever
                slug_or_url: spotify
                company_canonical: spotify
                enabled: true
                priority: 10
                location_filters:
                  - Stockholm
                keywords_any:
                  - engineer
            """
        )
        handle = tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False)
        handle.write(payload)
        handle.flush()
        handle.close()
        self.addCleanup(lambda: os.unlink(handle.name))
        return handle.name

    def test_successful_empty_feed_deactivates_missing_jobs_and_resets_miss_counter(self) -> None:
        storage = FakeStorage()
        storage.state = {
            "feed:spotify_lever:consecutive_miss_count": "9",
            "feed:spotify_lever:auto_disabled": "false",
        }
        storage.active_rows = [
            {"id": 101, "source_url": "https://jobs.example/a", "raw_json": {"headline": "A"}},
            {"id": 202, "source_url": "https://jobs.example/b", "raw_json": {"headline": "B"}},
        ]
        pipeline = StaticFeedPipeline(
            storage=storage,
            config_path=self._write_config(),
            fetch_result=FeedFetchResult(
                rows=[],
                http_requests=1,
                http_status=200,
                matching_rows_before_limit=0,
            ),
        )

        result = pipeline.run_company_feeds_once(max_rows=40, max_http=3)

        self.assertEqual(result["processed_rows"], 0)
        self.assertEqual(result["feed_results"][0]["removed_rows"], 2)
        self.assertEqual(result["feed_results"][0]["reconciliation_status"], "ok")
        self.assertEqual(len(storage.deactivated_calls), 1)
        self.assertEqual(storage.deactivated_calls[0][0], [101, 202])
        self.assertEqual([event["event_type"] for event in storage.inserted_events], ["removed", "removed"])
        self.assertEqual(storage.state["feed:spotify_lever:consecutive_miss_count"], "0")
        self.assertEqual(storage.state["feed:spotify_lever:auto_disabled"], "false")
        self.assertIn("feed:spotify_lever:last_success_at", storage.state)

    def test_successful_feed_only_deactivates_jobs_missing_from_current_source_urls(self) -> None:
        storage = FakeStorage()
        storage.active_rows = [
            {"id": 101, "source_url": "https://jobs.example/keep", "raw_json": {"headline": "Keep"}},
            {"id": 202, "source_url": "https://jobs.example/drop", "raw_json": {"headline": "Drop"}},
        ]
        prepared_jobs = [
            {
                "id": 501,
                "source_url": "https://jobs.example/keep",
                "raw_json": {"headline": "Keep"},
                "is_target_role": True,
            }
        ]
        pipeline = StaticFeedPipeline(
            storage=storage,
            config_path=self._write_config(),
            fetch_result=FeedFetchResult(
                rows=[{"id": "lever:spotify_lever:1"}],
                http_requests=1,
                http_status=200,
                matching_rows_before_limit=1,
            ),
            prepared_jobs=prepared_jobs,
            prepared_tags={501: ["backend"]},
            prepared_target_count=1,
        )

        result = pipeline.run_company_feeds_once(max_rows=40, max_http=3)

        self.assertEqual(result["processed_rows"], 1)
        self.assertEqual(result["target_rows"], 1)
        self.assertEqual(result["feed_results"][0]["removed_rows"], 1)
        self.assertEqual(storage.deactivated_calls[0][0], [202])
        self.assertEqual(len(storage.persisted_batches), 1)

    def test_prepare_records_deduplicates_normalized_job_ids(self) -> None:
        storage = FakeStorage()
        storage.fetch_jobs_by_source_urls = lambda source_urls: {}
        pipeline = StaticFeedPipeline(
            storage=storage,
            config_path=self._write_config(),
            fetch_result=FeedFetchResult(rows=[], http_requests=1, http_status=200),
        )
        pipeline._classify_and_prepare = lambda raw: (
            {
                "id": 123,
                "headline": raw["headline"],
                "employer_name": "example",
                "municipality": "Stockholm",
                "region": "Stockholm",
                "source_url": raw["source_url"],
                "is_target_role": True,
            },
            ["backend"],
        )

        jobs, tags, target_count = pipeline._prepare_records(
            [
                {
                    "id": "same-provider-id",
                    "headline": "Backend Engineer",
                    "description": "Python backend engineer",
                    "source_url": "https://jobs.example/first",
                },
                {
                    "id": "same-provider-id",
                    "headline": "Platform Engineer",
                    "description": "Cloud platform engineer",
                    "source_url": "https://jobs.example/second",
                },
            ]
        )

        self.assertEqual(len(jobs), 1)
        self.assertEqual(len(tags), 1)
        self.assertEqual(target_count, int(bool(jobs[0]["is_target_role"])))

    def test_company_feed_cycle_uses_dedicated_budget_and_advances_cursor(self) -> None:
        storage = FakeStorage()
        storage.state["last_company_feed_cursor"] = "spotify_lever"
        pipeline = StaticFeedPipeline(
            storage=storage,
            config_path=self._write_config(),
            fetch_result=FeedFetchResult(rows=[], http_requests=1, http_status=200),
        )
        captured: dict[str, object] = {}

        def run_once(**kwargs):
            captured.update(kwargs)
            return {
                "processed_rows": 3,
                "target_rows": 2,
                "http_requests": 1,
                "feed_results": [{"feed_key": "kambi_greenhouse", "status": "ok"}],
            }

        pipeline.run_company_feeds_once = run_once

        report = pipeline.run_company_feed_cycle()

        self.assertEqual(captured["max_rows"], 40)
        self.assertEqual(captured["max_http"], 3)
        self.assertEqual(captured["start_after_key"], "spotify_lever")
        self.assertEqual(storage.state["last_company_feed_cursor"], "kambi_greenhouse")
        self.assertEqual(report["last_company_feed_cursor"], "kambi_greenhouse")

    def test_teamtailor_custom_site_ids_are_stable_by_source_url(self) -> None:
        feed = CompanyFeed(
            feed_key="example_teamtailor",
            provider="teamtailor",
            slug_or_url="https://careers.example.com/",
            company_canonical="example",
            display_name="Example",
            enabled=True,
            priority=1,
            location_filters=("Stockholm",),
            keywords_any=("engineer",),
        )
        html = """
        <li><div><a href="/jobs/1-backend">Backend Engineer</a>
        <div class="text-md"><span>Engineering</span><span>Stockholm</span></div></div></li>
        <li><div><a href="/jobs/2-platform">Platform Engineer</a>
        <div class="text-md"><span>Engineering</span><span>Stockholm</span></div></div></li>
        """

        with patch(
            "pipeline.sources.teamtailor._request_teamtailor_html",
            return_value=(html, 200, "https://careers.example.com/jobs"),
        ):
            result = _fetch_teamtailor_custom_site_jobs(
                feed,
                timeout_seconds=30,
                max_rows=40,
                max_http=1,
            )

        self.assertEqual(len(result.rows), 2)
        self.assertEqual(len({row["id"] for row in result.rows}), 2)
        self.assertTrue(all(row["source_url"] in row["id"] for row in result.rows))


if __name__ == "__main__":
    unittest.main()
