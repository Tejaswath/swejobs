# SweJobs — Progress Tracker

Living snapshot of where the work stands. **Read this first every session.**

_Last updated: 2026-06-25 (UX contrast/density polish)_

## Current branch
`main` @ `e107439` (+ clarity #23) — Phases 0–4 shipped (PRs #17–#22).

## Last activity (most recent first)
- **UX clarity (`feat/ux-clarity`)** — Overview "Today" screen (hide-zero strip, value prop, focal action), Explore `FitIndicator` + tuned fit thresholds, Saved Searches honest matching/alerts copy, Applications hide-zero stats.
- **PR #22** — personal Explore ranking from profile + feedback.
- **PR #21** — application funnel signals + follow-up nudges on Overview.
- **PR #20** — cadence-gated in-app alert loop in ATS worker (+ Azure deploy required).
- **PR #19** — Apply Assist telemetry, Teamtailor/Workday heuristics, cover letter flow.
- Agent harness (`AGENTS.md`, checkpoint/preflight scripts, `.harness/`) is **local-only** — never committed.

## Gates (last run on feat/ux-clarity)
Run green gate before merge: Vitest · lint · build · pytest · security_check.

## Shipped surfaces
- **Chrome extension 1.1.0** — capture, autofill, telemetry (`autofill_events` migration).
- **Apply Assist (SPA)** — Profile autofill, cover letter generator, fill telemetry.
- **Alerts** — worker generates in-app alerts; Overview bell + Saved Searches UI.
- **Personal ranking** — Explore sort uses profile + feedback deltas.
- **UX clarity** — calm Overview, fit hierarchy on Explore, honest Saved Searches labels.

## In flight / to verify
- [x] Merge `feat/ux-clarity` PR #23 → Vercel auto-deploy.
- [ ] Merge `feat/ux-contrast-density` PR → Vercel auto-deploy.
- [ ] Manual QA: Explore split placeholder + fit legend, contrast on dark theme.

## Next steps
1. Merge UX clarity PR.
2. Optional: Phase 5 supply expansion, Phase 6 multi-user hardening (gated).

## Out of scope (this cycle)
First-run walkthrough wizard · email alerts · full JobTech poll.

## Guardrails (never)
Never push to `main` directly · `ats_only` on prod · never raise `MAX_ACTIVE_JOBS` without
capacity review · never edit applied migrations · service-role key never in `src/` or `extension/`.
