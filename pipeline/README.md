# SweJobs Pipeline

This worker ingests JobTech data into Supabase with a usefulness layer.

## Security

- `SUPABASE_SERVICE_ROLE_KEY` is used only by this worker.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code or client-side env vars.

## Setup

1. Create a virtual environment.
2. Install dependencies:
   - `pip install -r pipeline/requirements.txt`
3. Copy `.env.example` to `.env` and fill pipeline variables.

## Commands

- One-row smoke test:
  - `python -m pipeline.main smoke`
- Snapshot ingest:
  - `python -m pipeline.main snapshot`
- Poll stream once:
  - `python -m pipeline.main poll-once`
- Continuous polling:
  - `python -m pipeline.main poll`
- Run one ATS feed pass:
  - `python -m pipeline.main sync-company-feeds --max-rows 40 --max-http 3`
- Verify provider order for target companies:
  - `python -m pipeline.main verify-company-sources --companies infosys,paypal,amazon,zalando,cisco`
- Sync taxonomy cache:
  - `python -m pipeline.main sync-taxonomy`
- Generate digest:
  - `python -m pipeline.main digest`
- Validate usefulness thresholds:
  - `python -m pipeline.main validate-usefulness --sample-size 50`
- Generate launch gate report (UX-first):
  - `python -m pipeline.main launch-gate`
- Print ingestion state:
  - `python -m pipeline.main state`

Launch gate defaults:

- `top_20_relevant_pct >= 85`
- `top_50_early_career_pct >= 40`
- `top_20_consultancy_share_pct <= 25`
- `noise_sample_200_pct <= 5`

Outputs:

- `pipeline/reports/launch_gate_report.json`
- `docs/launch_gate_report.md`

Command exits non-zero when the gate fails. Use `--no-fail` to always exit zero.

## Reliability Guarantees

- Exponential backoff with jitter for network failures.
- Checkpoints update only after successful persistence.
- Idempotent upserts by `jobs.id`.
- Duplicate-safe stream reprocessing through deterministic payload hashing.
- Source-url dedupe for ATS rows to avoid duplicate job entries across sources.
- Per-feed auto-disable when a feed yields zero target rows repeatedly.

## ATS Feeds (v1)

- Feed config file: `pipeline/config/company_feeds.yaml`
- Coverage registry file: `pipeline/config/company_registry.json`
- Providers implemented: `greenhouse`, `lever`, `teamtailor`, `smartrecruiters`, `workday`
- Required migration before first ATS sync:
  - `supabase/migrations/20260310170000_ats_v1_indexes_and_role_family.sql`
- Required migration before source-aware trust signals:
  - `supabase/migrations/20260313153000_coverage_trust_fields.sql`
- Feed execution is budget-governed and leftover-only in poll mode:
  - Stream runs first.
  - ATS runs only every `FEED_INTERVAL_POLLS`.
  - ATS row budget is `min(leftover_stream_budget, FEED_ROW_BUDGET)`.
  - ATS request cap per pass is `FEED_HTTP_BUDGET`.

Useful env vars:

- `ENABLE_COMPANY_FEEDS`
- `COMPANY_FEED_CONFIG_PATH`
- `FEED_INTERVAL_POLLS`
- `FEED_HTTP_BUDGET`
- `FEED_ROW_BUDGET`
- `FEED_CONSECUTIVE_MISS_THRESHOLD`

Trust rules implemented:

- Covered company searches should either show results or an explicit coverage-status message.
- Direct ATS rows default away from the `Consultancy` label unless recruiter/staffing evidence is explicit.
- Coverage expansion uses structured endpoints first; HTML fallback is allowed only for explicitly marked Tier A companies.

## Azure Web App

Build and run container:

- `docker build -f pipeline/Dockerfile -t swejobs-pipeline .`
- `docker run --env-file .env -p 8000:8000 swejobs-pipeline`

Health endpoint:

- `GET /health`

## Launch Workflow Notes

1. Do one final relevance tuning pass before deploy:
   - `python -m pipeline.main reclassify`
   - `python -m pipeline.main validate-usefulness --sample-size 200`
   - `python -m pipeline.main launch-gate`
2. If the gate is close but not perfect after that single pass, ship v1 and iterate post-launch.
3. Run a canary worker window (2-4 hours) before public frontend sharing.
4. If demo/seeded rows are still visible in prod-facing tables, run cleanup before public sharing:
   - `python -m pipeline.main cleanup-demo --confirm`
   - `python -m pipeline.main digest --mode rolling --days 30`
