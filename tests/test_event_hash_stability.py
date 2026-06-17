from __future__ import annotations

import unittest

from pipeline.ingest import IngestionPipeline


class ReclassifyStorageFake:
    def __init__(self) -> None:
        self.persisted_jobs: list[dict] = []
        self.persisted_tags: dict[int, list[str]] = {}

    def fetch_existing_jobs(self, job_ids: list[int]) -> dict[int, dict]:
        return {job_id: {"id": job_id, "is_active": True, "payload_hash": "old"} for job_id in job_ids}

    def persist_batch(self, *, jobs: list[dict], tags_by_job_id: dict[int, list[str]], events: list[dict]) -> None:
        self.persisted_jobs.extend(jobs)
        self.persisted_tags.update(tags_by_job_id)


class EventHashStabilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pipeline = object.__new__(IngestionPipeline)

    def test_compacted_job_with_matching_persisted_hash_does_not_emit_update(self) -> None:
        jobs = [{"id": 1, "is_active": True, "raw_json": {"id": 1}, "payload_hash": "stable"}]
        existing = {1: {"id": 1, "is_active": True, "raw_json": None, "payload_hash": "stable"}}

        self.assertEqual(self.pipeline._build_events(jobs=jobs, existing=existing), [])

    def test_compacted_job_with_changed_persisted_hash_emits_update(self) -> None:
        jobs = [{"id": 1, "is_active": True, "raw_json": {"id": 1}, "payload_hash": "changed"}]
        existing = {1: {"id": 1, "is_active": True, "raw_json": None, "payload_hash": "stable"}}

        events = self.pipeline._build_events(jobs=jobs, existing=existing)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event_type"], "updated")
        self.assertEqual(events[0]["payload_hash"], "changed")

    def test_reclassification_persists_semantic_duplicates_without_ingest_dedupe(self) -> None:
        storage = ReclassifyStorageFake()
        self.pipeline.storage = storage
        self.pipeline._classify_and_prepare = lambda raw: (
            {
                "id": raw["id"],
                "headline": "Saab söker erfarna systemingenjörer!",
                "employer_name": "SAAB AKTIEBOLAG",
                "municipality": "Linköping",
                "region": "Östergötland",
                "source_url": raw["source_url"],
                "is_active": True,
                "payload_hash": f"new-{raw['id']}",
                "career_stage": "senior",
                "reason_codes": ["career_stage_senior"],
            },
            ["software_engineering"],
        )

        count = self.pipeline._persist_reclassification_records(
            [
                {"id": 31131171, "source_url": "https://example.com/older"},
                {"id": 31148323, "source_url": "https://example.com/newer"},
            ]
        )

        self.assertEqual(count, 2)
        self.assertEqual([job["id"] for job in storage.persisted_jobs], [31131171, 31148323])
        self.assertEqual(set(storage.persisted_tags), {31131171, 31148323})


if __name__ == "__main__":
    unittest.main()
