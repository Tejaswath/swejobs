# SweJobs Pipeline

This worker ingests JobTech data into Supabase with a usefulness layer.

## Security

- `SUPABASE_SERVICE_ROLE_KEY` is used only by this worker.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code or client-side env vars.

## Setup

1. Create a virtual environment.
2. Install dependencies:
   - `pip install -r pipeline/requirements.txt`
3. Copy `.env.example` to `.env` and fill pipeline variables.

## Commands

- One-row smoke test:
  - `python -m pipeline.main smoke`
- Snapshot ingest:
  - `python -m pipeline.main snapshot`
- Poll stream once:
  - `python -m pipeline.main poll-once`
- Continuous polling:
  - `python -m pipeline.main poll`
- Sync taxonomy cache:
  - `python -m pipeline.main sync-taxonomy`
- Generate digest:
  - `python -m pipeline.main digest`
- Validate usefulness thresholds:
  - `python -m pipeline.main validate-usefulness --sample-size 50`
- Print ingestion state:
  - `python -m pipeline.main state`

## Reliability Guarantees

- Exponential backoff with jitter for network failures.
- Checkpoints update only after successful persistence.
- Idempotent upserts by `jobs.id`.
- Duplicate-safe stream reprocessing through deterministic payload hashing.

## Azure Web App

Build and run container:

- `docker build -f pipeline/Dockerfile -t swejobs-pipeline .`
- `docker run --env-file .env -p 8000:8000 swejobs-pipeline`

Health endpoint:

- `GET /health`
