# SweJobs (Lovable Export -> Independent Project)

This repository contains the exported frontend shell and Supabase schema for SweJobs, plus a local-first ingestion worker.

## What is implemented now

- Vite + React + TypeScript frontend.
- Supabase migrations for core tables.
- New usefulness migration for classified ingestion fields.
- Python pipeline scaffold for:
  - JobTech snapshot ingestion
  - stream polling
  - taxonomy caching
  - classification (`role_family`, `relevance_score`, `reason_codes`, `is_target_role`, `is_noise`)
  - weekly digest generation
  - usefulness validation sample check

## Security rules

- `SUPABASE_SERVICE_ROLE_KEY` is worker-only.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code or Vercel client env.
- Frontend client env:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `VITE_SUPABASE_PROJECT_ID`

## Repository hygiene

- `.env` is ignored.
- Use `.env.example` as the template.

## Supabase migrations

Apply in order:

1. `supabase/migrations/20260308120245_dae486ce-09f0-44a1-971c-4797a3184c36.sql`
2. `supabase/migrations/20260308131035_21d4209f-4787-4316-9be4-4b7a8acd1644.sql`
3. `supabase/migrations/20260309100000_1f7e_usefulness_fields.sql`

## Pipeline quickstart

1. Create and activate a Python 3.11 virtualenv.
2. `pip install -r pipeline/requirements.txt`
3. Fill `.env` from `.env.example`.
4. Run one-row live smoke test:
   - `python -m pipeline.main smoke`
5. Run snapshot:
   - `python -m pipeline.main snapshot`
6. Run one stream poll:
   - `python -m pipeline.main poll-once`
7. Validate usefulness:
   - `python -m pipeline.main validate-usefulness --sample-size 50`
8. Generate digest:
   - `python -m pipeline.main digest`

## Azure Web App worker

- Build container: `docker build -f pipeline/Dockerfile -t swejobs-pipeline .`
- Run container locally: `docker run --env-file .env -p 8000:8000 swejobs-pipeline`
- Health endpoint: `GET /health`

## Demo data cleanup (Phase 4.5)

- SQL template: `pipeline/demo_cleanup.sql`
- Worker command (destructive):
  - `python -m pipeline.main cleanup-demo --confirm`

Only run cleanup after live ingestion has been verified.
