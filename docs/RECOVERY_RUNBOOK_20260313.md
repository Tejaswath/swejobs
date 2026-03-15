# SweJobs Recovery Runbook (2026-03-13)

This runbook is the exact recovery sequence for the current production state.

## What Has Been Verified

- `launch-gate` runs against the live database and currently passes.
- `precision-review` runs against the live database and confirms the real gap is source coverage, not generic ranking quality.
- The worker appears stopped. `last_poll_at` is `2026-03-10T12:01:28.703669+00:00`.
- `sync-company-feeds` against `spotify_lever` currently fails because the live database still rejects `role_family = 'mobile'`.
- `ENABLE_COMPANY_FEEDS` is not set in `.env`, so the poll loop will not run ATS feeds automatically even after schema recovery.

## Current Confirmed Live Blockers

1. Supabase database size is over free-tier quota.
2. The live `jobs_role_family_check` constraint has not been updated to allow `mobile`.
3. ATS polling is disabled by default until `ENABLE_COMPANY_FEEDS=true` is added to `.env`.

## Phase 1: Local Verification

Run:

```bash
cd /Users/tejaswath/projects/swejobs
set -a && source .env && set +a
.venv/bin/python -m pipeline.main state
.venv/bin/python -m pipeline.main launch-gate --no-fail
.venv/bin/python -m pipeline.main precision-review --top-n 100 --period-days 14
```

Expected current findings:

- `last_poll_at` is stale.
- `launch-gate` passes.
- `precision-review` shows very high missing-company rate for LinkedIn-style companies such as Spotify.

## Phase 2: Supabase Size Verification

Run in Supabase SQL Editor:

```sql
select
  c.relname as table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;
```

```sql
select
  count(*) as total_rows,
  count(*) filter (where raw_json is not null) as raw_json_rows,
  count(*) filter (where coalesce(published_at, ingested_at) < now() - interval '7 days') as older_than_7d,
  count(*) filter (where coalesce(published_at, ingested_at) < now() - interval '120 days') as older_than_120d
from public.jobs;
```

## Phase 3: Cleanup

Stop all writers before cleanup:

- Stop any local `poll` process.
- Stop any deployed Azure worker if one is running.

Run this cleanup block in Supabase SQL Editor:

```sql
begin;

truncate table public.job_events;
truncate table public.weekly_digests;

update public.jobs
set raw_json = null
where raw_json is not null
  and coalesce(published_at, ingested_at) < now() - interval '7 days';

delete from public.jobs
where coalesce(published_at, ingested_at) < now() - interval '120 days';

commit;
```

Run `VACUUM` as separate executions, one statement at a time:

```sql
vacuum (full, analyze) public.jobs;
```

```sql
vacuum (analyze) public.job_tags;
```

Then rerun the size query from Phase 2.

## Phase 4: Schema Verification

Run in Supabase SQL Editor:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname = 'jobs_role_family_check';
```

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_jobs_source_url_not_null',
    'idx_jobs_active_target_relevance_published'
  );
```

If `mobile` is missing from the check constraint or either index is missing, apply:

- `/Users/tejaswath/projects/swejobs/supabase/migrations/20260310170000_ats_v1_indexes_and_role_family.sql`

Rerun the constraint/index queries after applying it.

## Phase 5: Enable ATS Polling

Add this line to `.env` if it is missing:

```bash
ENABLE_COMPANY_FEEDS=true
```

Optional but recommended explicit settings:

```bash
FEED_INTERVAL_POLLS=5
FEED_HTTP_BUDGET=3
FEED_ROW_BUDGET=40
FEED_CONSECUTIVE_MISS_THRESHOLD=10
```

## Phase 6: ATS Probe and Rebuild

Run:

```bash
cd /Users/tejaswath/projects/swejobs
set -a && source .env && set +a
.venv/bin/python -m pipeline.main sync-company-feeds --clear-auto-disable --only spotify_lever,kambi_greenhouse --max-rows 40 --max-http 3
.venv/bin/python -m pipeline.main reclassify
.venv/bin/python -m pipeline.main launch-gate
.venv/bin/python -m pipeline.main precision-review --top-n 100 --period-days 14
```

Verify ATS rows directly in Supabase:

```sql
select id, headline, employer_name, company_canonical, role_family, career_stage, relevance_score, published_at, source_url
from public.jobs
where company_canonical in ('spotify', 'kambi')
order by published_at desc
limit 20;
```

## Phase 7: Local Product Check

Run:

```bash
cd /Users/tejaswath/projects/swejobs
npm run dev
```

Check:

1. Search `spotify` in Jobs.
2. Search `kambi` in Jobs.
3. Confirm rows appear and are not suppressed as noise.

## Current Coverage Interpretation

- Product quality is good enough for current DB contents.
- Coverage is still poor for LinkedIn-style target companies.
- The next source expansion step should happen only after Spotify and Kambi ingest end-to-end successfully.
- Workday should be added after that, not before.
