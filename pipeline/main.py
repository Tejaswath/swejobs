from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from .company_registry import DEFAULT_COMPANY_REGISTRY_PATH
from .db_audit import run_db_audit
from .ingest import IngestionPipeline
from .jobtech import JobTechClient
from .logging_utils import configure_logging
from .purge_inactive_jobs import purge_inactive_jobs
from .settings import load_settings
from .storage import SupabaseStorage
from .target_profile import load_target_profile
from .v3_runtime import (
    evaluate_precision_export,
    evaluate_precision_ingest_labels,
    evaluate_precision_report,
    promote_company_feeds,
    recalculate_user_ranking,
    refresh_feed_quality,
    send_alerts,
    sync_feed_registry_from_yaml,
    verify_company_sources_batch,
    write_report_files,
)
from .validation import launch_readiness_report, precision_review_phase15, usefulness_report


def build_pipeline() -> tuple[IngestionPipeline, SupabaseStorage]:
    settings = load_settings()
    configure_logging(settings.log_level)

    profile = load_target_profile(settings.target_profile_path)
    storage = SupabaseStorage(
        url=settings.supabase_url,
        service_role_key=settings.supabase_service_role_key,
        batch_size=settings.batch_size,
    )
    client = JobTechClient(
        snapshot_url=settings.jobtech_snapshot_url,
        stream_url=settings.jobtech_stream_url,
        taxonomy_url=settings.jobtech_taxonomy_url,
        api_key=settings.jobtech_api_key,
        timeout_seconds=settings.request_timeout_seconds,
    )
    pipeline = IngestionPipeline(
        client=client,
        storage=storage,
        profile=profile,
        batch_size=settings.batch_size,
        poll_seconds=settings.poll_seconds,
        digest_window_days=settings.digest_window_days,
        digest_refresh_minutes=settings.digest_refresh_minutes,
        timezone=settings.timezone,
        request_timeout_seconds=settings.request_timeout_seconds,
        enable_company_feeds=settings.enable_company_feeds,
        company_feed_config_path=settings.company_feed_config_path,
        feed_interval_polls=settings.feed_interval_polls,
        feed_http_budget=settings.feed_http_budget,
        feed_row_budget=settings.feed_row_budget,
        feed_consecutive_miss_threshold=settings.feed_consecutive_miss_threshold,
        stream_reset_stale_cursor_hours=settings.stream_reset_stale_cursor_hours,
        compaction_interval_hours=settings.compaction_interval_hours,
        compaction_raw_json_days=settings.compaction_raw_json_days,
        compaction_inactive_job_days=settings.compaction_inactive_job_days,
        compaction_job_event_days=settings.compaction_job_event_days,
        compaction_weekly_digest_days=settings.compaction_weekly_digest_days,
        enable_translation=settings.enable_translation,
        translation_provider=settings.translation_provider,
        translation_api_key=settings.translation_api_key,
        translation_api_url=settings.translation_api_url,
        translation_interval_polls=settings.translation_interval_polls,
        translation_batch_size=settings.translation_batch_size,
        translation_max_chars=settings.translation_max_chars,
        translation_timeout_seconds=settings.translation_timeout_seconds,
    )
    return pipeline, storage


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SweJobs ingestion pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    snapshot = sub.add_parser("snapshot", help="Run full snapshot ingestion")
    snapshot.add_argument("--limit", type=int, default=None)

    reclassify = sub.add_parser("reclassify", help="Reclassify existing jobs from stored raw_json")
    reclassify.add_argument("--limit", type=int, default=None)
    reclassify.add_argument("--include-inactive", action="store_true")

    stream_once = sub.add_parser("poll-once", help="Run one stream polling pass")
    stream_once.add_argument("--limit", type=int, default=None)

    sub.add_parser("poll", help="Run continuous stream polling")

    smoke = sub.add_parser("smoke", help="Run one-row live smoke ingestion")
    smoke.add_argument("--limit", type=int, default=1)

    taxonomy = sub.add_parser("sync-taxonomy", help="Sync taxonomy cache")
    taxonomy.add_argument("--limit", type=int, default=None)

    company_feeds = sub.add_parser("sync-company-feeds", help="Run one pass of static ATS company feeds")
    company_feeds.add_argument("--max-rows", type=int, default=None)
    company_feeds.add_argument("--max-http", type=int, default=None)
    company_feeds.add_argument("--only", type=str, default=None, help="Comma-separated feed keys")
    company_feeds.add_argument("--clear-auto-disable", action="store_true")

    verify_sources = sub.add_parser("verify-company-sources", help="Probe provider order for target companies")
    verify_sources.add_argument("--companies", required=True, help="Comma-separated company canonical names")
    verify_sources.add_argument("--max-rows", type=int, default=20)
    verify_sources.add_argument("--max-http-per-provider", type=int, default=1)
    verify_sources.add_argument("--registry-path", default=DEFAULT_COMPANY_REGISTRY_PATH)
    verify_sources.add_argument(
        "--report-json",
        default="pipeline/reports/company_source_verification.json",
    )
    verify_sources.add_argument(
        "--report-md",
        default="docs/company_source_verification.md",
    )

    verify_sources_batch = sub.add_parser(
        "verify-company-sources-batch",
        help="Batch probe providers for companies in registry by status filter",
    )
    verify_sources_batch.add_argument(
        "--statuses",
        default="planned,blocked,html_fallback_candidate",
        help="Comma-separated company statuses to verify",
    )
    verify_sources_batch.add_argument("--max-companies", type=int, default=25)
    verify_sources_batch.add_argument("--max-rows", type=int, default=20)
    verify_sources_batch.add_argument("--max-http-per-provider", type=int, default=1)
    verify_sources_batch.add_argument("--registry-path", default=DEFAULT_COMPANY_REGISTRY_PATH)
    verify_sources_batch.add_argument("--report-json", default="pipeline/reports/company_source_verification_batch.json")
    verify_sources_batch.add_argument("--report-md", default="docs/company_source_verification_batch.md")

    sync_feed_registry = sub.add_parser(
        "sync-feed-registry-from-yaml",
        help="Seed/update DB feed registry from immutable YAML config",
    )
    sync_feed_registry.add_argument(
        "--config-path",
        default="pipeline/config/company_feeds.yaml",
    )
    sync_feed_registry.add_argument("--only", type=str, default=None, help="Comma-separated feed keys")

    refresh_quality = sub.add_parser(
        "refresh-feed-quality",
        help="Compute 14-day feed quality metrics from probe history and update registry bands",
    )
    refresh_quality.add_argument("--lookback-days", type=int, default=14)
    refresh_quality.add_argument("--min-runs", type=int, default=None)
    refresh_quality.add_argument(
        "--threshold-profile",
        choices=["strict", "balanced", "lenient"],
        default="strict",
        help="Quality profile used for feed band decisions",
    )
    refresh_quality.add_argument(
        "--thresholds-path",
        default="pipeline/config/feed_quality_thresholds.yaml",
        help="YAML file with feed quality threshold profiles",
    )
    refresh_quality.add_argument("--apply", action="store_true", help="Persist recommended quality updates")
    refresh_quality.add_argument("--report-json", default=None)
    refresh_quality.add_argument("--report-md", default=None)

    promote_feeds = sub.add_parser(
        "promote-company-feeds",
        help="Promote eligible feeds to high-signal in DB registry (never mutates YAML)",
    )
    promote_feeds.add_argument("--mode", choices=["report", "apply"], default="report")
    promote_feeds.add_argument("--only", type=str, default=None, help="Comma-separated feed keys")

    send_alerts_cmd = sub.add_parser(
        "send-alerts",
        help="Manual alert generation entrypoint (cron uses same DB function in production)",
    )
    send_alerts_cmd.add_argument("--frequency", choices=["daily", "weekly"], default="daily")

    recalc_ranking = sub.add_parser(
        "recalculate-user-ranking",
        help="Recompute per-user ranking state from feedback events",
    )
    recalc_ranking.add_argument("--lookback-days", type=int, default=90)
    recalc_ranking.add_argument("--user-id", default=None)
    recalc_ranking.add_argument("--apply", action="store_true")

    eval_precision = sub.add_parser(
        "evaluate-precision",
        help="Export samples, ingest labels, and report precision from human labels",
    )
    eval_precision.add_argument("--mode", choices=["export", "ingest-labels", "report"], required=True)
    eval_precision.add_argument("--lens", choices=["high_signal", "broad", "graduate_trainee"], default="high_signal")
    eval_precision.add_argument("--top-n", type=int, default=100)
    eval_precision.add_argument("--period-days", type=int, default=14)
    eval_precision.add_argument("--output-csv", default="pipeline/reports/precision_labels_sample.csv")
    eval_precision.add_argument("--input-csv", default="pipeline/reports/precision_labels_sample.csv")
    eval_precision.add_argument("--reviewer-key", default="manual-reviewer")

    validate = sub.add_parser("validate-usefulness", help="Check feed usefulness thresholds")
    validate.add_argument("--sample-size", type=int, default=50)
    validate.add_argument("--min-relevant-pct", type=int, default=70)
    validate.add_argument("--max-noise-pct", type=int, default=15)

    launch_gate = sub.add_parser("launch-gate", help="Generate UX-first launch readiness gate report")
    launch_gate.add_argument("--top-relevant-size", type=int, default=20)
    launch_gate.add_argument("--top-early-career-size", type=int, default=50)
    launch_gate.add_argument("--top-consultancy-size", type=int, default=20)
    launch_gate.add_argument("--noise-sample-size", type=int, default=200)
    launch_gate.add_argument("--min-top-20-relevant-pct", type=int, default=85)
    launch_gate.add_argument("--min-top-50-early-career-pct", type=int, default=40)
    launch_gate.add_argument("--max-top-20-consultancy-share-pct", type=int, default=25)
    launch_gate.add_argument("--max-noise-sample-200-pct", type=int, default=5)
    launch_gate.add_argument("--report-json", default="pipeline/reports/launch_gate_report.json")
    launch_gate.add_argument("--report-md", default="docs/launch_gate_report.md")
    launch_gate.add_argument("--no-fail", action="store_true")

    precision = sub.add_parser("precision-review", help="Generate Phase 1.5 precision/source-gap report")
    precision.add_argument("--top-n", type=int, default=100)
    precision.add_argument("--period-days", type=int, default=14)
    precision.add_argument("--report-md", default="docs/precision_review_phase1_5.md")
    precision.add_argument("--report-json", default="pipeline/reports/precision_review_phase1_5.json")

    cleanup = sub.add_parser("cleanup-demo", help="Delete demo rows from pipeline tables")
    cleanup.add_argument("--confirm", action="store_true")

    compact = sub.add_parser("compact-storage", help="Bound table growth by clearing/deleting old rows")
    compact.add_argument("--confirm", action="store_true", help="Apply compaction changes; default is dry-run")
    compact.add_argument("--batch-size", type=int, default=500)
    compact.add_argument("--max-batches-per-phase", type=int, default=5)

    expire = sub.add_parser("expire-deadlines", help="Deactivate active jobs whose application deadline has passed")
    expire.add_argument("--batch-size", type=int, default=500)
    expire.add_argument("--max-batches", type=int, default=10)

    sub.add_parser("db-audit", help="Read-only audit of pipeline table counts and retention eligibility")

    purge = sub.add_parser(
        "purge-inactive-jobs",
        help="Delete inactive unreferenced jobs by id cursor pagination (dry-run by default)",
    )
    purge.add_argument("--confirm", action="store_true", help="Apply deletions; default is dry-run")
    purge.add_argument("--batch-size", type=int, default=500)
    purge.add_argument("--max-batches", type=int, default=100)
    purge.add_argument("--start-after-id", type=int, default=0)
    purge.add_argument("--stop-after-deleted", type=int, default=None)
    purge.add_argument("--sleep-ms", type=int, default=100)

    sub.add_parser("state", help="Print ingestion state")

    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pipeline, storage = build_pipeline()

    if args.command == "snapshot":
        count = pipeline.run_snapshot(limit=args.limit)
        print(f"snapshot_rows={count}")
        return

    if args.command == "reclassify":
        count = pipeline.reclassify_existing(limit=args.limit, active_only=not args.include_inactive)
        print(f"reclassified_rows={count}")
        return

    if args.command == "poll-once":
        count = pipeline.run_stream_once(limit=args.limit)
        print(f"poll_rows={count}")
        return

    if args.command == "poll":
        pipeline.run_poll_forever()
        return

    if args.command == "smoke":
        count = pipeline.run_smoke(limit=args.limit)
        print(f"smoke_rows={count}")
        return

    if args.command == "sync-taxonomy":
        count = pipeline.sync_taxonomy(limit=args.limit)
        print(f"taxonomy_rows={count}")
        return

    if args.command == "sync-company-feeds":
        settings = load_settings()
        only_keys = [part.strip() for part in (args.only or "").split(",") if part.strip()]
        report = pipeline.run_company_feeds_once(
            max_rows=args.max_rows if args.max_rows is not None else settings.feed_row_budget,
            max_http=args.max_http if args.max_http is not None else settings.feed_http_budget,
            only_keys=only_keys or None,
            clear_auto_disable=bool(args.clear_auto_disable),
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "verify-company-sources":
        company_names = [part.strip() for part in args.companies.split(",") if part.strip()]
        report = pipeline.verify_company_sources(
            company_names=company_names,
            max_rows=args.max_rows,
            max_http_per_provider=args.max_http_per_provider,
            registry_path=args.registry_path,
        )

        json_path = Path(args.report_json)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

        if args.report_md:
            lines = [
                "# Company Source Verification",
                "",
                f"Generated at: `{report.get('generated_at', '')}`",
                "",
            ]
            for company in report.get("companies", []):
                lines.extend(
                    [
                        f"## {company.get('display_name') or company.get('company_canonical')}",
                        "",
                        f"- canonical: `{company.get('company_canonical')}`",
                        f"- current_status: `{company.get('current_status')}`",
                        f"- recommended_status: `{company.get('recommended_status')}`",
                    ]
                )
                if company.get("recommended_provider"):
                    lines.append(f"- recommended_provider: `{company.get('recommended_provider')}`")
                if company.get("recommended_identifier"):
                    lines.append(f"- recommended_identifier: `{company.get('recommended_identifier')}`")
                lines.append("")
                lines.append("| Provider | HTTP | Endpoint | Location filtering | Target rows | Notes |")
                lines.append("| --- | --- | --- | --- | --- | --- |")
                for attempt in company.get("attempts", []):
                    notes: list[str] = []
                    status = attempt.get("status")
                    error = attempt.get("error")
                    if status:
                        notes.append(str(status))
                    if error:
                        notes.append(str(error))
                    lines.append(
                        "| "
                        + " | ".join(
                            [
                                str(attempt.get("provider", "")),
                                str(attempt.get("http_status", "")),
                                str(attempt.get("endpoint_url", "")).replace("|", "/"),
                                str(bool(attempt.get("location_filtering_supported", False))),
                                str(attempt.get("target_rows", "")),
                                ", ".join(notes).replace("|", "/"),
                            ]
                        )
                        + " |"
                    )
                lines.append("")
            md_path = Path(args.report_md)
            md_path.parent.mkdir(parents=True, exist_ok=True)
            md_path.write_text("\n".join(lines), encoding="utf-8")

        print(json.dumps(report, indent=2))
        return

    if args.command == "verify-company-sources-batch":
        status_filters = [part.strip() for part in str(args.statuses).split(",") if part.strip()]
        report = verify_company_sources_batch(
            pipeline,
            statuses=status_filters,
            max_companies=int(args.max_companies),
            max_rows=int(args.max_rows),
            max_http_per_provider=int(args.max_http_per_provider),
            registry_path=str(args.registry_path),
        )
        write_report_files(
            report=report,
            json_path=args.report_json,
            markdown_path=args.report_md,
            title="Company Source Verification (Batch)",
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "sync-feed-registry-from-yaml":
        only_keys = [part.strip() for part in (args.only or "").split(",") if part.strip()]
        report = sync_feed_registry_from_yaml(
            storage,
            config_path=str(args.config_path),
            only_keys=only_keys or None,
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "refresh-feed-quality":
        report = refresh_feed_quality(
            storage,
            lookback_days=int(args.lookback_days),
            min_runs=(int(args.min_runs) if args.min_runs is not None else None),
            threshold_profile=str(args.threshold_profile),
            thresholds_path=str(args.thresholds_path),
            apply=bool(args.apply),
        )
        write_report_files(
            report=report,
            json_path=args.report_json,
            markdown_path=args.report_md,
            title="Feed Quality Refresh",
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "promote-company-feeds":
        only_keys = [part.strip() for part in (args.only or "").split(",") if part.strip()]
        report = promote_company_feeds(
            storage,
            mode=str(args.mode),
            feed_keys=only_keys or None,
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "send-alerts":
        report = send_alerts(storage, frequency=str(args.frequency))
        print(json.dumps(report, indent=2))
        return

    if args.command == "recalculate-user-ranking":
        report = recalculate_user_ranking(
            storage,
            lookback_days=int(args.lookback_days),
            user_id=(str(args.user_id).strip() or None) if args.user_id is not None else None,
            apply=bool(args.apply),
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "evaluate-precision":
        mode = str(args.mode)
        if mode == "export":
            report = evaluate_precision_export(
                storage,
                lens=str(args.lens),
                top_n=int(args.top_n),
                period_days=int(args.period_days),
                output_csv=str(args.output_csv),
            )
        elif mode == "ingest-labels":
            report = evaluate_precision_ingest_labels(
                storage,
                input_csv=str(args.input_csv),
                default_reviewer_key=str(args.reviewer_key),
            )
        else:
            report = evaluate_precision_report(storage, lens=str(args.lens))
        print(json.dumps(report, indent=2))
        return

    if args.command == "validate-usefulness":
        profile = load_target_profile(load_settings().target_profile_path)
        report = usefulness_report(
            storage,
            profile,
            sample_size=args.sample_size,
            min_relevant_pct=args.min_relevant_pct,
            max_noise_pct=args.max_noise_pct,
        )
        print(json.dumps(report, indent=2))
        if not report.get("passes_threshold"):
            raise SystemExit(1)
        return

    if args.command == "launch-gate":
        profile = load_target_profile(load_settings().target_profile_path)
        report = launch_readiness_report(
            storage,
            profile,
            top_relevant_size=args.top_relevant_size,
            top_early_career_size=args.top_early_career_size,
            top_consultancy_size=args.top_consultancy_size,
            noise_sample_size=args.noise_sample_size,
            min_top_20_relevant_pct=args.min_top_20_relevant_pct,
            min_top_50_early_career_pct=args.min_top_50_early_career_pct,
            max_top_20_consultancy_share_pct=args.max_top_20_consultancy_share_pct,
            max_noise_sample_200_pct=args.max_noise_sample_200_pct,
            report_json_path=args.report_json,
            report_markdown_path=args.report_md,
        )
        print(json.dumps(report, indent=2))
        if not report.get("passes_launch_gate") and not args.no_fail:
            raise SystemExit(1)
        return

    if args.command == "precision-review":
        profile = load_target_profile(load_settings().target_profile_path)
        report = precision_review_phase15(
            storage,
            profile,
            top_n=args.top_n,
            period_days=args.period_days,
            markdown_path=args.report_md,
            json_path=args.report_json,
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "cleanup-demo":
        storage.delete_demo_data(confirm=args.confirm)
        print("demo_cleanup=ok")
        return

    if args.command == "compact-storage":
        report = pipeline.compact_storage(
            confirm=bool(args.confirm),
            batch_size=int(args.batch_size),
            max_batches_per_phase=int(args.max_batches_per_phase),
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "expire-deadlines":
        report = pipeline.expire_jobs_past_deadline(
            batch_size=int(args.batch_size),
            max_batches=int(args.max_batches),
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "db-audit":
        settings = load_settings()
        report = run_db_audit(storage, settings)
        print(json.dumps(report, indent=2))
        return

    if args.command == "purge-inactive-jobs":
        report = purge_inactive_jobs(
            storage,
            confirm=bool(args.confirm),
            batch_size=int(args.batch_size),
            max_batches=int(args.max_batches),
            start_after_id=int(args.start_after_id),
            stop_after_deleted=args.stop_after_deleted,
            sleep_ms=int(args.sleep_ms),
        )
        print(json.dumps(report, indent=2))
        return

    if args.command == "state":
        print(pipeline.dump_state())
        return

    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
