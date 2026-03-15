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

## Phase 1.95: High-signal DB migration

- File: `supabase/migrations/20260309203000_high_signal_v3.sql`
- Adds high-signal ranking columns:
  - `source_name`
  - `company_canonical`
  - `company_tier`
  - `career_stage`
  - `career_stage_confidence`
  - `is_grad_program`
  - `years_required_min`
  - `swedish_required`
  - `consultancy_flag`
- Adds feed-performance indexes:
  - `(is_active, is_target_role, relevance_score desc, published_at desc)`
  - `(company_tier, published_at desc)`
  - `(career_stage, published_at desc)`
  - `(swedish_required, years_required_min)`

## Phase 1.96: ATS v1 index + role-family enforcement

- File: `supabase/migrations/20260310170000_ats_v1_indexes_and_role_family.sql`
- Adds required dedupe index:
  - `jobs(source_url) where source_url is not null`
- Re-enforces first-screen ordering index:
  - `(is_active, is_target_role, relevance_score desc, published_at desc)`
- Rebuilds `jobs_role_family_check` to include `mobile`.

## Phase 1.97: Coverage trust schema

- File: `supabase/migrations/20260313153000_coverage_trust_fields.sql`
- Adds source-aware trust fields:
  - `source_provider`
  - `source_kind`
  - `source_company_key`
  - `is_direct_company_source`
  - `citizenship_required`
  - `security_clearance_required`
- Adds source diagnostics index:
  - `(company_canonical, source_provider)`

## Phase 2: Local pipeline build/run

- Install deps: `pip install -r pipeline/requirements.txt`
- Taxonomy sync: `python -m pipeline.main sync-taxonomy`
- Snapshot ingest: `python -m pipeline.main snapshot`
- Generate canonical rolling digest: `python -m pipeline.main digest --mode rolling --days 30`
- Stream pass: `python -m pipeline.main poll-once`
- ATS feed pass (manual): `python -m pipeline.main sync-company-feeds --max-rows 40 --max-http 3`
- Company source verification: `python -m pipeline.main verify-company-sources --companies infosys,paypal,amazon,zalando,cisco`
- Continuous worker: `python -m pipeline.main poll`

ATS env controls:

- `ENABLE_COMPANY_FEEDS`
- `COMPANY_FEED_CONFIG_PATH`
- `FEED_INTERVAL_POLLS`
- `FEED_HTTP_BUDGET`
- `FEED_ROW_BUDGET`
- `FEED_CONSECUTIVE_MISS_THRESHOLD`

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

## Phase 2.6: Phase 1.5 precision/source-gap gate (mandatory)

- Run:
  - `python -m pipeline.main precision-review --top-n 100 --period-days 14`
- Outputs:
  - `docs/precision_review_phase1_5.md`
  - `pipeline/reports/precision_review_phase1_5.json`
- Manual completion required:
  - Compare top target companies vs LinkedIn for same 14-day period.
  - Decide gate outcome:
    - tune Phase 1 relevance first, or
    - move to connector expansion.

## Phase 2.7: UX-first launch gate (mandatory)

- Run:
  - `python -m pipeline.main launch-gate`
- Outputs:
  - `pipeline/reports/launch_gate_report.json`
  - `docs/launch_gate_report.md`
- Launch thresholds:
  - `top_20_relevant_pct >= 85`
  - `top_50_early_career_pct >= 40`
  - `top_20_consultancy_share_pct <= 25`
  - `noise_sample_200_pct <= 5`

### Stop condition for relevance tuning

- Do exactly one final tuning pass before deploy:
  - `python -m pipeline.main reclassify`
  - `python -m pipeline.main validate-usefulness --sample-size 200`
  - `python -m pipeline.main launch-gate`
- If thresholds are close but not perfect after this one pass, ship v1 and iterate post-launch.

## Phase 3: Azure Web App worker deployment

- Build image: `docker build -f pipeline/Dockerfile -t swejobs-pipeline .`
- Required worker env vars:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `JOBTECH_API_KEY`
  - `POLL_SECONDS=60`
  - `DIGEST_WINDOW_DAYS=30`
  - `DIGEST_REFRESH_MINUTES=60`
  - `TZ=Europe/Stockholm`
- Health probe path: `/health`
- Keep the previous known-good worker image tag available in ACR for rollback.

## Phase 3.5: Canary verification (mandatory before public frontend)

- Deploy worker.
- Run the worker canary for 2-4 hours before sharing frontend publicly.
- Verify during canary:
  - `python -m pipeline.main state` shows `last_poll_at` advancing.
  - `job_events` and `job_tags` continue growing at expected rate.
  - No crash loop in Azure Web App logs.
  - No Supabase auth/RLS failures.
- Canary exit criteria:
  - Stable polling through full canary window.
  - No sustained error bursts.
  - No obvious ranking/data corruption spike.

## Phase 3.75: Conditional demo cleanup before public share

- If demo/seeded rows are visible in prod-facing tables/UI, run cleanup before Phase 4 completes.
- Option A: SQL script `pipeline/demo_cleanup.sql`
- Option B: `python -m pipeline.main cleanup-demo --confirm`
- Then regenerate digest from live data:
  - `python -m pipeline.main digest --mode rolling --days 30`

## Phase 4: Vercel frontend deployment

- Deploy frontend repo (`swejobs`) to Vercel.
- Configure frontend env vars only (never service role key).
- Keep previous Vercel deployment available/unpruned for instant rollback.

## Phase 5: Cost-safe deployment guardrails

- Keep Supabase for DB/auth (no migration churn now).
- Frontend deploy target: Vercel low tier.
- Ingestion deploy target: one small Azure Web App worker instance.
- Keep autoscale disabled initially.

Weekly review checklist:

- API calls per source (`jobtech`, then connector sources when enabled).
- Rows ingested per day.
- Storage growth (`jobs`, `job_events`, `weekly_digests`).
- Connector failure/retry rate.
- Trigger action if any metric exceeds expected budget envelope.
- Feed auto-disable behavior:
  - If a feed yields `0` target rows for `FEED_CONSECUTIVE_MISS_THRESHOLD` runs, it is auto-disabled.
  - Re-enable manually:
    - `python -m pipeline.main sync-company-feeds --clear-auto-disable --only <feed_key>`

## Rollback procedure (worker + frontend)

Worker rollback:

1. Stop worker instance.
2. Inspect checkpoint:
   - `python -m pipeline.main state`
3. Redeploy previous known-good image tag from ACR.
4. Regenerate digest:
   - `python -m pipeline.main digest --mode rolling --days 30`
5. Resume worker and verify `last_poll_at` advances.

Frontend rollback:

1. Re-point production alias to previous Vercel deployment.
2. Re-check jobs, job detail, and digest pages.

Rollback triggers:

- `last_poll_at` stalls (freshness regression).
- Bad-row/noise spike in top feed.
- Repeated auth/persistence failures.

## Post-change digest verification sequence

1. Stop the poll worker.
2. Deploy code updates.
3. Generate one canonical rolling digest:
   - `.venv/bin/python -m pipeline.main digest --mode rolling --days 30`
4. Start poll worker:
   - `.venv/bin/python -m pipeline.main poll`
5. Verify state:
   - `.venv/bin/python -m pipeline.main state`
   - Confirm `last_digest_generated_at` is present.
6. Open UI and verify Overview/Digest reflect rolling 30d data.

## Locked source strategy

- Primary: JobTech JobStream
- Taxonomy enrichment: JobTech Taxonomy
- v1 ATS expansion: static verified feeds from `pipeline/config/company_feeds.yaml`
- Company coverage registry: `pipeline/config/company_registry.json`
- Providers supported in code: Greenhouse, Lever, Teamtailor, SmartRecruiters, Workday
- Activation policy: static config only (no source-gap auto-activation)
- Structured-first policy: prefer provider endpoints; HTML fallback only for explicitly marked Tier A companies
