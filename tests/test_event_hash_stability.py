from __future__ import annotations

import unittest

from pipeline.ingest import IngestionPipeline


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


if __name__ == "__main__":
    unittest.main()
