# SweJobs - Current Capability Inventory

Last updated: 2026-03-30 (Europe/Stockholm)

This file documents the current, implemented state of the codebase.

## Scope and source

- Scope: implemented behavior in this repo now.
- Excludes: roadmap ideas not already in code.
- Verified from:
- `src/App.tsx`
- `src/components/AppLayout.tsx`
- `src/pages/*.tsx`
- `src/hooks/useAuth.tsx`
- `extension/*`
- `pipeline/*`
- `pipeline/config/company_feeds.yaml`
- `supabase/migrations/*`
- `supabase/functions/*`
- `.github/workflows/*`

## Product architecture

- Frontend:
- Vite + React + TypeScript SPA.
- Supabase client-side access for app data.
- TanStack Query for fetching/caching.
- shadcn/ui + Tailwind for UI.

- Backend/data:
- Supabase Postgres + RLS.
- Supabase Edge Functions:
- `extract-job-title`
- `send-email`
- `track-pixel`

- Ingestion:
- Python pipeline worker (`pipeline/main.py`, `pipeline/ingest.py`).
- Sources: JobTech stream/snapshot + verified ATS feeds.
- Classification, deadline expiry, compaction, translation cycles.

- Browser extension:
- Manifest V3 extension in `extension/`.
- Captures jobs from job pages to `applications`.
- Optional recruiter capture to `recruiters`.

## Frontend routes and live surfaces

From `src/App.tsx`:

- `/` -> Overview (`Index.tsx`)
- `/auth` -> Auth
- `/jobs` -> Explore
- `/jobs/:id` -> Job detail
- `/tracked` -> Shortlist
- `/applications` -> Applications tracker
- `/profile` -> Profile
- `/resumes` -> Resume Library (mapped to `Profile.tsx`)
- `/outreach` -> Outreach
- `/searches` -> Saved Searches
- `/export` -> Export
- `/skills` -> Skill Gap
- `/admin` -> Admin
- `*` -> Not Found

## Navigation model

From `src/components/AppLayout.tsx`:

- Top nav:
- Overview
- Explore
- Applications
- Outreach

- More menu:
- Saved Jobs (`/tracked`)
- Resume Library
- Skill Gap
- Saved Searches
- Export Data
- Admin (dev-only visibility in nav)

- Footer quick links:
- Explore
- Applications
- Outreach

## Core app capabilities by page

### Overview (`src/pages/Index.tsx`)

- Live role count and "new this week" signal.
- Deadline radar buckets:
- due today
- this week
- later
- Recent activity panel (shortlist + applications).
- Recently captured panel:
- reads latest 5 rows from `applications` where `source='extension'`.
- links to `/applications`.
- Pipeline snapshot chips:
- status counts for `applied`, `oa`, `interviewing`, `offer`, `rejected`
- each chip links to `/applications?status=<stage>`
- Onboarding progress checks:
- resume versions
- user skills
- saved searches
- Followed-company chips and counts ("Following" copy).

### Explore (`src/pages/Jobs.tsx`)

- Lenses:
- `best_matches` (label: "Recommended")
- `all_roles`
- `graduate_trainee`
- Sorting:
- relevance ("Recommended for you")
- ATS desc ("Resume match (highest)")
- deadline ("Deadline soonest")
- newest ("Newest jobs")
- Filters:
- language
- remote only
- hide Swedish-required
- hide citizenship-restricted
- hide 3+ years roles
- hide consultancies
- active filter chips with inline clear actions.
- Search with fallback relaxation logic.
- Watchlist-company boost in ranking.
- company follow vocabulary in UI ("Following"/"Follow").
- ATS badge label in cards: `Match {score}%`.
- Deadline focus via query params (`today`, `week`, `upcoming`).
- Inline job details and shortlist/application actions.
- Translation display support (`headline_en` for Swedish rows when available).
- Dismissible extension tip banner with persisted key `swejobs.explore.tip-dismissed`.

### Job detail (`src/pages/JobDetail.tsx`)

- Full job view from `jobs`.
- Track status integration with `tracked_jobs`.

### Shortlist (`src/pages/TrackedJobs.tsx`)

- Discovery queue statuses:
- shortlisted (`saved`)
- passed (`ignored`)
- Pipeline statuses visible in shortlist:
- applied / OA / interviewing / offer / rejected / withdrawn
- Bulk select + delete.
- Direct handoff to Applications view.

### Applications (`src/pages/Applications.tsx`)

- Full application tracker with statuses and timeline.
- Add/edit/delete application rows.
- Resume association per application.
- ATS scanning from:
- linked SweJobs job tags
- `ats_job_description` text fallback
- URL match heuristics for job linkage.
- CSV import/export style operations.
- Header action hierarchy:
- Export CSV = ghost button
- Import from Shortlist = outline button
- New Application = primary button
- Status metrics and sorting/filtering.
- URL status handoff: `?status=<application_status>` preselects status filter.
- Applied staleness hint: shows follow-up nudge for `applied` items at 14+ days.
- Extension-origin records supported via `source='extension'`.

### Resume Library (`src/pages/Profile.tsx`)

- Upload PDF resumes to storage.
- Per-user resume cap (`MAX_RESUMES_PER_USER`).
- Default resume management.
- Resume edit/delete/download.
- Archive candidate cleanup based on recency.

### Outreach (`src/pages/Outreach.tsx`)

- Tabs:
- Recruiters
- Templates
- Compose
- Send History
- Settings

- Recruiters:
- CRUD
- search
- CSV import

- Templates:
- CRUD
- placeholder support: `{{name}}`, `{{firstName}}`, `{{company}}`, `{{title}}`
- starter templates panel (English-only set)

- Compose:
- select recruiters from saved list (no direct recipient typing)
- manual or template-based drafts
- copy subject/body
- optional in-app SMTP send (feature-flagged)

- Send history:
- reads `email_logs`
- status badges
- "Tracked opens" header with undercount tooltip
- open count and first-open timestamp

- Settings:
- Gmail address + app password storage in `email_config`

- Feature flag:
- `VITE_OUTREACH_SMTP_ENABLED=true` enables send/history/settings functionality.

### Saved Searches (`src/pages/SavedSearches.tsx`)

- Create/update/delete saved search criteria.
- Search options:
- keyword list
- remote only
- english only
- Match-count query for newly matched jobs.

### Skill Gap (`src/pages/SkillGap.tsx`)

- User skill CRUD (`user_skills`).
- Market skill extraction from active target jobs + `job_tags`.
- Breakdown:
- strong skills
- missing skills
- learn-next suggestions

### Export (`src/pages/Export.tsx`)

- Personal export only (current user):
- shortlist (`tracked_jobs`)
- applications
- Date range filter (30d / 90d / all).
- CSV downloads.

### Admin (`src/pages/Admin.tsx`)

- Poll freshness + ATS sync freshness.
- Connected/planned company coverage view from registry.
- Calls `system_resource_alerts` RPC for storage/egress guardrails.
- Coverage gap table for inactive/missing tracked companies.

### Auth (`src/pages/Auth.tsx`, `src/hooks/useAuth.tsx`)

- Email/password sign in and sign up.
- Google OAuth sign in (gated by `VITE_GOOGLE_AUTH_ENABLED`).
- Password reset flow.
- Session persistence and refresh via Supabase client auth.

## Outreach email and tracking backend

### Edge function: `send-email`

Path: `supabase/functions/send-email/index.ts`

- Requires `Authorization: Bearer <token>` and validates user.
- Checks `OUTREACH_SMTP_ENABLED`.
- Reads recruiter + email config for the signed-in user.
- Inserts `email_logs` row as `pending`.
- Sends via Gmail SMTP over TLS using stored app password.
- On success:
- updates `email_logs.status='sent'`
- sets `sent_at`
- On failure:
- updates `email_logs.status='failed'`
- stores `error_message`
- Injects tracking pixel URL in HTML body.

### Edge function: `track-pixel`

Path: `supabase/functions/track-pixel/index.ts`

- Returns 1x1 PNG (`image/png`) always.
- If `id` query param exists:
- calls RPC `increment_email_open(log_id)` using service role.
- Intended to be deployed with `--no-verify-jwt`.

### DB objects for outreach

Migration: `20260329223000_outreach_email_and_ats_description.sql`

- Adds `applications.ats_job_description`.
- Creates `email_config` with per-user RLS.
- Creates `email_logs` with per-user RLS.
- Adds indexes for email log reads/open lookups.
- Adds `increment_email_open(UUID)` security definer RPC.

## Chrome extension capabilities

Extension root: `extension/`

### Auth and session

- Sign-in methods in popup:
- Google OAuth (`chrome.identity` flow)
- email/password fallback
- Session stored in `chrome.storage.local`.
- Background alarm refresh every 45 minutes.

### Capture behavior

- Autofill extracts:
- company hint
- role title
- job URL
- JD text (`ats_job_description`)
- recruiter hint

- Provider-specific extractors:
- Greenhouse API
- Lever API
- Ashby selectors
- Eightfold selectors
- Workday selectors
- Teamtailor selectors
- LinkedIn selectors
- JSON-LD JobPosting parsing
- generic DOM fallback

- SPA retry:
- if first extraction is weak, retries after 1.5s.

- Apply-page warning:
- warns for `/apply` or `/application` URLs.

### Recruiter capture

- Detects recruiter/contact from page content.
- If name missing but email found:
- label shown as "Potential contact email found"
- infers contact name from email local-part.
- infers company from email domain if company missing.
- "Save to Outreach" writes to `recruiters`.

### Application save contract

- Inserts into `applications`:
- `source='extension'`
- `ats_job_description`
- `request_id` UUID
- manual notes in `notes`

### UX and controls

- Hidden advanced config panel with gear toggle.
- Default embedded Supabase URL and publishable key in `extension/src/constants.js`.
- Keyboard shortcuts:
- `Cmd/Ctrl + Enter` -> save
- `Cmd/Ctrl + Shift + A` -> autofill

## Pipeline capabilities

Primary files: `pipeline/main.py`, `pipeline/ingest.py`, `pipeline/translate.py`

### CLI commands currently wired

- `snapshot`
- `reclassify`
- `poll-once`
- `poll`
- `smoke`
- `sync-taxonomy`
- `sync-company-feeds`
- `verify-company-sources`
- `validate-usefulness`
- `launch-gate`
- `precision-review`
- `cleanup-demo`
- `compact-storage`
- `expire-deadlines`
- `state`

### Core worker functions

- JobTech stream/snapshot ingestion.
- Taxonomy sync and normalization.
- Classification/scoring and role-family assignment.
- Company ATS feed sync on intervals.
- Deadline expiry deactivation.
- Storage compaction windows.
- Optional translation batch cycles.

### Translation support

- Translation columns in jobs:
- `headline_en`
- `description_en`
- Provider modes supported:
- `google_cloud` (API key)
- `google_free` (web endpoint)
- Non-fatal behavior:
- failed translations are skipped and retried in future cycles.

### Company feed config status

File: `pipeline/config/company_feeds.yaml`

- Total feeds configured: 35
- Enabled feeds: 22
- Providers configured:
- Greenhouse
- Lever
- Teamtailor

- Enabled feed keys:
- `avanza_teamtailor`
- `electronic_arts_greenhouse`
- `epidemic_sound_greenhouse`
- `fortnox_teamtailor`
- `hemnet_teamtailor`
- `hiq_teamtailor`
- `kambi_greenhouse`
- `king_greenhouse`
- `klarna_greenhouse`
- `knowit_teamtailor`
- `nexer_teamtailor`
- `nordnet_teamtailor`
- `platform24_teamtailor`
- `pleo_greenhouse`
- `qliro_teamtailor`
- `raysearch_teamtailor`
- `schibsted_greenhouse`
- `spotify_lever`
- `storytel_teamtailor`
- `tink_greenhouse`
- `wolt_greenhouse`
- `zalando_greenhouse`

- Additional candidate feeds are present but disabled until endpoint validation passes.

## Schema and migrations snapshot

Current migration files in `supabase/migrations` end at:

- `20260329223000_outreach_email_and_ats_description.sql`

Recent feature migrations include:

- `20260328183000_application_ats_fields.sql`
- `20260329103000_application_status_history.sql`
- `20260329113000_weekly_digests_json_gin.sql`
- `20260329204500_job_translation_fields.sql`
- `20260329223000_outreach_email_and_ats_description.sql`

## Feature flags and runtime config

### Frontend env vars

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_GOOGLE_AUTH_ENABLED`
- `VITE_OUTREACH_SMTP_ENABLED`

### Pipeline env vars (selected)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JOBTECH_API_KEY`
- `ENABLE_COMPANY_FEEDS`
- `COMPANY_FEED_CONFIG_PATH`
- `FEED_INTERVAL_POLLS`
- `ENABLE_TRANSLATION`
- `TRANSLATION_PROVIDER`
- `TRANSLATION_API_KEY`
- `TRANSLATION_API_URL`
- `TRANSLATION_INTERVAL_POLLS`
- `TRANSLATION_BATCH_SIZE`

### Edge function secrets (selected)

- `OUTREACH_SMTP_ENABLED`
- `SUPABASE_ANON_KEY` (for auth validation inside `send-email`)
- `SUPABASE_SERVICE_ROLE_KEY`

### Extension config

- Defaults baked into `extension/src/constants.js`.
- Advanced override saved in local extension storage.

## CI/CD and operations

### Workflows

- `.github/workflows/pipeline-worker.yml`
- Pipeline lint/smoke + Docker build checks.

- `.github/workflows/azure-worker-deploy.yml`
- Builds/pushes worker image to ACR.
- Deploys to Azure Web App `swejobs-worker-tejas-sec`.

### Web app deployment

- Vercel deployment for SPA.
- Production behavior depends on Vercel env vars (not local `.env`).

### Supabase operations

- Migrations via `supabase db push --linked --yes`.
- Function deploys via `supabase functions deploy ...`.

## Test/build commands used in this repo

- Frontend build: `npm run build`
- Frontend tests: `npm run test`
- Extension build: `npm run build:extension`
- Pipeline tests: `.venv/bin/python -m pytest -q`

## Current known constraints (by design)

- Outreach recipients are selected from saved recruiters; compose does not accept direct ad-hoc recipient typing.
- Gmail SMTP mode requires each user to supply their own Gmail app password in Outreach Settings.
- Open tracking depends on image loading in recipient clients; open counts can be under-reported if images are blocked/proxied.
- Recruiter extraction may return email-only contacts; inferred names are best-effort and should be user-verified.
- Company feed candidates remain disabled until endpoint verification confirms slug/provider validity.

## Local-only note

- `PROJECT.md` is intentionally local documentation and should not be committed.
- `.gitignore` already includes:
- `PROJECT.md`
- `project.md`
- `*.md`
- `**/*.md`
