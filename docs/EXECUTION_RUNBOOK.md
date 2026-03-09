# SweJobs Execution Runbook

This runbook maps directly to the approved implementation plan.

## Phase 0: Repo cutover + secret hygiene

- Keep `edge-powered-apps` as archive.
- Active development repo: `swejobs`.
- Ensure `.env` is untracked and ignored.
- Commit `.env.example` only.

## Phase 1: Supabase ownership migration

1. Create your Supabase project.
2. Run migrations in chronological order.
3. Configure frontend variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
4. Create a test account and verify auth + RLS.

## Phase 1.5: One-row real-data smoke

- `python -m pipeline.main smoke`
- Verify one real row exists in:
  - `jobs`
  - `job_tags`
  - `job_events`
  - `ingestion_state`
- Verify it appears in frontend.

## Phase 1.75: Target profile config

- File: `pipeline/config/target_profile.yaml`
- Tune include/exclude rules before full ingestion.

## Phase 1.9: Usefulness DB migration

- File: `supabase/migrations/20260309100000_1f7e_usefulness_fields.sql`
- Adds:
  - `role_family`
  - `relevance_score`
  - `reason_codes`
  - `is_target_role`
  - `is_noise`
- Adds check constraints and indexes.

## Phase 2: Local pipeline build/run

- Install deps: `pip install -r pipeline/requirements.txt`
- Taxonomy sync: `python -m pipeline.main sync-taxonomy`
- Snapshot ingest: `python -m pipeline.main snapshot`
- Stream pass: `python -m pipeline.main poll-once`
- Continuous worker: `python -m pipeline.main poll`

Reliability properties implemented:

- Retry with exponential backoff + jitter.
- Checkpoint update only after successful persistence.
- Duplicate-safe upserts (`jobs.id` conflict key).
- Structured failure logging for parse/network/db issues.

## Phase 2.5: Usefulness validation

- Run: `python -m pipeline.main validate-usefulness --sample-size 50`
- Pass thresholds:
  - relevant >= 70%
  - noise <= 15%
- Report output:
  - `pipeline/reports/usefulness_report.json`

## Phase 3: Azure Web App deployment

- Build image: `docker build -f pipeline/Dockerfile -t swejobs-pipeline .`
- Required worker env vars:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `JOBTECH_API_KEY`
  - `POLL_SECONDS=60`
  - `TZ=Europe/Stockholm`
- Health probe path: `/health`

## Phase 4: Vercel frontend deployment

- Deploy frontend repo (`swejobs`) to Vercel.
- Configure frontend env vars only (never service role key).

## Phase 4.5: Demo data cleanup

After live pipeline validation only:

- Option A: SQL script `pipeline/demo_cleanup.sql`
- Option B: `python -m pipeline.main cleanup-demo --confirm`

Then regenerate digest from live data:

- `python -m pipeline.main digest`

## Locked source strategy

- Primary: JobTech JobStream
- Taxonomy enrichment: JobTech Taxonomy
- Later: Greenhouse/Teamtailor/selected ATS
- Out of scope now: broad Workday scraping
