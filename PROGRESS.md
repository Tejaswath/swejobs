# SweJobs — Progress Tracker

Living snapshot of where the work stands. **Read this first every session.**

_Last updated: 2026-06-25 (overview top matches + selected deep-link)_

## Current branch
`feat/overview-matches-jd-selected` — Overview Top matches, `?selected=` Explore deep-link, Read description jump, relative fit spread.

## Last activity (most recent first)
- **Overview matches + JD jump (`feat/overview-matches-jd-selected`)** — Top matches card on Overview, `/jobs?selected=` opens rich Explore panel, Read description scroll, relative fit meters in For You.
- **UX contrast/density** — traffic-light FitIndicator, Explore split placeholder, dark contrast bump (merged on main).
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
- **Overview top matches** — high-signal picks with fit meters; deep-link into Explore detail panel.

## In flight / to verify
- [ ] Merge `feat/overview-matches-jd-selected` PR → Vercel auto-deploy.
- [ ] Manual QA: Top matches → Explore panel, Read description jump, fit meter spread, filter-while-open.

## Next steps
1. Merge overview matches PR and manual QA on production.
2. Optional: Phase 5 supply expansion, Phase 6 multi-user hardening (gated).

## Out of scope (this cycle)
First-run walkthrough wizard · email alerts · full JobTech poll.

## Guardrails (never)
Never push to `main` directly · `ats_only` on prod · never raise `MAX_ACTIVE_JOBS` without
capacity review · never edit applied migrations · service-role key never in `src/` or `extension/`.
