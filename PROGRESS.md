# SweJobs — Progress Tracker

Living snapshot of where the work stands. **Read this first every session.**

_Last updated: 2026-06-25 (UX journey revamp)_

## Current branch
`feat/ux-journey-revamp` — honest résumé-gated fit, logged-out landing, résumé unlock, teaching empty states.

## Last activity (most recent first)
- **UX journey revamp (`feat/ux-journey-revamp`)** — one honest fit signal (résumé-gated, Explore only); logged-out landing (How it works + live roles); résumé unlock on Overview/Explore; empty-state copy; deduped fit reasons vs keyword %.
- **Overview matches + JD jump** — Top matches, `/jobs?selected=` deep-link, Read description scroll (prior branch).
- **UX contrast/density** — traffic-light FitIndicator, Explore split placeholder (merged on main).
- **UX clarity** — Overview focal action, FitIndicator, honest Saved Searches copy (merged).

## Gates (last run on feat/ux-journey-revamp)
96 Vitest · lint 0 errors · build OK · 88 pytest · security_check OK.

## Shipped surfaces
- **Chrome extension 1.1.0** — capture, autofill, telemetry (`autofill_events` migration).
- **Apply Assist (SPA)** — Profile autofill, cover letter generator, fill telemetry.
- **Alerts** — worker generates in-app alerts; Overview bell + Saved Searches UI.
- **Personal ranking** — Explore sort uses profile + feedback deltas.
- **UX clarity + contrast** — calm Overview, fit hierarchy, dark contrast polish.
- **Overview top matches** — relevance-ranked picks; deep-link into Explore detail panel.

## In flight / to verify
- [ ] Merge `feat/ux-journey-revamp` PR → Vercel auto-deploy.
- [ ] Manual QA: logged-out landing, no fit without résumé, unlock card, empty states.

## Next steps
1. Merge UX journey revamp PR and manual QA on production.
2. Optional: Phase 5 supply expansion, Phase 6 multi-user hardening (gated).

## Out of scope (this cycle)
First-run walkthrough wizard · email alerts · full JobTech poll.

## Guardrails (never)
Never push to `main` directly · `ats_only` on prod · never raise `MAX_ACTIVE_JOBS` without
capacity review · never edit applied migrations · service-role key never in `src/` or `extension/`.
