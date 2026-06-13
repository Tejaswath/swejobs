"""Cursor-paginated purge of inactive unreferenced jobs.

Run via: ``python -m pipeline.main purge-inactive-jobs [--confirm]``.
Dry-run is default.
"""
from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


def purge_inactive_jobs(
    storage: Any,
    *,
    confirm: bool = False,
    batch_size: int = 500,
    max_batches: int = 100,
    start_after_id: int = 0,
    stop_after_deleted: int | None = None,
    sleep_ms: int = 100,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "dry_run": not confirm,
        "batches_scanned": 0,
        "inactive_ids_seen": 0,
        "referenced_preserved": 0,
        "unreferenced_would_delete": 0,
        "deleted": 0,
        "last_id": start_after_id,
        "errors": [],
    }

    last_id = int(start_after_id)
    for batch_num in range(max(1, int(max_batches))):
        try:
            batch_ids = storage.fetch_inactive_job_ids_after(after_id=last_id, limit=int(batch_size))
        except Exception as exc:
            message = f"batch {batch_num}: fetch failed: {exc}"
            logger.error(message)
            report["errors"].append(message)
            break

        if not batch_ids:
            break

        report["batches_scanned"] += 1
        report["inactive_ids_seen"] += len(batch_ids)

        # Always advance cursor to avoid reprocessing the same rows.
        last_id = max(batch_ids)
        report["last_id"] = last_id

        try:
            referenced = storage.fetch_referenced_job_ids(batch_ids)
        except Exception as exc:
            message = f"batch {batch_num}: reference check failed: {exc}"
            logger.error(message)
            report["errors"].append(message)
            if sleep_ms > 0:
                time.sleep(sleep_ms / 1000.0)
            continue

        referenced_in_batch = referenced & set(batch_ids)
        unreferenced = [job_id for job_id in batch_ids if job_id not in referenced]
        report["referenced_preserved"] += len(referenced_in_batch)
        report["unreferenced_would_delete"] += len(unreferenced)

        if confirm and unreferenced:
            try:
                deleted = storage.delete_jobs_by_ids(unreferenced)
                report["deleted"] += deleted
                logger.info(
                    "purge batch %d: deleted %d / %d inactive unreferenced jobs (last_id=%d)",
                    batch_num,
                    deleted,
                    len(batch_ids),
                    last_id,
                )
            except Exception as exc:
                message = f"batch {batch_num}: delete failed for {len(unreferenced)} ids: {exc}"
                logger.error(message)
                report["errors"].append(message)
        elif not confirm:
            logger.info(
                "purge batch %d [DRY RUN]: would delete %d / %d inactive unreferenced jobs (last_id=%d)",
                batch_num,
                len(unreferenced),
                len(batch_ids),
                last_id,
            )

        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)

        if stop_after_deleted is not None and report["deleted"] >= int(stop_after_deleted):
            logger.info("stop_after_deleted=%d reached; stopping", int(stop_after_deleted))
            break

    return report

