# SweJobs Agent Handoff and Single Source of Truth

**Snapshot date:** 14 June 2026  
**Workspace:** `/Users/tejaswath/projects/swejobs`  
**Production frontend:** `https://swejobs.vercel.app`  
**Production Supabase project:** `jjbihsezlbllpugwlkgi`  
**Azure worker:** `swejobs-worker-tejas-sec` in resource group `rg-swejobs-prod-sec`  
**Current production branch:** `main`  
**Current deployed worker commit:** `9cb3db156fa27ad5b61c82acbccc99dfdcb297e7`

This document supersedes the old implementation-plan documents as the primary handoff for the next agent. Historical plans and runbooks remain useful for context, but some describe architecture or priorities that have already changed.

## 0. Relevance Overhaul Implementation Status

The approved seven-phase relevance/usefulness overhaul was implemented in the
workspace on 14 June 2026. The code is complete, but the live rollout still
requires the migrations and post-deploy commands listed below.

### Completed in code

- One eligibility contract with shared JSON fixtures and mirrored TypeScript,
  Python, and SQL implementations.
- High Signal and Graduate/Trainee reject senior, 3+ years, Swedish-required,
  citizenship-restricted, and clearance-restricted jobs.
- Explainable suitability is the default frontend order. Resume match is a
  major input but never a hard gate; classifier confidence, career fit, source
  quality, freshness, useful deadlines, bounded company preference, and
  feedback are included.
- Classifier role-family detection is title-first. Generic engineering titles
  require description confirmation, and unrelated domains are excluded.
- Graduate/Trainee distinguishes confirmed graduate programs, junior,
  unknown-possible, and stretch roles and has a confirmed-only toggle.
- User ranking refresh runs daily in the ATS-only worker. Alerts use the same
  eligibility contract. Overview surfaces High Signal counts.
- Worker/admin observability now exposes last success, compaction, ranking
  refresh, and feed failures.
- `job_events` duplicate growth after `raw_json` compaction is fixed by
  persisting a compact payload hash on each job.
- Routes are code-split, Browserslist is current, duplicate Bun lockfiles are
  removed, and the obsolete scoring config is neutralized.
- Useful-coverage and bounded source-verification commands are available.
  Mentimeter and Yubico were newly verified and configured; unverified feeds
  remain disabled.

### New migrations to run manually, in order

1. `supabase/migrations/20260614120000_unified_job_eligibility_alerts.sql`
2. `supabase/migrations/20260614130000_role_family_confidence.sql`
3. `supabase/migrations/20260614140000_jobs_payload_hash.sql`

Do not deploy the new worker before all three migrations are applied. The
worker writes `role_family_confidence` and `payload_hash`.

### Required post-deploy commands

```bash
cd /Users/tejaswath/projects/swejobs
set -a
source .env
set +a

.venv/bin/python -m pipeline.main reclassify
.venv/bin/python -m pipeline.main sync-feed-registry-from-yaml
.venv/bin/python -m pipeline.main sync-company-feeds --only mentimeter_greenhouse,yubico_greenhouse --max-rows 20 --max-http 4
.venv/bin/python -m pipeline.main useful-coverage
.venv/bin/python -m pipeline.main launch-gate --no-fail
.venv/bin/python -m pipeline.main precision-review --top-n 100 --period-days 14
.venv/bin/python -m pipeline.main db-audit
```

The launch gate now requires at least 90% usable top-20 roles and 40%
eligible early-career roles in the top 50. Do not lower these thresholds to
make the gate pass.

### Remaining operational coverage work

Phase 5's verification machinery and curated registry are implemented. Source
coverage itself is an ongoing evidence-driven operation because many target
companies use custom ATS systems or bot protection. Never enable a source
solely to increase feed count. Promote only after a bounded verification shows
working apply links, complete fields, and relevant Sweden roles.

## 1. Product Goal

SweJobs is intended to be a useful, personal Swedish software-engineering job application system, not a general-purpose job-board mirror.

The current product direction is:

1. Direct company ATS feeds are the trusted primary source.
2. JobTech is a small, filtered discovery supplement, not the main catalogue.
3. High Signal should contain only jobs that are realistically worth opening and applying to.
4. Graduate/Trainee should be a reliable early-career application queue.
5. The database must remain small enough for the Supabase free tier.
6. The worker must never rebuild the full JobTech firehose unless explicitly requested.

## 2. Current Production State

### 2.1 Live infrastructure

- Frontend is deployed on Vercel.
- Supabase is the production database, Auth provider, REST API, and Edge Functions platform.
- Azure Web App runs the Python ingestion worker.
- Azure worker state was verified as `Running`.
- Azure health endpoint was verified:

```text
GET https://swejobs-worker-tejas-sec.azurewebsites.net/health
HTTP 200
{"status":"ok","service":"swejobs-pipeline-worker",...}
```

- GitHub manual Azure deployment workflow run `#29` completed successfully for commit `9cb3db1`.
- Normal Pipeline Worker CI also passed for commit `9cb3db1`.

### 2.2 Azure worker configuration

The production worker is intentionally configured in ATS-only mode:

```text
ENABLE_COMPANY_FEEDS=true
WORKER_MODE=ats_only
ATS_SYNC_INTERVAL_SECONDS=3600
ATS_SYNC_HTTP_BUDGET=100
ATS_SYNC_ROW_BUDGET=2000
```

The deployed image is:

```text
acrswejobsprodtejas01.azurecr.io/swejobs-worker:9cb3db156fa27ad5b61c82acbccc99dfdcb297e7
```

The first verified production ATS-only cycle completed successfully:

```text
Starting worker mode=ats_only
ATS sync complete. processed_rows=60 target_rows=32 http_requests=54 feeds_run=25
```

### 2.3 Critical worker safety rule

**Do not run `pipeline.run_poll_forever()` and do not configure `WORKER_MODE=jobtech_poll` in production.**

`run_poll_forever()` continuously calls the JobTech stream and can rebuild the oversized firehose that caused the database quota problem.

The safe production worker entrypoint is:

```text
python -m pipeline.worker
```

with:

```text
WORKER_MODE=ats_only
ENABLE_COMPANY_FEEDS=true
```

ATS-only mode:

- synchronizes enabled direct company feeds;
- expires passed deadlines;
- runs optional translation;
- runs bounded storage compaction;
- does not call the JobTech stream.

### 2.4 Current live catalogue metrics

Read-only aggregate query at approximately 15:05 Stockholm time on 14 June 2026:

```text
active_total: 181
direct_company_ats: 66
jobtech: 115
target roles: 147
noise-classified active rows: 28

career stages:
  unknown: 102
  senior: 46
  junior: 26
  graduate: 4
  mid: 3

graduate or junior classified: 30
```

The frontend screenshots immediately before this handoff showed:

```text
Overview live roles: 147
High Signal visible roles: 19
Broad Discovery visible roles: 121
Graduate / Trainee visible roles: 24
```

The difference between database active rows and frontend visible rows is expected because frontend defaults hide noise, Swedish-required roles, citizenship/security restrictions, 3+ year roles, consultancies, duplicates, and locally hidden jobs.

### 2.5 Feed registry state

```text
feed registry total: 45
enabled: 25
high_signal_eligible: 25
verified band: 25
candidate band: 20
```

Enabled/verified feeds are the active production sources. The remaining 20 candidate feeds are disabled until they are verified and corrected.

### 2.6 Database quota recovery

The Supabase database previously grew to approximately `651 MB`, exceeding the free-plan database-size limit of `0.5 GB`.

Actions completed:

- Azure worker was stopped while cleanup and structural fixes were applied.
- Approximately `192,335` inactive, unreferenced jobs were deleted.
- The large active JobTech catalogue was reduced from roughly `22,900` active rows to a small filtered top-up.
- Direct ATS feeds were synchronized.
- `VACUUM`/analysis and bounded cleanup were used.
- Database size was reduced to approximately `137 MB` after cleanup.
- Worker was redesigned and deployed in ATS-only mode so the firehose cannot immediately return.

The Supabase dashboard may continue showing an “Exceeding Usage Limits” banner during the current billing cycle because the quota was exceeded earlier in the cycle. The screenshot showed the billing cycle as `27 May 2026 - 27 Jun 2026`. Do not create a new Supabase project solely because the banner remains.

Latest read-only database audit:

```text
jobs_total planner estimate: 216
jobs_active planner estimate: 196
jobs_inactive planner estimate: 20
job_events_total planner estimate: 115,388
weekly_digests_total: 366
email_logs_total: 310

compaction eligible:
  raw_json_to_clear: 149
  inactive_jobs_before_cutoff: 2
  job_events_to_delete: 1,381
  weekly_digests_to_delete: 1
  email_logs_to_delete: 103
```

Planner estimates can differ from exact row counts. The main remaining storage-heavy table is likely `job_events`, not `jobs`.

## 3. Work Completed on 13-14 June 2026

### 3.1 Commit `ca1964d`: ATS-first relevance and pipeline hardening

Commit message:

```text
Deploy ATS-first relevance and harden pipeline worker
```

Scope:

- 27 files changed.
- 4,360 insertions and 165 deletions.
- Added feed quality/runtime controls.
- Added safe storage auditing and purging.
- Added V3 relevance runtime and lens behavior.
- Added saved-search alert controls and ranking feedback infrastructure.
- Added migrations and regression tests.

Important changes:

#### Pipeline classification and ingestion

- Improved restriction classification:
  - Swedish-required roles;
  - citizenship restrictions;
  - security-clearance restrictions;
  - seniority;
  - minimum years required;
  - consultancy signals.
- Added source metadata:
  - `source_kind`;
  - `source_feed_key`;
  - `is_direct_company_source`;
  - source company/provider metadata.
- Added direct-feed reconciliation:
  - successful feed runs deactivate missing jobs from that source;
  - failed/incomplete runs do not incorrectly deactivate jobs;
  - source-feed probe history is stored.
- Added deadline expiry and safer compaction behavior.
- Added safe handling for duplicate normalized job IDs.
- Added stable Teamtailor custom-site IDs.

#### V3 runtime

Added `pipeline/v3_runtime.py`, including:

- source feed registry synchronization;
- feed quality refresh;
- feed promotion;
- lens matching;
- saved-search alert generation support;
- user-ranking recalculation from feedback;
- precision export/report support.

#### Storage safety

Added:

- `pipeline/db_audit.py`;
- `pipeline/purge_inactive_jobs.py`;
- foreign-key-safe compaction behavior;
- bounded cleanup phases;
- dry-run-first deletion workflows.

#### Frontend

Explore page gained:

- High Signal, Broad Discovery, and Graduate/Trainee lenses;
- source quality joins;
- direct-company/feed metadata;
- restriction filters;
- career-stage-aware filtering/ranking;
- resume match badges;
- user feedback events;
- watched-company and personalized ranking signals;
- deadline-oriented behavior;
- deduplication.

Saved Searches gained:

- V3 lens settings;
- JobTech-in-High-Signal opt-in;
- alert opt-in controls;
- alert frequency/runtime fields.

#### Migrations introduced

These migrations were manually applied through the Supabase SQL editor because the Supabase CLI was unavailable:

```text
supabase/migrations/20260531160000_relevance_v3_runtime.sql
supabase/migrations/20260601134000_saved_search_alerts_opt_in.sql
supabase/migrations/20260613170000_jobs_active_deadline_partial_index.sql
supabase/migrations/20260613180000_lock_down_alert_generation.sql
```

They add or harden:

- `source_feed_registry`;
- `source_feed_probe_runs`;
- `job_feedback_events`;
- `user_ranking_state`;
- V3 saved-search fields;
- saved-search alert generation;
- active/deadline indexing;
- alert-generation permissions.

**Do not delete old or new migration files.** Migrations are append-only schema history and are required to recreate or audit the database.

### 3.2 Feed registry synchronization and verification

The YAML feed registry was synchronized into Supabase:

```text
feeds_seen: 45
rows_upserted: 45
```

After synchronization:

```text
candidate feeds: 20, enabled 0, high-signal 0
verified feeds: 25, enabled 25, high-signal 25
```

Known working feed results included jobs from:

- Wolt;
- Spotify;
- Recorded Future;
- Funnel;
- Qliro;
- Qasa;
- Storytel;
- Fortnox;
- Platform24;
- Zenseact;
- Kambi;
- Avanza;
- Nordnet.

### 3.3 Commit `1abf3d5`: Graduate/Trainee lens fix

Commit message:

```text
Fix Graduate/Trainee lens filtering
```

Problem fixed:

- Missing experience metadata was previously capable of making ordinary roles appear graduate-eligible.
- Senior signals were not rejected consistently enough.

Current frontend Graduate/Trainee candidate rule:

- reject senior-title/stage/years signals;
- then accept confirmed graduate programs, graduate/trainee/junior stages, or explicitly `<= 1` required year;
- do not treat null/unknown years as graduate eligible.

Regression tests were added in:

```text
src/pages/Jobs.integration.test.tsx
```

### 3.4 Commit `9cb3db1`: safe ATS-only worker

Commit message:

```text
Add safe ATS-only pipeline worker mode
```

Changes:

- Added `WORKER_MODE`, defaulting to `ats_only`.
- Added ATS-only hourly loop.
- Added configurable ATS HTTP and row budgets.
- Added a fail-closed startup check:
  - ATS-only mode refuses to start unless `ENABLE_COMPANY_FEEDS=true`.
- Preserved explicit `jobtech_poll` mode only for deliberate use.
- Added worker-mode regression test proving ATS-only mode never calls JobTech.
- Added Python tests to both worker CI and Azure deployment workflow.

Files:

```text
.env.example
.github/workflows/azure-worker-deploy.yml
.github/workflows/pipeline-worker.yml
pipeline/settings.py
pipeline/worker.py
tests/test_worker_modes.py
```

## 4. Verification Completed

### 4.1 Automated tests

Latest local verification:

```text
Python pipeline tests: 28 passed
Frontend tests: 19 passed across 7 test files
Frontend production build: passed
Python compileall: passed
git diff --check: passed
```

Important pipeline regression areas covered:

- restriction classification;
- graduate/senior conflicts;
- foreign-key-safe compaction;
- company-feed reconciliation;
- deadline expiry;
- inactive-job purge safety;
- safe job IDs;
- V3 lens rules;
- feed quality and promotion;
- ATS-only worker behavior.

Known non-blocking build warnings:

- React Router v7 future-flag warnings in integration tests.
- `caniuse-lite` data is old.
- Vite reports large frontend chunks, especially PDF-related chunks and the main bundle.

### 4.2 Quality reports

Latest usefulness report:

```text
sample size: 50
role-family relevant: 100%
obvious noise: 0%
passes current usefulness threshold: true
```

Latest launch gate:

```text
top-20 relevant: 100%
top-50 early-career: 36%
top-20 consultancy share: 0%
noise sample: 0%
passes launch gate: false
```

Launch gate fails only because early-career share is below the current 40% target.

Latest 14-day precision/source-gap report:

```text
sample size: 100
top-20 automated precision estimate: 100%
early-career hit rate: 24%
clear noise count: 0

career stages:
  unknown: 69
  junior: 20
  senior: 7
  graduate: 4

main companies with matches: 4 / 20
missing-company rate: 80%
```

Companies with matches in that report:

```text
axis
ericsson
saab
volvo cars
```

Main-company gaps in that 14-day report:

```text
amazon
arm
astrazeneca
aws sweden
cisco
google sweden
klarna
microsoft sweden
noda
nordea
paypal
scania
seb
spotify
ubs
zenseact
```

The automated “relevant” metric is too weak because it mostly measures role-family classification, not genuine candidate suitability. Human-facing screenshots exposed experienced and irrelevant roles despite the automated 100% result.

## 5. What Works Now

### Production and operations

- Vercel frontend deployment works.
- Azure worker deployment workflow works.
- Azure worker is running ATS-only mode.
- Worker health endpoint works.
- Direct ATS feeds refresh hourly.
- Deadline expiry works.
- Bounded compaction works.
- Database is no longer dominated by hundreds of thousands of stale jobs.
- JobTech firehose is no longer continuously running.

### Explore

- High Signal lens exists and is ATS/feed-quality focused.
- Broad Discovery exists.
- Graduate/Trainee filter now rejects missing-metadata false positives.
- Default filters hide:
  - Swedish-required roles;
  - citizenship/security restrictions;
  - 3+ year roles;
  - consultancies.
- Resume match is calculated from parsed resume text, tags, and title keywords.
- Seniority penalties are applied to displayed ATS match scores.
- Search, remote, language, deadline, sorting, hide, and pagination work.
- Job cards show useful metadata and source/company tier signals.

### Product surfaces

- Overview/dashboard.
- Explore/jobs.
- Job detail.
- Shortlist/tracked jobs.
- Applications tracker.
- Profile and resume versions.
- Saved searches and opt-in alerts.
- Outreach.
- Skill gap.
- Export.
- Development-only Admin page.
- Chrome extension capture workflow.

### Feedback/personalization infrastructure

The frontend writes feedback events for:

- apply;
- save;
- follow company;
- hide;
- skip.

`pipeline/v3_runtime.py` can calculate user-ranking preferences from these events. This is not yet scheduled automatically in the ATS-only worker.

## 6. Known Problems and Technical Debt

### P0: High Signal frontend/backend inconsistency

The backend `pipeline.v3_runtime.lens_matches()` rejects senior roles from High Signal. The frontend High Signal query and `passesLens()` do not reject all senior signals before display.

Observed examples in High Signal:

- `Experienced Computer Vision Engineer`;
- `Expert Deep Learning Engineer`;
- roles with `Match 0%`.

This is the highest-priority correctness issue.

Relevant files:

```text
src/pages/Jobs.tsx
pipeline/v3_runtime.py
supabase/migrations/20260531160000_relevance_v3_runtime.sql
```

### P0: Classification still produces false positives

Observed false-positive or questionable target roles include:

- experienced/research roles;
- non-software engineering roles classified through broad keyword matches;
- biomedical/chemistry jobs classified as QA/test;
- power/electronics/mechanical roles classified as backend/AI;
- vague titles where description keywords overpower title meaning.

Root causes:

- role-family classification uses the entire text and broad technology tokens such as `python`, `api`, and `automation`;
- exclusion domains are incomplete;
- Swedish senior terms such as `erfaren` are not included in senior patterns;
- “experienced” and “expert” are not in the backend `SENIOR_PATTERNS`;
- automated quality reports treat included role-family labels as proof of relevance.

Relevant files:

```text
pipeline/classify.py
pipeline/config/target_profile.yaml
pipeline/config/scoring.yaml
tests/test_classify_restrictions.py
pipeline/validation.py
```

### P0: Ranking overvalues company prestige

Current ranking can allow prestigious or watched companies to outrank genuinely suitable jobs.

Relevant constants/weights:

```text
src/pages/Jobs.tsx:
  WATCHED_COMPANY_BOOST = 35

pipeline/config/target_profile.yaml:
  company_watch_weight = 20
  main_company_tier_a_weight = 25
```

This contributes to experienced Spotify/Saab roles ranking too highly.

### P1: Resume match is not the default suitability score

Resume match is shown as a badge, but default “Recommended for you” sorting is primarily relevance/company/career-stage based. A `Match 0%` role can appear above a `Match 71%` role.

The product needs a unified suitability score that combines:

- career-stage eligibility;
- restrictions;
- resume/skill match;
- source quality;
- deadline/freshness;
- user feedback;
- company preference.

### P1: Early-career detection is incomplete

- 102 of 181 active jobs currently have `career_stage=unknown`.
- Early-career hit rate is below the target.
- Description-level junior/graduate mentions can still be misleading.
- Confirmed graduate programs and merely “possibly junior-friendly” roles are not separated in the UI.

### P1: Source coverage is incomplete

Only 25 of 45 configured feeds are enabled. Important disabled candidates include:

- Volvo Cars;
- Ericsson;
- Voi;
- Tibber;
- Quinyx;
- inRiver;
- Arrive;
- Adyen;
- Embark Studios;
- Sinch;
- Kry;
- Trustly;
- Betsson;
- Northvolt;
- Tobii;
- iZettle;
- others.

Some may have stale endpoints, invalid providers, location-filter problems, or no currently relevant Swedish jobs. They must be verified before enabling.

### P1: Saved-search alert lens logic is behind frontend logic

The SQL alert generator contains lens predicates but does not include every frontend senior/restriction rule. Any future High Signal/Graduate rule change must be applied consistently to:

1. frontend Explore;
2. `pipeline.v3_runtime.lens_matches`;
3. saved-search alert SQL/RPC.

### P2: Maintenance gaps

- User-ranking recalculation is available but not scheduled in ATS-only mode.
- Feed quality refresh/promotion is available but not scheduled.
- `job_events` remains large.
- `edge_function_quota` audit queries return 400, likely because the expected table is absent or schema differs.
- Build bundle is large.
- Browser compatibility database is stale.
- Duplicate source jobs across providers can still exist.

## 7. Architecture and Important Files

### 7.1 Primary authoritative files

These files are central to current production behavior and should be read before making changes.

#### Frontend

```text
src/App.tsx
```

Routes all product pages.

```text
src/pages/Jobs.tsx
```

Most important current product file. Contains Explore queries, lenses, filters, ranking, ATS match display, dedupe, feedback events, job detail panel, and card rendering.

```text
src/pages/Index.tsx
src/components/overview/*
```

Overview/dashboard metrics, deadline radar, and pipeline summaries.

```text
src/pages/Applications.tsx
src/lib/applications.ts
```

Applications tracker and application normalization.

```text
src/pages/Profile.tsx
src/lib/resumes.ts
src/lib/ats.ts
```

Resume versions, parsed resume text, and ATS keyword match logic.

```text
src/pages/SavedSearches.tsx
```

Saved-search lenses and alert opt-in controls.

```text
src/lib/companyRegistry.ts
pipeline/config/company_registry.json
```

Frontend company/source coverage metadata.

```text
src/integrations/supabase/client.ts
src/integrations/supabase/types.ts
```

Supabase connection and generated/current schema types.

#### Pipeline

```text
pipeline/worker.py
pipeline/settings.py
```

Production worker entrypoint and environment configuration. The worker must remain ATS-only by default.

```text
pipeline/main.py
```

CLI command registry and local operational entrypoint.

```text
pipeline/ingest.py
```

Core orchestration for JobTech, company feeds, reconciliation, deadline expiry, translation, and compaction.

```text
pipeline/classify.py
```

Core role-family, seniority, restriction, noise, and relevance classification. This is a priority file for the next implementation phase.

```text
pipeline/storage.py
```

Supabase persistence, state, compaction, reconciliation, and database operations.

```text
pipeline/v3_runtime.py
```

Feed registry, quality bands, lens evaluation, alerts support, feedback ranking, and precision workflows.

```text
pipeline/validation.py
```

Usefulness, launch-gate, and precision/source-gap reports. Current metrics need strengthening so false positives do not count as relevant.

```text
pipeline/normalize.py
pipeline/target_profile.py
pipeline/company_registry.py
```

Normalization and configuration loading.

```text
pipeline/db_audit.py
pipeline/purge_inactive_jobs.py
```

Safe database audit and cleanup tools.

#### Source adapters

Retain all of these. Some are not currently used by enabled feeds but are active supported capabilities for source expansion:

```text
pipeline/sources/base.py
pipeline/sources/greenhouse.py
pipeline/sources/lever.py
pipeline/sources/teamtailor.py
pipeline/sources/workday.py
pipeline/sources/smartrecruiters.py
pipeline/sources/jobs2web.py
pipeline/sources/html_fallback.py
```

#### Pipeline configuration

```text
pipeline/config/company_feeds.yaml
```

Canonical immutable feed definitions. Currently 45 feeds, with 25 enabled.

```text
pipeline/config/target_profile.yaml
pipeline/config/scoring.yaml
```

Target role families, company preferences, exclusions, and scoring weights.

```text
pipeline/config/company_aliases.yaml
pipeline/config/company_tiers.yaml
```

Company canonicalization and tiers.

```text
pipeline/config/feed_quality_thresholds.yaml
```

Quality-band rules.

#### Database

```text
supabase/migrations/*
```

Append-only schema history. Retain every migration.

```text
supabase/functions/extract-job-title/index.ts
supabase/functions/send-email/index.ts
supabase/functions/track-pixel/index.ts
```

Current Edge Functions.

#### Deployment and CI

```text
.github/workflows/pipeline-worker.yml
```

Runs pipeline tests and Docker image build on relevant pushes.

```text
.github/workflows/azure-worker-deploy.yml
```

Manual workflow that tests, builds, pushes, and deploys the Azure worker image.

```text
pipeline/Dockerfile
vercel.json
```

Worker container and Vercel SPA routing.

#### Tests

Retain all substantive tests:

```text
tests/*
src/lib/*.test.ts
src/pages/*.integration.test.tsx
```

### 7.2 Useful historical/reference files

These are not fully authoritative but may explain past decisions:

```text
PROJECT.md
docs/EXECUTION_RUNBOOK.md
docs/RECOVERY_RUNBOOK_20260313.md
docs/v3_relevance_runtime_runbook.md
docs/company_source_verification*.md
docs/feed_quality_strict_after_wave1.md
docs/precision_review_phase1_5.md
docs/launch_gate_report.md
pipeline/README.md
README.md
```

Important caveat:

- Markdown is globally ignored by `.gitignore`.
- Only `PROJECT.md` is currently tracked.
- Reports and docs may be stale snapshots.
- This handoff should be treated as the newest source of truth.

### 7.3 Files that are not deprecated

Do not remove these even if they seem old or unused:

- any `supabase/migrations/*.sql`;
- any supported `pipeline/sources/*.py` adapter;
- `pipeline/jobtech.py` because JobTech remains available for deliberate filtered/manual top-ups, even though continuous polling is disabled;
- `pipeline/v3_runtime.py`;
- `pipeline/db_audit.py`;
- `pipeline/purge_inactive_jobs.py`;
- `.github/workflows/azure-worker-deploy.yml`;
- `.github/workflows/pipeline-worker.yml`;
- source files for the Chrome extension.

## 8. Removal and Cleanup Candidates

No cleanup was performed while creating this handoff. The worktree already contains user changes and untracked assets. Validate before deleting anything.

### 8.1 Safe local generated/cache removal candidates

These are ignored and reproducible:

```text
dist/
extension/dist/
.pytest_cache/
pipeline/__pycache__/
pipeline/sources/__pycache__/
tests/__pycache__/
supabase/.temp/
.vercel/
```

They can be regenerated by builds, tests, Supabase CLI, or Vercel CLI.

### 8.2 Sensitive local backup files that should be removed after confirming `.env`

These are ignored but may contain secrets:

```text
.env.dev.backup.20260327-191946
.env.dev.backup.20260328-194208
.env.prod.backup
```

Do not print or commit them. Confirm the active `.env` and Azure/GitHub secrets are correct, then securely remove old backups.

### 8.3 Generated report snapshots

These are ignored outputs and can be regenerated:

```text
pipeline/reports/*
docs/launch_gate_report.md
docs/precision_review_phase1_5.md
docs/company_source_verification*.md
docs/feed_quality_strict_after_wave1.md
docs/wave1_sinch_tobii_verify.md
```

Keep them only if historical evidence is valuable. They should not be treated as current production truth.

### 8.4 Historical plans that should be archived or removed after this handoff is accepted

```text
IMPLEMENTATION_PLAN.md
FINAL_IMPLEMENTATION_PLAN.md
docs/RECOVERY_RUNBOOK_20260313.md
scripts/phase0_cutover.sh
```

Reason:

- they describe earlier phases, incomplete proposals, or a one-time cutover;
- several priorities and architecture assumptions are superseded by ATS-only mode and the June cleanup;
- retaining multiple “definitive” plans creates confusion.

Recommended action:

- keep temporarily for reference;
- mark as superseded or move to an archive directory;
- remove only after confirming no needed instructions are missing from this handoff.

### 8.5 Likely removable placeholder/legacy files after validation

```text
src/test/example.test.ts
```

This appears to be a placeholder test and contributes no product regression coverage.

```text
pipeline/demo_cleanup.sql
```

Potential legacy cleanup script. The current CLI uses `cleanup-demo` through pipeline/storage code. Verify the SQL file is not used externally before removal.

```text
bun.lock
bun.lockb
```

Both Bun lockfiles are tracked while current operations use `npm` and `package-lock.json`. Select one package manager. If npm is canonical, remove both Bun lockfiles in a dedicated cleanup commit.

### 8.6 Release artifacts and current untracked user work

Current untracked/generated release files:

```text
extension/store-assets/
extension/swejobs-capture.zip
swejobs-capture-1.0.1.zip
extension/icons/icon16.png
extension/icons/icon48.png
```

These may be intentional Chrome Web Store assets. Do not delete until the extension release process is confirmed.

### 8.7 Current dirty worktree that must not be overwritten

At handoff time, these user changes existed before this document:

```text
M PROJECT.md
M extension/icons/icon128.png
M extension/manifest.json
M public/favicon-swejobs.svg
M public/favicon.ico
?? extension/icons/icon16.png
?? extension/icons/icon48.png
?? extension/store-assets/
?? extension/swejobs-capture.zip
?? swejobs-capture-1.0.1.zip
```

Future agents must preserve and understand these changes rather than reverting them.

## 9. Implementation Plan From Here

The next agent should not start by adding more general features. The priority is making the recommendations trustworthy.

### Phase 1: Make High Signal trustworthy

#### Objective

Every High Signal result should be realistically worth opening for this user.

#### Required changes

1. Create one shared concept/specification for lens eligibility.
2. Apply equivalent rules in:
   - `src/pages/Jobs.tsx`;
   - `pipeline/v3_runtime.py`;
   - saved-search alert SQL/RPC.
3. Reject High Signal jobs with:
   - senior/lead/principal/staff/architect;
   - experienced/expert;
   - Swedish senior terms such as `erfaren`;
   - `years_required_min >= 3`;
   - known restrictions.
4. Decide whether High Signal requires a minimum resume-match score.
5. Reduce or cap watched-company and Tier A boosts.
6. Add “Why recommended” reasons to the UI.
7. Add regression fixtures for every observed bad example.

#### Recommended implementation structure

- Move pure frontend eligibility/ranking functions out of `src/pages/Jobs.tsx` into a testable module such as `src/lib/jobRanking.ts`.
- Add table-driven frontend tests.
- Add matching table-driven Python tests.
- Update alert-generation SQL with the same senior/restriction rules.

#### Acceptance criteria

- No title containing senior/experienced/expert signals appears in High Signal.
- No 3+ year role appears with default restrictions.
- No `Match 0%` role ranks above a strong suitable match without an explicit reason.
- High Signal remains non-empty and useful.
- Frontend, Python evaluator, and saved-search alerts produce equivalent results for shared fixtures.

### Phase 2: Fix classifier precision

#### Objective

Stop non-software and experienced jobs from being classified as target software roles.

#### Required changes

1. Expand senior patterns:
   - `experienced`;
   - `expert`;
   - `erfaren`;
   - relevant Swedish variants.
2. Expand exclusion domains and false-positive fixtures:
   - biomedical/chemistry;
   - power/electronics/mechanical;
   - generic researcher/scientist roles without software focus;
   - operations/coordinator;
   - documentation engineer;
   - consultancy/staffing identity.
3. Make title evidence stronger than description evidence.
4. Avoid assigning backend merely because a description mentions Python/API.
5. Improve role-family precedence and confidence.
6. Strengthen validation reports so human suitability, not only assigned role family, determines precision.
7. Reclassify the active catalogue after changes.

#### Acceptance criteria

- Observed false-positive titles become noise or non-target.
- Human review of top 20 High Signal reaches at least 90% genuinely applicable.
- Graduate/Trainee sample has no senior roles.
- Launch gate passes without gaming thresholds.

### Phase 3: Improve early-career product semantics

#### Objective

Turn Graduate/Trainee into a dependable early-career queue.

#### Required changes

1. Separate:
   - confirmed graduate/trainee programs;
   - explicit junior/entry-level roles;
   - unknown-experience possible-fit roles.
2. Prefer headline evidence over description evidence.
3. Add UI labels such as:
   - `Confirmed graduate`;
   - `Junior`;
   - `Experience unspecified`;
   - `Stretch`.
4. Add filters for confirmed-only versus possible-fit.
5. Improve scoring for genuinely early-career roles.

#### Acceptance criteria

- Confirmed graduate list has very high precision.
- Unknown-experience jobs do not masquerade as graduate roles.
- Early-career share reaches the launch target through better classification/coverage, not threshold relaxation.

### Phase 4: Build a unified suitability ranking

#### Objective

Replace disconnected relevance and ATS percentages with one explainable recommendation score.

#### Inputs

- hard eligibility/restrictions;
- career-stage fit;
- years required;
- resume/skill match;
- source/feed quality;
- freshness and deadline;
- direct-company source;
- user feedback;
- company preference.

#### Product behavior

- Hard restrictions exclude jobs by default.
- Career-stage fit dominates prestige.
- Resume match affects default ordering.
- Company preference is a tie-breaker, not a license to show unsuitable jobs.
- Show `Strong fit`, `Possible fit`, and `Stretch` with reasons.

### Phase 5: Expand trusted company coverage

#### Objective

Increase useful direct-company jobs without restoring the firehose.

#### Process

1. Audit disabled candidate feeds in small batches.
2. Correct endpoints/provider identifiers/location filters.
3. Run one-feed sync with strict budgets.
4. Verify working application links and relevant Swedish roles.
5. Promote only verified feeds.
6. Monitor probe history before considering trusted status.

#### Suggested priority

1. Volvo Cars
2. Ericsson
3. Voi
4. Tibber
5. Trustly
6. Tobii
7. Embark Studios
8. Sinch
9. Klarna and Zalando correctness
10. User-requested companies

### Phase 6: Complete feedback and alerts

#### Objective

Make the app learn and proactively surface useful jobs.

#### Required changes

- Schedule `recalculate-user-ranking --apply`.
- Ensure Apply, Save, Hide, Skip, and Follow behavior updates recommendations.
- Align saved-search alerts with final lens rules.
- Add new High Signal roles to Overview.
- Validate alert delivery and opt-in behavior.

### Phase 7: Operational hardening and cleanup

#### Required changes

- Monitor `job_events` storage and shorten retention if required.
- Fix `edge_function_quota` audit mismatch or remove the audit phase if the table is intentionally absent.
- Add feed failure alerts.
- Add worker-cycle health/last-success visibility.
- Code-split large frontend bundles.
- Update Browserslist data.
- Choose npm or Bun and remove duplicate lockfiles.
- Archive superseded documentation.
- Clean generated caches and old secret backups.

## 10. Exact Operational Commands

Run from:

```bash
cd /Users/tejaswath/projects/swejobs
set -a
source .env
set +a
```

### Safe read-only checks

```bash
.venv/bin/python -m pipeline.main db-audit
.venv/bin/python -m pipeline.main state
.venv/bin/python -m pipeline.main launch-gate --no-fail
.venv/bin/python -m pipeline.main precision-review --top-n 100 --period-days 14
.venv/bin/python -m pipeline.main validate-usefulness
```

### Tests and builds

```bash
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m compileall -q pipeline tests
npm run test
npm run build
git diff --check
```

### Safe company-feed operations

Inspect help first:

```bash
.venv/bin/python -m pipeline.main sync-company-feeds --help
.venv/bin/python -m pipeline.main verify-company-sources --help
.venv/bin/python -m pipeline.main verify-company-sources-batch --help
```

Use small budgets for candidate verification. Do not bulk-enable unverified feeds.

### Database cleanup

Always dry-run first:

```bash
.venv/bin/python -m pipeline.main compact-storage
.venv/bin/python -m pipeline.main purge-inactive-jobs
```

Only use confirmation flags after reviewing the dry-run output.

### Azure status

```bash
az webapp show \
  --resource-group rg-swejobs-prod-sec \
  --name swejobs-worker-tejas-sec \
  --query state \
  --output tsv
```

Health:

```bash
curl -sS -i https://swejobs-worker-tejas-sec.azurewebsites.net/health
```

Safe non-secret settings check:

```bash
az webapp config appsettings list \
  --resource-group rg-swejobs-prod-sec \
  --name swejobs-worker-tejas-sec \
  --query "[?name=='WORKER_MODE' || name=='ENABLE_COMPANY_FEEDS' || name=='ATS_SYNC_INTERVAL_SECONDS' || name=='ATS_SYNC_HTTP_BUDGET' || name=='ATS_SYNC_ROW_BUDGET'].{name:name,value:value}" \
  --output table
```

### Deploying worker changes

1. Commit and push changes to `main`.
2. Confirm Pipeline Worker CI passes.
3. In GitHub Actions, open:
   - `Build and deploy container app to Azure Web App - swejobs-worker-tejas-sec`
4. Click `Run workflow`.
5. Select branch `main`.
6. Wait for test, build, and deploy jobs to pass.
7. Confirm Azure health and logs.

The Azure deployment workflow is manual by design.

## 11. Do-Not-Do List

- Do not run `pipeline.run_poll_forever()` in production.
- Do not set `WORKER_MODE=jobtech_poll` without a deliberate bounded JobTech strategy.
- Do not reimport the complete JobTech snapshot/firehose.
- Do not enable all 45 company feeds without verification.
- Do not delete migration files.
- Do not assume automated “100% relevant” means jobs are human-useful.
- Do not create a new Supabase project solely because the quota banner remains during the current billing cycle.
- Do not revert the current dirty extension/favicon/PROJECT changes.
- Do not commit `.env` or backup environment files.
- Do not perform confirmed cleanup before reviewing dry-run output.

## 12. Recommended Next Agent Starting Sequence

1. Read this file completely.
2. Read:
   - `src/pages/Jobs.tsx`;
   - `pipeline/classify.py`;
   - `pipeline/v3_runtime.py`;
   - `pipeline/config/target_profile.yaml`;
   - `pipeline/config/scoring.yaml`;
   - relevant frontend/Python tests.
3. Run all tests and the production read-only quality commands.
4. Implement Phase 1 only:
   - shared High Signal senior/restriction behavior;
   - regression tests;
   - ranking adjustment;
   - alert SQL alignment if required.
5. Reclassify only after classifier changes are tested.
6. Verify the frontend locally and against production data.
7. Commit, push, deploy frontend/worker as appropriate.
8. Re-run launch gate and human-review the top results.

## 13. Current Git and Documentation Notes

Current committed production head:

```text
9cb3db1 Add safe ATS-only pipeline worker mode
1abf3d5 Fix Graduate/Trainee lens filtering
ca1964d Deploy ATS-first relevance and harden pipeline worker
```

This handoff file is ignored because `.gitignore` currently contains:

```text
*.md
**/*.md
```

If this document should be version-controlled, either:

1. add an exception for this exact filename to `.gitignore`; or
2. force-add it intentionally.

Do not broadly remove the Markdown ignore rule without first deciding which generated/historical documents belong in version control.
