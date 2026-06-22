# SweJobs — Progress Tracker

Living snapshot of where the work stands. **Read this first every session.**
Update the *Current state* and *Next steps* sections after each meaningful change
or checkpoint commit — **overwrite** them (this is a snapshot, not a log; the
append-only history lives in `.harness/session-log.md`). Commit `PROGRESS.md`
alongside the work it describes.

_Last updated: 2026-06-23_

## Current branch
`feat/ux-explore-simplify` — branched from `fix/phase1-canonical-ats`; includes
Tranche A (UX) + Tranche B feed enablement (uncommitted pending checkpoint).

## Last activity (most recent first)
- **In progress** — Tranche A UX: Explore progressive disclosure, Overview
  consolidation, Applications table simplification, Saved Jobs vocabulary/states.
- **In progress** — Tranche B: enabled `voi_teamtailor`, `tibber_teamtailor`,
  `quinyx_teamtailor` in `company_feeds.yaml` + pytest guard.
- `98dfa76` — **Phase 1:** canonical ATS keyword matching (on `fix/phase1-canonical-ats`).
- `f8aeb77` — **Phase 0:** db-audit retention fail-loud.

## Gates (last run)
Frontend tests **56 pass** · Python tests **85 pass** (after feed test) · lint **0 errors**
· build **green** · `scripts/security_check.sh` **pass**.

## In flight / to verify
- [ ] Open Phase 1 PR manually (`gh` unavailable in agent shell) —
      https://github.com/Tejaswath/swejobs/pull/new/fix/phase1-canonical-ats
- [ ] Phase 1 manual ATS checklist (PROGRESS items from prior session)
- [ ] Checkpoint UX + supply commits; open UX PR after Phase 1 merges
- [ ] Prod dry-run: `python -m pipeline.main sync-company-feeds --only voi_teamtailor,tibber_teamtailor,quinyx_teamtailor --clear-auto-disable`
- [ ] Launch-gate before/after after worker deploy

## Next steps
1. Merge Phase 0+1 PR → Vercel frontend deploy.
2. Merge UX PR (`feat/ux-explore-simplify`).
3. Deploy worker with 3 re-enabled feeds; run launch-gate; report High Signal / Graduate counts.

## Out of scope (this cycle)
In-app alerts · email · Realtime — explicitly deferred.

## Guardrails (never)
Never push to `main` directly · `ats_only` on prod · never raise `MAX_ACTIVE_JOBS`
without capacity review · never edit applied migrations · service-role key never in
`src/`. Full contract: `docs/agent_operating_constraints.md`.
