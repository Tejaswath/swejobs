# SweJobs Relevance Contract

This document is the canonical behavioral contract for Explore lenses, alerts,
and user-facing recommendation order.

## Target User

The default target user is an early-career software engineer who can work in
English, prefers Stockholm or remote roles, and does not meet Swedish-language,
citizenship, or security-clearance requirements.

## Eligibility

Eligibility is deterministic and must agree in TypeScript, Python, and SQL.

High Signal and Graduate / Trainee reject a job when any of these are true:

- the job is inactive or classified as noise;
- Swedish is explicitly required;
- citizenship, an existing work permit without sponsorship, or security
  clearance is explicitly required;
- the headline has a senior signal, including `senior`, `lead`, `principal`,
  `staff`, `architect`, `manager`, `experienced`, `expert`, `seasoned`,
  `erfaren`, `flerarig`, or `gedigen erfarenhet`;
- the classified career stage is senior, lead, staff, or principal;
- the minimum required experience is 3 years or more;
- reason codes contain `career_stage_senior` or `years_required_3plus`.

Broad Discovery remains wider on seniority but still hides explicit Swedish,
citizenship, and clearance restrictions for the default target user.

High Signal additionally requires a target role, relevance score of at least
30, and either an eligible verified/trusted direct feed or an explicitly
enabled JobTech source.

Graduate / Trainee additionally requires a relevance score of at least 15 and
a confirmed graduate program, graduate/trainee/junior stage, or at most one
year of required experience.

Consultancies are not hard-ineligible. They are hidden by a default-on user
toggle.

## Ranking

Eligibility runs before ranking. Suitability is user-specific and must not use
raw `relevance_score` as its base because that score contains company-tier and
watch-list preferences.

Suitability combines:

- resume/skill match, when available;
- career-stage fit;
- role relevance and classifier confidence;
- source quality;
- freshness and useful deadlines;
- capped company preference;
- bounded feedback preferences.

Resume match is never a hard gate. Without a parsed resume, the other
components produce a useful fallback order. Company preference is a tiebreaker,
not the dominant signal.

Recommendation labels:

- `Strong`: score at least 70
- `Possible`: score at least 45
- `Stretch`: score below 45

## Shared Fixtures

`tests/fixtures/eligibility_cases.json` defines the cross-language eligibility
cases. TypeScript and Python tests load the same file. SQL mirrors the same
predicates in `public.job_passes_default_eligibility` and the alert RPC.

`tests/fixtures/ranking_cases.json` defines user-facing ranking invariants.
