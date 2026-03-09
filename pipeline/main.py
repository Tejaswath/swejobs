from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime, timedelta

from .digest import current_week_period, generate_weekly_digest
from .ingest import IngestionPipeline
from .jobtech import JobTechClient
from .logging_utils import configure_logging
from .settings import load_settings
from .storage import SupabaseStorage
from .target_profile import load_target_profile
from .validation import usefulness_report


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
    )
    return pipeline, storage


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SweJobs ingestion pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    snapshot = sub.add_parser("snapshot", help="Run full snapshot ingestion")
    snapshot.add_argument("--limit", type=int, default=None)

    stream_once = sub.add_parser("poll-once", help="Run one stream polling pass")
    stream_once.add_argument("--limit", type=int, default=None)

    sub.add_parser("poll", help="Run continuous stream polling")

    smoke = sub.add_parser("smoke", help="Run one-row live smoke ingestion")
    smoke.add_argument("--limit", type=int, default=1)

    taxonomy = sub.add_parser("sync-taxonomy", help="Sync taxonomy cache")
    taxonomy.add_argument("--limit", type=int, default=None)

    digest = sub.add_parser("digest", help="Generate weekly digest")
    digest.add_argument("--days", type=int, default=7, help="Window size for digest generation")

    validate = sub.add_parser("validate-usefulness", help="Check feed usefulness thresholds")
    validate.add_argument("--sample-size", type=int, default=50)
    validate.add_argument("--min-relevant-pct", type=int, default=70)
    validate.add_argument("--max-noise-pct", type=int, default=15)

    cleanup = sub.add_parser("cleanup-demo", help="Delete demo rows from pipeline tables")
    cleanup.add_argument("--confirm", action="store_true")

    sub.add_parser("state", help="Print ingestion state")

    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pipeline, storage = build_pipeline()

    if args.command == "snapshot":
        count = pipeline.run_snapshot(limit=args.limit)
        print(f"snapshot_rows={count}")
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

    if args.command == "digest":
        if args.days == 7:
            start, end = current_week_period(datetime.now(UTC))
        else:
            end = datetime.now(UTC)
            start = end - timedelta(days=int(args.days))

        digest_json = generate_weekly_digest(storage, period_start=start, period_end=end, target_only=True)
        print(json.dumps(digest_json, indent=2))
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

    if args.command == "cleanup-demo":
        storage.delete_demo_data(confirm=args.confirm)
        print("demo_cleanup=ok")
        return

    if args.command == "state":
        print(pipeline.dump_state())
        return

    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
