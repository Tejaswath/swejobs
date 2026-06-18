from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Callable
from http.server import BaseHTTPRequestHandler, HTTPServer

from .logging_utils import configure_logging
from .main import build_pipeline
from .settings import load_settings
from .v3_runtime import recalculate_user_ranking

logger = logging.getLogger(__name__)


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path not in {"/health", "/"}:
            self.send_response(404)
            self.end_headers()
            return

        payload = {
            "status": "ok",
            "service": "swejobs-pipeline-worker",
            "timestamp": time.time(),
        }
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def start_health_server(port: int) -> HTTPServer:
    server = HTTPServer(("0.0.0.0", port), _HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def maybe_recalculate_user_ranking(pipeline: Any, *, interval_hours: int = 24) -> bool:
    storage = getattr(pipeline, "storage", None)
    if storage is None:
        return False
    state_key = "last_user_ranking_recalculation_at"
    state = storage.get_ingestion_state([state_key])
    raw_last_run = state.get(state_key)
    if raw_last_run:
        try:
            last_run = datetime.fromisoformat(str(raw_last_run).replace("Z", "+00:00"))
            if last_run.tzinfo is None:
                last_run = last_run.replace(tzinfo=UTC)
            if datetime.now(UTC) - last_run.astimezone(UTC) < timedelta(hours=max(1, interval_hours)):
                return False
        except ValueError:
            pass

    report = recalculate_user_ranking(storage, lookback_days=90, apply=True)
    storage.upsert_ingestion_state({state_key: datetime.now(UTC).isoformat()})
    logger.info(
        "User ranking recalculation complete. rows_scanned=%s users=%s applied=%s",
        report.get("rows_scanned", 0),
        report.get("users_computed", 0),
        report.get("applied_count", 0),
    )
    return True


def _next_worker_cycle(pipeline: Any) -> int:
    storage = getattr(pipeline, "storage", None)
    if storage is None:
        return 1
    try:
        state = storage.get_ingestion_state(["worker:ats_cycle_count"])
        current = int(state.get("worker:ats_cycle_count") or 0)
    except Exception:
        current = 0
    next_cycle = current + 1
    try:
        storage.upsert_ingestion_state({"worker:ats_cycle_count": str(next_cycle)})
    except Exception:
        logger.warning("Failed to persist worker cycle counter", exc_info=True)
    return next_cycle


def run_ats_only_cycle(
    pipeline: Any,
    *,
    max_rows: int,
    max_http: int,
    jobtech_topup_enabled: bool = False,
    jobtech_topup_limit: int = 100,
    jobtech_topup_interval_cycles: int = 6,
    jobtech_topup_since_days: int = 21,
    jobtech_topup_max_age_days: int = 21,
) -> dict[str, Any]:
    report: dict[str, Any] = {}
    cycle_count = _next_worker_cycle(pipeline)
    report["cycle_count"] = cycle_count

    try:
        report["deadline_expiry"] = pipeline.maybe_expire_jobs_past_deadline()
    except Exception as exc:  # noqa: BLE001
        report["deadline_expiry_error"] = str(exc)
        logger.exception("ATS worker deadline_expiry unexpectedly failed: %s", exc)

    try:
        if bool(getattr(pipeline, "over_storage_budget", lambda: False)()):
            report["company_feeds_skipped"] = "active_job_budget"
            logger.warning("ATS sync skipped because active-job budget is already reached")
        else:
            feed_report = pipeline.run_company_feeds_once(max_rows=max_rows, max_http=max_http)
            report["company_feeds"] = feed_report
            feed_results = feed_report.get("feed_results") or []
            failure_statuses = {"error", "http_error", "persist_error"}
            failures = [row for row in feed_results if str(row.get("status") or "") in failure_statuses]
            auto_disabled = [
                row for row in feed_results if str(row.get("status") or "") == "skipped_auto_disabled"
            ]
            feed_report["actual_failure_count"] = len(failures)
            feed_report["auto_disabled_count"] = len(auto_disabled)
            storage = getattr(pipeline, "storage", None)
            if storage is not None:
                storage.upsert_ingestion_state(
                    {
                        "worker:last_success_at": datetime.now(UTC).isoformat(),
                        "worker:last_feed_failure_count": str(len(failures)),
                        "worker:last_feed_failures": ",".join(str(row.get("feed_key") or "") for row in failures[:20]),
                        "worker:last_feed_auto_disabled_count": str(len(auto_disabled)),
                    }
                )
            logger.info(
                "ATS sync complete. processed_rows=%s target_rows=%s http_requests=%s feeds_run=%s failures=%s auto_disabled=%s",
                feed_report.get("processed_rows", 0),
                feed_report.get("target_rows", 0),
                feed_report.get("http_requests", 0),
                feed_report.get("feeds_run", 0),
                len(failures),
                len(auto_disabled),
            )
    except Exception as exc:  # noqa: BLE001
        report["company_feeds_error"] = str(exc)
        logger.exception("ATS sync unexpectedly failed: %s", exc)

    if jobtech_topup_enabled:
        interval = max(1, int(jobtech_topup_interval_cycles))
        if cycle_count % interval != 0:
            report["jobtech_topup"] = {"status": "skipped_interval", "cycle_count": cycle_count, "interval": interval}
        elif bool(getattr(pipeline, "over_storage_budget", lambda: False)()):
            report["jobtech_topup"] = {"status": "skipped_active_job_budget"}
        else:
            try:
                report["jobtech_topup"] = pipeline.run_jobtech_topup(
                    limit=max(1, int(jobtech_topup_limit)),
                    apply=True,
                    since_days=max(1, int(jobtech_topup_since_days)),
                    max_age_days=max(1, int(jobtech_topup_max_age_days)),
                )
            except Exception as exc:  # noqa: BLE001
                report["jobtech_topup_error"] = str(exc)
                logger.exception("ATS worker jobtech_topup unexpectedly failed: %s", exc)
    else:
        report["jobtech_topup"] = {"status": "disabled"}

    for report_key, operation in (
        ("translation", pipeline.maybe_translate_jobs),
        ("compaction", pipeline.maybe_run_compaction),
        ("user_ranking", lambda: maybe_recalculate_user_ranking(pipeline)),
    ):
        try:
            report[report_key] = operation()
        except Exception as exc:  # noqa: BLE001
            report[f"{report_key}_error"] = str(exc)
            logger.exception("ATS worker %s unexpectedly failed: %s", report_key, exc)

    return report


def run_ats_only_forever(
    pipeline: Any,
    *,
    interval_seconds: int,
    max_rows: int,
    max_http: int,
    jobtech_topup_enabled: bool = False,
    jobtech_topup_limit: int = 100,
    jobtech_topup_interval_cycles: int = 6,
    jobtech_topup_since_days: int = 21,
    jobtech_topup_max_age_days: int = 21,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    while True:
        started_at = time.monotonic()
        run_ats_only_cycle(
            pipeline,
            max_rows=max_rows,
            max_http=max_http,
            jobtech_topup_enabled=jobtech_topup_enabled,
            jobtech_topup_limit=jobtech_topup_limit,
            jobtech_topup_interval_cycles=jobtech_topup_interval_cycles,
            jobtech_topup_since_days=jobtech_topup_since_days,
            jobtech_topup_max_age_days=jobtech_topup_max_age_days,
        )
        elapsed = time.monotonic() - started_at
        sleep(max(0, interval_seconds - elapsed))


def main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level)
    pipeline, _ = build_pipeline()

    try:
        # Respect App Service port env if set.
        port = int(os.getenv("WEBSITES_PORT", os.getenv("PORT", "8000")))
    except ValueError:
        port = 8000

    start_health_server(port)
    logger.info("Starting worker mode=%s", settings.worker_mode)
    if settings.worker_mode == "ats_only":
        if not settings.enable_company_feeds:
            raise RuntimeError("ATS-only worker requires ENABLE_COMPANY_FEEDS=true")
        run_ats_only_forever(
            pipeline,
            interval_seconds=settings.ats_sync_interval_seconds,
            max_rows=settings.ats_sync_row_budget,
            max_http=settings.ats_sync_http_budget,
            jobtech_topup_enabled=settings.jobtech_topup_enabled,
            jobtech_topup_limit=settings.jobtech_topup_limit,
            jobtech_topup_interval_cycles=settings.jobtech_topup_interval_cycles,
            jobtech_topup_since_days=settings.jobtech_topup_since_days,
            jobtech_topup_max_age_days=settings.jobtech_topup_max_age_days,
        )
        return

    pipeline.run_poll_forever()


if __name__ == "__main__":
    main()
