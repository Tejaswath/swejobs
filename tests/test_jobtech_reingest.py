from __future__ import annotations

import unittest

from pipeline.ingest import IngestionPipeline
from pipeline.target_profile import TargetProfile


class _Storage:
    def __init__(self) -> None:
        self.persisted_jobs: list[dict] = []

    def fetch_active_jobtech_reingest_batch(self, *, after_id: int, limit: int) -> list[dict]:
        if after_id >= 123:
            return []
        return [
            {
                "id": 123,
                "source_url": "https://arbetsformedlingen.se/platsbanken/annonser/123",
                "raw_json": None,
            }
        ]

    def fetch_existing_jobs(self, job_ids: list[int]) -> dict[int, dict]:
        return {123: {"id": 123, "raw_json": None, "payload_hash": "old", "is_active": True}}

    def persist_batch(self, *, jobs: list[dict], tags_by_job_id: dict, events: list[dict]) -> None:
        self.persisted_jobs.extend(jobs)


class _Client:
    def get_job_by_id(self, job_id: str) -> dict:
        return {
            "id": int(job_id),
            "headline": "Junior Software Engineer",
            "description": "Develop software and backend services.",
            "occupation": {"label": "Software Engineer"},
            "webpage_url": f"https://arbetsformedlingen.se/platsbanken/annonser/{job_id}",
            "application_details": {"url": f"https://jobs.example.com/apply/{job_id}"},
        }


def _pipeline(storage: _Storage) -> IngestionPipeline:
    profile = TargetProfile(
        data={
            "role_families": {
                "include": ["software_engineering", "backend"],
                "soft_include": [],
                "exclude_domains": [],
                "software_evidence": {"title_terms": ["software"], "description_terms": []},
            },
            "regions": {"include_codes": [], "include_names": []},
            "language": {"preferred": ["en"]},
            "remote": {"preference": "remote_or_hybrid"},
            "skills": {"stretch": []},
            "scoring": {"minimum_target_score": 0, "noise_threshold": -20},
        },
        company_tier_map={},
        company_alias_map={},
    )
    return IngestionPipeline(
        client=_Client(),
        storage=storage,
        profile=profile,
        batch_size=50,
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
        compaction_inactive_job_days=7,
        compaction_job_event_days=14,
        compaction_weekly_digest_days=180,
        compaction_in_app_alert_unread_days=90,
        compaction_in_app_alert_read_days=30,
        enable_translation=False,
    )


class JobTechReingestTests(unittest.TestCase):
    def test_external_id_can_be_recovered_from_platsbanken_url(self) -> None:
        external_id = IngestionPipeline._jobtech_external_id_for_reingest(
            {
                "id": 123,
                "source_url": "https://arbetsformedlingen.se/platsbanken/annonser/123",
                "raw_json": None,
            }
        )
        self.assertEqual(external_id, "123")

    def test_dry_run_reports_url_change_without_persisting(self) -> None:
        storage = _Storage()
        report = _pipeline(storage).reingest_active_jobtech(limit=10, apply=False)
        self.assertEqual(report["changed_urls"], 1)
        self.assertEqual(report["persisted"], 0)
        self.assertEqual(storage.persisted_jobs, [])

    def test_apply_persists_refreshed_jobtech_row(self) -> None:
        storage = _Storage()
        report = _pipeline(storage).reingest_active_jobtech(limit=10, apply=True)
        self.assertEqual(report["persisted"], 1)
        self.assertEqual(storage.persisted_jobs[0]["source_url"], "https://jobs.example.com/apply/123")


if __name__ == "__main__":
    unittest.main()
