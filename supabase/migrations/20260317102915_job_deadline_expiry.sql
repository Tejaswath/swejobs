-- ============================================================
-- CANONICAL APPLICATION DEADLINE DATE
-- ============================================================
--
-- Jobs currently store application_deadline as free-form text. The backend
-- needs a typed date column so overdue jobs can be deactivated reliably and
-- efficiently without depending on provider-specific string formats.

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS application_deadline_date DATE;

UPDATE public.jobs
SET application_deadline_date = substring(application_deadline from '^[0-9]{4}-[0-9]{2}-[0-9]{2}')::date
WHERE application_deadline IS NOT NULL
  AND substring(application_deadline from '^[0-9]{4}-[0-9]{2}-[0-9]{2}') IS NOT NULL
  AND (
    application_deadline_date IS NULL
    OR application_deadline_date <> substring(application_deadline from '^[0-9]{4}-[0-9]{2}-[0-9]{2}')::date
  );

CREATE INDEX IF NOT EXISTS idx_jobs_active_deadline_date
  ON public.jobs(is_active, application_deadline_date);
