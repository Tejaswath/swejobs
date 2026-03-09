-- Phase 4.5 cleanup: remove scaffold/demo rows before production usage.
-- Run only after validating live ingestion and with backups in place.

BEGIN;

DELETE FROM public.job_tags;
DELETE FROM public.job_events;
DELETE FROM public.weekly_digests;
DELETE FROM public.jobs;
DELETE FROM public.ingestion_state;

COMMIT;
