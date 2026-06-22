# SweJobs — Progress Tracker

Living snapshot of where the work stands. **Read this first every session.**
Update the *Current state* and *Next steps* sections after each meaningful change
or checkpoint commit — **overwrite** them (this is a snapshot, not a log; the
append-only history lives in `.harness/session-log.md`). Commit `PROGRESS.md`
alongside the work it describes.

_Last updated: 2026-06-23_

## Current branch
`feat/ux-explore-simplify` — 2 commits: `8f269d7` (UX), `09acb98` (supply feeds).

## Last activity (most recent first)
- `09acb98` — **Tranche B:** enabled `voi_teamtailor`, `tibber_teamtailor`, `quinyx_teamtailor`
  + pytest guard.
- `8f269d7` — **Tranche A:** Explore progressive disclosure, Overview consolidation,
  Applications table simplification, Saved Jobs vocabulary/states.

## Gates (last run)
Frontend tests **56 pass** · Python tests **85 pass** · lint **0 errors** · build **green**
· `scripts/security_check.sh` **pass**.

## In flight / to verify
- [ ] Open Phase 1 PR — https://github.com/Tejaswath/swejobs/pull/new/fix/phase1-canonical-ats
- [ ] Open UX PR — push `feat/ux-explore-simplify` and PR against `main` after Phase 1 merges
- [ ] Phase 1 manual ATS checklist
- [ ] Prod dry-run: `python -m pipeline.main sync-company-feeds --only voi_teamtailor,tibber_teamtailor,quinyx_teamtailor --clear-auto-disable`
- [ ] Launch-gate before/after + Azure worker deploy for feed supply

## Next steps
1. Merge Phase 0+1 PR → Vercel frontend deploy.
2. Push + merge UX/supply PR (`feat/ux-explore-simplify`).
3. Deploy worker; dry-run 3 feeds; launch-gate; report High Signal / Graduate counts.

## Out of scope (this cycle)
In-app alerts · email · Realtime — explicitly deferred.

## Guardrails (never)
Never push to `main` directly · `ats_only` on prod · never raise `MAX_ACTIVE_JOBS`
without capacity review · never edit applied migrations · service-role key never in
`src/`. Full contract: `docs/agent_operating_constraints.md`.
