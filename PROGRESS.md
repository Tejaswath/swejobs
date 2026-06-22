# SweJobs — Progress Tracker

Living snapshot of where the work stands. **Read this first every session.**

_Last updated: 2026-06-23 (Phase 4 branch)_

## Current branch
`feat/phase4-explore-overview-fixes` @ `8d218dd` + Phase 4 WIP — PR pending.

## Last activity (most recent first)
- **Phase 4 (single PR)** — applied-state sync (Applications as source of truth),
  job description HTML decode + section highlighting, minimal Overview (action bar +
  3 recent items). Green gate: **58 Vitest · 85 pytest · lint · build · security**.
- **Local feed sync run** — `sync-company-feeds` for voi/tibber/quinyx against prod DB:
  Voi +1 target row persisted; Tibber/Quinyx 0 matching rows (feeds healthy, no SWE listings now).
  Launch-gate before/after: **passes** (100% / 40% / 5% / 0% noise — unchanged).
- `d6e8f96` — merge PR #9 UX + supply feeds.
- `e019c54` — merge PR #8 Phase 1 canonical ATS.

## Gates (last run on Phase 4 branch)
Frontend **58 pass** · Python **85 pass** · lint **0 errors** · build **green** · security_check **pass**
· launch-gate **pass** (before + after feed sync).

## In flight / to verify
- [ ] **Phase 4 PR** — merge to `main` (auto-deploys frontend to Vercel).
- [ ] **Azure worker deploy** — merge does *not* deploy the pipeline; run the manual workflow
      `Build and deploy container app to Azure Web App - swejobs-worker-tejas-sec` on `main`
      so recurring `ats_only` cycles pick up the 3 re-enabled feeds in `company_feeds.yaml`.
- [ ] Phase 1 manual ATS checklist in browser (optional sanity check on live Vercel).
- [ ] After next worker cycle: spot-check High Signal count on Overview.

## Next steps
1. Trigger Azure worker deploy from GitHub Actions (see above).
2. Wait one ATS cycle (~interval in worker settings); confirm feeds run in worker logs.
3. Optional: `python -m pipeline.main launch-gate` weekly after supply changes.

## Out of scope (this cycle)
In-app alerts · email · Realtime.

## Guardrails (never)
Never push to `main` directly · `ats_only` on prod · never raise `MAX_ACTIVE_JOBS` without
capacity review · never edit applied migrations · service-role key never in `src/`.
