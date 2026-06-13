-- Deadline expiry only scans active jobs. Keep the maintenance query small
-- without maintaining an index entry for the much larger inactive population.
CREATE INDEX IF NOT EXISTS idx_jobs_active_deadline_partial
  ON public.jobs(application_deadline_date, id)
  WHERE is_active = true AND application_deadline_date IS NOT NULL;
