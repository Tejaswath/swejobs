# SweJobs Agent Operating Constraints

Last verified: 22 June 2026

This is the operating contract for any agent changing or operating SweJobs. Read this file, the root `README.md`, `pipeline/README.md`, and the current git status before doing anything.

## 1. Non-negotiable rules

1. Production worker mode must remain `WORKER_MODE=ats_only`.
2. Never run `python -m pipeline.main poll`, `run_poll_forever`, `WORKER_MODE=jobtech_poll`, or a full JobTech snapshot against production.
3. JobTech production ingestion is only the bounded JobSearch top-up. Keep its row, age, cycle, and active-job guards.
4. Never remove or raise `MAX_ACTIVE_JOBS` without a measured database-capacity review.
5. Never expose `SUPABASE_SERVICE_ROLE_KEY` to Vite, Vercel client variables, browser code, or the extension.
6. Never delete jobs referenced by `tracked_jobs` or `applications`.
7. Storage maintenance is dry-run first. Mutation requires the explicit `--confirm` form.
8. Pipeline changes are not deployed by pushing to `main`. They require the manual Azure worker deployment workflow.
9. Frontend changes on `main` deploy through Vercel. Confirm whether a change is frontend-only before touching Azure.
10. Preserve unrelated dirty files. Stage named files only. Do not commit `.env`, reports containing production data, local archives, or extension ZIPs unless the task is an intentional extension release.

## 2. Architecture and deployment ownership

| Component | Host | Deployment behavior |
| --- | --- | --- |
| React/Vite frontend | Vercel | Deploys from `main` automatically |
| Python ingestion worker | Azure App Service | Manual GitHub Actions workflow only |
| Database, Auth, Storage, Edge Functions | Supabase | Migrations/functions are deployed separately |
| Chrome extension | Local/store release artifact | Build separately; a ZIP is not a frontend deployment |

The Azure workflow is:

`Build and deploy container app to Azure Web App - swejobs-worker-tejas-sec`

It runs tests, builds the worker image, pushes immutable `${github.sha}` and mutable `latest` tags, then deploys the SHA tag. Treat the deployed SHA tag as the source of truth.

Current Azure resource identities must not be casually renamed:

- Web App: `swejobs-worker-tejas-sec`
- App Service plan: `asp-swejobs-prod-b1-sec`
- Resource group: `rg-swejobs-prod-sec`
- Registry: `acrswejobsprodtejas01.azurecr.io`
- Image: `swejobs-worker`

## 3. Job capacity: what “15,000 jobs” actually means

`MAX_ACTIVE_JOBS=15000` is a fail-closed ingestion circuit breaker. It is not a promise that the Supabase Free database can safely hold 15,000 active jobs.

The true capacity constraint is bytes, not row count. Job size varies significantly because descriptions, arrays, indexes, events, and JSON payloads vary. Therefore:

- Hard configured ceiling: **15,000 active jobs**
- Current verified scale on 22 June 2026: **270 active jobs**, 295 total jobs
- Safe maximum row count: **not fixed; measure database size**
- When active jobs reach the configured ceiling, company-feed sync and JobTech top-up must stop while expiration and maintenance continue.

Recommended operational database thresholds:

| Database size | Action |
| --- | --- |
| Below 350 MB | Normal operation |
| 350–400 MB | Warning; identify growth sources and run dry-run audits |
| 400–450 MB | Urgent cleanup and ingestion review |
| Above 450 MB | Stop optional ingestion and reduce size immediately |
| 500 MB | Supabase Free database enters read-only mode |

The warning thresholds are project policy, not Supabase quotas. They preserve recovery room before the hard 500 MB limit.

## 4. Supabase Free-plan constraints

Current official quotas relevant to SweJobs:

| Resource | Free quota | SweJobs rule |
| --- | --- | --- |
| Postgres database size | 500 MB | Read-only above the limit; stay materially below it |
| Provisioned database disk | 1 GB | Do not confuse this with the 500 MB database-size limit |
| Storage buckets | 1 GB | Resume files share this quota |
| Uncached egress | 5 GB/month | Paginate and select only required fields |
| Cached egress | 5 GB/month | Separate quota from uncached egress |
| Monthly active Auth users | 50,000 | Monitor in the Supabase usage dashboard |
| Edge Function invocations | 500,000/month | Avoid unnecessary repeated client calls |
| Realtime messages | 2 million/month | One event counts once per subscribed client |
| Realtime peak connections | 200 | Avoid adding Realtime where polling/caching is enough |

Supabase egress includes traffic from Database/PostgREST, Auth, Storage downloads, Edge Functions, Realtime, shared pooler traffic, and log drains.

Egress controls:

- Select explicit columns. Do not use broad `select("*")` for high-frequency paths.
- Paginate/range all job lists and admin lists.
- Do not fetch the entire jobs table into the browser or worker.
- On inserts/updates, do not return full rows unless the caller needs them.
- Cache stable data and avoid duplicate React Query fetches.
- Use signed URLs only when a private resume is opened; current links expire after 60 seconds.
- Do not add Realtime subscriptions to large/high-churn tables without estimating message fan-out.
- Do not perform full database backups through client APIs.

Official references:

- [Supabase database and Free read-only behavior](https://supabase.com/docs/guides/platform/database-size)
- [Supabase egress quotas and optimization](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Supabase Storage quota](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)
- [Supabase MAU quota](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users)
- [Supabase Edge Function quota](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)
- [Supabase Realtime message quota](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)
- [Supabase Realtime connection quota](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections)

## 5. Job lifecycle and automatic retention

Production defaults:

| Data | Rule |
| --- | --- |
| Active jobs past application deadline | Deactivate daily |
| Active JobTech jobs with no deadline | Deactivate after 30 days |
| `jobs.raw_json` | Clear after 2 days; keep normalized job row |
| Inactive jobs | Eligible for deletion after 7 days |
| `job_events` | Delete after 14 days |
| `weekly_digests` | Delete after 180 days |
| `email_logs` | Audit flags rows older than 90 days; pipeline compaction currently does not delete them |
| Automatic compaction | Every 24 hours |

Important behavior:

- Deadline expiration and no-deadline TTL **deactivate** jobs first.
- Inactive jobs are deleted only when old enough and not referenced.
- `tracked_jobs` and `applications` references preserve the job row indefinitely.
- Clearing `raw_json` must not break update detection. `payload_hash` preserves source-change detection after compaction.
- Reclassification can fall back to normalized columns after `raw_json` has been cleared.
- A compaction result of `applied_partial` means a bounded phase hit its batch ceiling. Re-run later; do not remove bounds.

## 6. Safe database maintenance

Always load the production environment deliberately, confirm the target project, and avoid printing secrets.

Read-only baseline:

```bash
python -m pipeline.main state
python -m pipeline.main db-audit
python -m pipeline.main compact-storage
```

Bounded maintenance sequence:

```bash
python -m pipeline.main compact-storage --confirm
python -m pipeline.main purge-inactive-jobs
python -m pipeline.main purge-inactive-jobs --confirm --batch-size 500 --max-batches 100 --sleep-ms 100
python -m pipeline.main db-audit
python -m pipeline.main compact-storage
```

Rules:

- `compact-storage` and `purge-inactive-jobs` are dry-run by default.
- Manual compaction defaults to 500 rows and 5 batches per phase.
- The daily worker is still bounded, but allows up to 50 batches per phase to drain event backlogs.
- Purging uses ID-cursor pagination. Never replace it with offset pagination or a single unbounded delete.
- Do not delete active jobs merely to reduce row count.
- Do not manually delete referenced jobs or bypass foreign-key safety.
- Repeat bounded batches if necessary.

Deleting rows does not necessarily reduce physical Postgres size immediately because dead tuples remain until vacuuming. Normal `VACUUM` is safer. `VACUUM FULL` locks and rewrites the table and can create temporary pressure; do not run it casually or without an explicit maintenance plan.

If the Free database is already read-only, follow Supabase's documented recovery process to obtain a writable maintenance session, delete safely, run vacuum, and restore normal read/write mode. Do not improvise destructive SQL.

## 7. Production ingestion limits

Required production mode:

```text
WORKER_MODE=ats_only
ENABLE_COMPANY_FEEDS=true
ATS_SYNC_INTERVAL_SECONDS=3600
ATS_SYNC_HTTP_BUDGET=100
ATS_SYNC_ROW_BUDGET=2000
MAX_ACTIVE_JOBS=15000
FEED_CONSECUTIVE_MISS_THRESHOLD=10
COMPACTION_INTERVAL_HOURS=24
```

Bounded JobTech top-up defaults:

```text
JOBTECH_TOPUP_LIMIT=100
JOBTECH_TOPUP_INTERVAL_CYCLES=6
JOBTECH_TOPUP_SINCE_DAYS=21
JOBTECH_TOPUP_MAX_AGE_DAYS=21
JOBTECH_TOPUP_NO_DEADLINE_TTL_DAYS=30
```

Rules:

- Keep the JobTech top-up all-Sweden and IT-targeted, with junior and general lanes.
- Keep window and offset bounds.
- Do not replace the top-up with stream polling or a snapshot.
- Do not run a one-off “temporary” full ingest in production.
- A feed returning no useful target rows repeatedly can be auto-disabled after 10 consecutive misses.
- Auto-disabled feeds are not the same as a crashed worker. Inspect actual failure count separately.
- Clear auto-disable state only after verifying the provider endpoint and location filtering.
- Keep all HTTP and row budgets on new adapters.

## 8. Source URL and relevance invariants

- Direct ATS-feed jobs must retain their employer ATS/application URL.
- JobTech jobs should prefer `application_details.url`/`apply_url`; `webpage_url` is fallback only.
- Never rewrite direct ATS URLs to Platsbanken.
- Preserve source provenance, canonical company identity, active status, payload hash, classification, and ranking fields.
- Deduplicate direct ATS rows by source URL.
- Do not blanket-exclude `design`, `automation`, `systems`, or `defense`.
- Title exclusions must be precise. Ambiguous automation/SCADA/systems roles require software evidence.
- Preserve embedded software, software engineering, data, cloud, and genuinely relevant early-career roles.
- Classifier changes require rejected and preserved regression fixtures.
- After classifier changes, reclassify active rows and report actual before/after lens counts, especially Graduate.

## 9. Azure worker constraints and known failure modes

Current hosting facts:

- Linux custom container on Azure App Service.
- B1 Basic plan, capacity 1.
- `alwaysOn=true`.
- Health path is `/health`.
- The worker listens on `0.0.0.0:$WEBSITES_PORT`, with port 8000 as the code fallback.
- Only `/` and `/health` return worker health.

Operational implications:

- A single B1 instance has no application-level redundancy. Deploys, restarts, or an unhealthy instance can interrupt processing.
- Azure Health Check does not make a single instance highly available. Microsoft documents that a continuously unhealthy single instance can take an hour before replacement.
- A green `/health` proves only that the process and HTTP thread are alive. It does not prove feeds are succeeding or data is fresh.
- Always verify `worker:last_success_at`, feed failure state, top-up state, and recent rows in addition to HTTP 200.
- App Service assumes port 80 unless `WEBSITES_PORT` is configured for a different port. Do not remove or mismatch this setting.
- Keep the image small enough to pull and start within the configured startup window.
- The health server starts before the worker loop. A later configuration failure can still terminate the container.
- `WORKER_MODE=ats_only` with `ENABLE_COMPANY_FEEDS=false` intentionally fails startup.
- Per-feed failures should be contained; do not make one provider exception terminate the entire cycle.
- Do not use the container filesystem as the system of record. State belongs in Supabase.
- Files outside `/home` are not durable across restarts. The pipeline must not depend on local checkpoints.
- Do not casually rotate/remove ACR credentials, Azure OIDC secrets, app settings, resource names, health settings, or registry access.
- Microsoft recommends managed identity for ACR pulls. Migrating the existing credential setup is a separate infrastructure change, not an opportunistic cleanup.

Official references:

- [Azure custom-container configuration, ports, registry access, and storage](https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container?pivots=container-linux)
- [Azure App Service Health Check behavior and limitations](https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check)

## 10. Azure deployment checklist

For any worker/pipeline change:

1. Run Python tests locally.
2. Run relevant bounded dry-runs.
3. Commit and merge the pipeline change to `main`.
4. Manually start the Azure workflow named above.
5. Wait for test, build, and deploy jobs to succeed.
6. Confirm the Web App is running the expected commit SHA image, not merely `latest`.
7. Confirm `/health` returns HTTP 200.
8. Confirm `worker:last_success_at` advances.
9. Inspect feed failure and auto-disabled counts.
10. If normalization/classification changed, run the bounded re-ingest or reclassification required by that change.
11. Run `launch-gate` and `db-audit`.
12. Report before/after counts and any remaining failures.

Do not redeploy the worker for a frontend-only change.

## 11. Supabase schema and security constraints

- All user-owned tables and resume objects require Row Level Security.
- Browser/frontend/extension code uses only the public publishable/anon key.
- Service-role access is worker/server/Edge-Function only.
- Never log, paste, commit, or display app-setting values or tokens.
- Keep `.env` ignored. Update `.env.example` with placeholders only.
- Migrations are append-only history. Do not delete “old” migration files because they appear unused.
- Add a new migration for schema changes; do not edit already-applied migrations unless the task is explicitly a migration repair.
- Regenerate `src/integrations/supabase/types.ts` when the schema changes.
- Review grants and RLS policies whenever adding a table, function, bucket, or RPC.
- A public jobs read policy is intentional; user-specific data must remain scoped to `auth.uid()`.

## 12. Resume storage constraints

- Bucket: `resume-files`
- Bucket is private.
- PDF only.
- Maximum file size: 3 MB.
- Maximum saved resumes: 10 per user, enforced in both application code and the database.
- Storage path is user-scoped.
- Deleting a resume should remove both its Storage object and metadata row.
- Applications may preserve a resume label/reference history; do not break those references during cleanup.
- Orphan resume objects have a bounded cleanup function. Do not run broad bucket deletes.

At the absolute application maximum, one user could consume roughly 30 MB before overhead. The platform-wide Storage quota is only 1 GB, so user growth must be monitored even though the per-user limit is enforced.

## 13. Verification matrix

| Change type | Minimum verification |
| --- | --- |
| Frontend | `npm run test`, `npm run build`, relevant UI checks |
| TypeScript logic | Targeted tests plus full frontend tests/build |
| Pipeline Python | `python -m unittest discover -s tests -v` |
| Relevance/classifier | Regression fixtures, reclassification, launch gate |
| Database migration | Local review, linked migration status, RLS/grant review, generated types |
| Edge Function | Function-specific test and explicit function deployment |
| Extension | `npm run build:extension`, inspect generated ZIP only for a release |
| Storage cleanup | Dry-run, bounded confirm, DB audit afterward |

The launch-gate defaults are:

- top-20 relevant: at least 85%
- top-50 early career: at least 40%
- top-20 consultancy share: at most 25%
- 200-row noise sample: at most 5%

## 14. Git and workspace hygiene

- Run `git status --short` before editing and before staging.
- Assume unknown dirty files belong to the user.
- Stage explicit paths; never use `git add .` in a dirty workspace.
- Do not revert, overwrite, clean, or delete unrelated local changes.
- Do not commit `.zip` files unless producing an intentional extension release.
- `extension/swejobs-capture.zip` is the current extension distributable when regenerated; its presence does not mean the source extension is obsolete.
- Source files under `extension/` are authoritative. A ZIP is a generated release artifact.
- Do not commit caches, local harness/session data, generated reports with production content, `.env`, or editor state.
- Keep unrelated batches in separate commits/PRs.
- Never use destructive Git commands to resolve an ordinary dirty worktree.

## 15. Incident playbooks

### Database approaching 500 MB

1. Stop optional/manual ingestion.
2. Run `state`, `db-audit`, and compaction dry-run.
3. Identify whether growth is jobs/raw JSON, events, digests, email logs, resumes, or indexes.
4. Run bounded compaction with confirmation.
5. Purge only old inactive unreferenced jobs.
6. Re-audit.
7. Vacuum only with an understood plan.
8. If the database cannot remain below the warning threshold, upgrade or redesign retention before resuming growth.

### Worker health is green but jobs are stale

1. Check `worker:last_success_at`.
2. Check actual feed failure count and failed feed keys.
3. Check auto-disabled feeds separately.
4. Check active-job budget.
5. Check JobTech top-up cycle and last-run timestamp.
6. Inspect Azure logs for startup/config/network errors.
7. Confirm the deployed image SHA.

### Worker deployment fails

1. Identify whether test, registry build/push, Azure login, or Web App deployment failed.
2. Do not repeatedly redeploy unchanged code.
3. Confirm ACR credentials/OIDC secrets by name without printing values.
4. Confirm image SHA exists in ACR.
5. Confirm `WEBSITES_PORT`, health path, worker mode, and required app settings.
6. Roll forward with a tested fix. Do not replace production mode with legacy polling to make the container appear busy.

### Relevance regression

1. Capture exact rejected and preserved examples.
2. Add fixtures before changing broad rules.
3. Prefer precise title/evidence rules over domain-wide exclusions.
4. Run targeted tests and the full Python suite.
5. Reclassify.
6. Run launch gate and compare lens counts before/after.

## 16. Current-state snapshot

Verified on 22 June 2026:

- 295 total jobs: 270 active and 25 inactive.
- 14,294 job events.
- 366 weekly digests.
- 310 email logs.
- Last worker success was current and the worker was cycling normally.
- Ten feeds were auto-disabled and the last cycle had zero actual feed failures; do not conflate these values.
- The frontend repository head and deployed worker image may legitimately differ after frontend-only commits.

This snapshot will become stale. Re-run `state` and `db-audit`; never use these numbers as a substitute for a current production check.
