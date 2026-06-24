# SweJobs — Progress Tracker

Living snapshot of where the work stands. **Read this first every session.**

_Last updated: 2026-06-24 (Phase 0 anchor)_

## Current branch
`main` @ `f5c4c3f` — PRs #13–#16 merged (extension capture + Apply Assist + profile/cover letter).

## Last activity (most recent first)
- **PR #16** — extension form fill (IIFE bundles), Fill application form on ATS pages.
- **PR #15** — apply-assist profile fields + cover letter template in SPA.
- **PR #14** — extension capture UX, LinkedIn collections fix, auto-capture on popup open.
- **PR #13** — extension capture reliability, canonical job URLs, duplicate detection.
- Agent harness (`AGENTS.md`, checkpoint/preflight scripts, `.harness/`) is **local-only** — never committed; see `.gitignore`.

## Gates (last run on main @ f5c4c3f)
Frontend **80 pass** · Python **86 pass** · lint **0 errors** · build **green** · security_check **pass**
· extension build + verify **pass** (v1.1.0).

## Shipped surfaces
- **Chrome extension 1.1.0** — capture, recruiter hint, Fill application form (local rebuild + reload required).
- **Apply Assist (SPA)** — Profile autofill fields, cover letter generator in Applications.
- **Alerts** — UI ready in Saved Searches / schema; **generation unwired** in worker (Phase 2).

## In flight / to verify
- [ ] **Phase 0 PR** — `chore/phase0-anchor`: PROGRESS refresh, harness gitignore, frontend CI.
- [ ] **Phase 1 PR** — `feat/apply-assist-telemetry`: autofill_events migration, extension telemetry, Teamtailor/Workday heuristics.
- [ ] Deploy `autofill_events` migration to Supabase before/with Phase 1 Vercel merge.
- [ ] After extension PR merge: `npm run build:extension` + reload unpacked extension.

## Next steps
1. Merge Phase 0 + Phase 1 PRs via GitHub (never push to `main` directly).
2. Apply Supabase migration for `autofill_events`.
3. Rebuild + reload Chrome extension; smoke-test Fill on Teamtailor/Workday/Greenhouse pages.

## Out of scope (this cycle)
Email alerts · Realtime · full JobTech poll.

## Guardrails (never)
Never push to `main` directly · `ats_only` on prod · never raise `MAX_ACTIVE_JOBS` without
capacity review · never edit applied migrations · service-role key never in `src/` or `extension/`.
