# V3 Relevance Runtime Runbook

This runbook applies to the V3 runtime spec implemented in code.

## 1) Apply DB migration manually
Run the SQL from:

- `supabase/migrations/20260531160000_relevance_v3_runtime.sql`

Because Supabase CLI is not required for this workflow, paste/run this migration in the Supabase SQL editor.

## 2) Seed DB feed registry from YAML
```bash
.venv/bin/python -m pipeline.main sync-feed-registry-from-yaml
```

Optional single-feed seed:
```bash
.venv/bin/python -m pipeline.main sync-feed-registry-from-yaml --only spotify_lever
```

## 3) Run company feed sync (writes `jobs.source_feed_key` + probe runs)
```bash
.venv/bin/python -m pipeline.main sync-company-feeds --max-rows 40 --max-http 3
```

## 4) Refresh quality bands from probe history
Dry-run report:
```bash
.venv/bin/python -m pipeline.main refresh-feed-quality --lookback-days 14 --min-runs 4
```

Apply:
```bash
.venv/bin/python -m pipeline.main refresh-feed-quality --lookback-days 14 --min-runs 4 --apply
```

## 5) Promote eligible feeds for High Signal
Report only:
```bash
.venv/bin/python -m pipeline.main promote-company-feeds --mode report
```

Apply:
```bash
.venv/bin/python -m pipeline.main promote-company-feeds --mode apply
```

## 6) Alert generation checks
Manual dry trigger for daily:
```bash
.venv/bin/python -m pipeline.main send-alerts --frequency daily
```

Manual dry trigger for weekly:
```bash
.venv/bin/python -m pipeline.main send-alerts --frequency weekly
```

Note: production scheduling is DB-side via `pg_cron` in migration.

## 7) User ranking refresh from feedback events
Report only:
```bash
.venv/bin/python -m pipeline.main recalculate-user-ranking --lookback-days 90
```

Apply:
```bash
.venv/bin/python -m pipeline.main recalculate-user-ranking --lookback-days 90 --apply
```

## 8) Precision loop
Export sample for human labels:
```bash
.venv/bin/python -m pipeline.main evaluate-precision --mode export --lens high_signal --top-n 100 --output-csv pipeline/reports/precision_labels_sample.csv
```

Ingest labeled CSV:
```bash
.venv/bin/python -m pipeline.main evaluate-precision --mode ingest-labels --input-csv pipeline/reports/precision_labels_sample.csv --reviewer-key manual-reviewer
```

Generate metrics report:
```bash
.venv/bin/python -m pipeline.main evaluate-precision --mode report --lens high_signal
```
