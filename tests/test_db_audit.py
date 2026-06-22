from __future__ import annotations

import unittest
from types import SimpleNamespace

from pipeline.db_audit import EMAIL_LOGS_AUDIT_FLAG_DAYS, run_db_audit


class _QueryStub:
    def __init__(self, count: int = 0) -> None:
        self._count = count

    def select(self, *_args, **_kwargs) -> "_QueryStub":
        return self

    def limit(self, *_args, **_kwargs) -> "_QueryStub":
        return self

    def eq(self, *_args, **_kwargs) -> "_QueryStub":
        return self

    def lt(self, *_args, **_kwargs) -> "_QueryStub":
        return self

    def execute(self):
        return SimpleNamespace(count=self._count)


class _ClientStub:
    def table(self, _name: str) -> _QueryStub:
        return _QueryStub(count=0)


class _StorageStub:
    def __init__(self) -> None:
        self.client = _ClientStub()

    def get_ingestion_state(self, keys: list[str] | None = None) -> dict[str, str]:
        return {}


class DbAuditTests(unittest.TestCase):
    def test_run_db_audit_reads_compaction_settings_without_silent_defaults(self) -> None:
        settings = SimpleNamespace(
            compaction_raw_json_days=2,
            compaction_inactive_job_days=7,
            compaction_job_event_days=14,
            compaction_weekly_digest_days=180,
        )

        report = run_db_audit(_StorageStub(), settings)

        retention = report["retention_settings"]
        self.assertEqual(retention["raw_json_days"], 2)
        self.assertEqual(retention["inactive_jobs_days"], 7)
        self.assertEqual(retention["job_events_days"], 14)
        self.assertEqual(retention["weekly_digests_days"], 180)
        self.assertEqual(retention["email_logs_days"], EMAIL_LOGS_AUDIT_FLAG_DAYS)

    def test_run_db_audit_fails_loudly_when_compaction_setting_missing(self) -> None:
        settings = SimpleNamespace(
            compaction_raw_json_days=2,
            compaction_inactive_job_days=7,
            compaction_job_event_days=14,
        )

        with self.assertRaises(AttributeError):
            run_db_audit(_StorageStub(), settings)


if __name__ == "__main__":
    unittest.main()
