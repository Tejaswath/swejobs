from __future__ import annotations

import unittest

from pipeline.purge_inactive_jobs import purge_inactive_jobs


class PurgeStorageFake:
    def __init__(self, inactive_ids: list[int], referenced_ids: set[int]) -> None:
        self.inactive_ids = sorted(inactive_ids)
        self.referenced_ids = set(referenced_ids)
        self.deleted_calls: list[list[int]] = []

    def fetch_inactive_job_ids_after(self, *, after_id: int = 0, limit: int = 500) -> list[int]:
        rows = [job_id for job_id in self.inactive_ids if job_id > after_id]
        return rows[:limit]

    def fetch_referenced_job_ids(self, job_ids: list[int]) -> set[int]:
        return {job_id for job_id in job_ids if job_id in self.referenced_ids}

    def delete_jobs_by_ids(self, job_ids: list[int]) -> int:
        self.deleted_calls.append(list(job_ids))
        return len(job_ids)


class PurgeInactiveJobsTests(unittest.TestCase):
    def test_dry_run_does_not_delete(self) -> None:
        storage = PurgeStorageFake(inactive_ids=[1, 2, 3, 4, 5], referenced_ids={2, 5})
        report = purge_inactive_jobs(
            storage,
            confirm=False,
            batch_size=2,
            max_batches=10,
            start_after_id=0,
            sleep_ms=0,
        )

        self.assertTrue(report["dry_run"])
        self.assertEqual(report["inactive_ids_seen"], 5)
        self.assertEqual(report["referenced_preserved"], 2)
        self.assertEqual(report["unreferenced_would_delete"], 3)
        self.assertEqual(report["deleted"], 0)
        self.assertEqual(storage.deleted_calls, [])
        self.assertEqual(report["last_id"], 5)
        self.assertEqual(report["errors"], [])

    def test_confirm_deletes_only_unreferenced(self) -> None:
        storage = PurgeStorageFake(inactive_ids=[10, 11, 12, 13], referenced_ids={10, 13})
        report = purge_inactive_jobs(
            storage,
            confirm=True,
            batch_size=4,
            max_batches=2,
            start_after_id=0,
            sleep_ms=0,
        )

        self.assertFalse(report["dry_run"])
        self.assertEqual(report["referenced_preserved"], 2)
        self.assertEqual(report["deleted"], 2)
        self.assertEqual(storage.deleted_calls, [[11, 12]])
        self.assertEqual(report["errors"], [])

    def test_cursor_advances_past_referenced_rows(self) -> None:
        storage = PurgeStorageFake(inactive_ids=[100, 101, 102], referenced_ids={100, 101, 102})
        report = purge_inactive_jobs(
            storage,
            confirm=True,
            batch_size=2,
            max_batches=10,
            start_after_id=0,
            sleep_ms=0,
        )

        self.assertEqual(report["batches_scanned"], 2)
        self.assertEqual(report["inactive_ids_seen"], 3)
        self.assertEqual(report["deleted"], 0)
        self.assertEqual(report["last_id"], 102)
        self.assertEqual(storage.deleted_calls, [])


if __name__ == "__main__":
    unittest.main()

