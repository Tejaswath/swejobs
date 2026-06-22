# SweJobs

SweJobs is a curated Swedish technology-job discovery and application-tracking app.

## Architecture

- Vite, React, TypeScript, Tailwind, and shadcn/ui frontend.
- Supabase authentication, Postgres, storage, row-level security, and Edge Functions.
- Python ingestion worker for JobTech and verified company ATS feeds.
- Chrome extension for capturing external job applications.
- Vercel frontend deployment and Azure worker deployment.

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Run frontend verification:

```bash
npm run test
npm run build
npm run lint
```

Build the browser extension:

```bash
npm run build:extension
```

## Pipeline

Create a Python virtual environment and install:

```bash
pip install -r pipeline/requirements.txt
```

Safe local checks:

```bash
python -m pipeline.main state
python -m pipeline.main launch-gate --no-fail
python -m pipeline.main db-audit
python -m unittest discover -s tests -v
```

Production runs with `WORKER_MODE=ats_only`. Do not run continuous JobTech polling or a full
snapshot against production. See [pipeline/README.md](pipeline/README.md) for pipeline commands
and guardrails.

## Security

- `SUPABASE_SERVICE_ROLE_KEY` is worker-only.
- Never expose service-role credentials in frontend or Vercel client variables.
- Keep `.env` files and generated reports out of version control.
- Use `.env.example` as the configuration template.

## Documentation

- [Pipeline operations](pipeline/README.md)
- [Chrome extension](extension/README.md)
- [Relevance contract](docs/relevance_contract.md)
- [V3 runtime operations](docs/v3_relevance_runtime_runbook.md)
