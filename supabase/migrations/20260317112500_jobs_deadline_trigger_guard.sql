-- ============================================================
-- HARDEN APPLICATION DEADLINE DERIVATION
-- ============================================================
--
-- Some writers may still send application_deadline as an ISO timestamp
-- and omit application_deadline_date. Keep the text column canonical and
-- derive the typed date column inside Postgres so expiry remains correct
-- even if an older worker writes into the database.

CREATE OR REPLACE FUNCTION public.sync_jobs_application_deadline_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_deadline text;
BEGIN
  IF NEW.application_deadline IS NULL OR btrim(NEW.application_deadline) = '' THEN
    NEW.application_deadline := NULL;
    NEW.application_deadline_date := NULL;
    RETURN NEW;
  END IF;

  normalized_deadline := substring(btrim(NEW.application_deadline) from '^[0-9]{4}-[0-9]{2}-[0-9]{2}');

  IF normalized_deadline IS NULL THEN
    NEW.application_deadline_date := NULL;
    RETURN NEW;
  END IF;

  NEW.application_deadline := normalized_deadline;
  NEW.application_deadline_date := normalized_deadline::date;
  RETURN NEW;
END;
$$;

UPDATE public.jobs
SET application_deadline = substring(btrim(application_deadline) from '^[0-9]{4}-[0-9]{2}-[0-9]{2}'),
    application_deadline_date = substring(btrim(application_deadline) from '^[0-9]{4}-[0-9]{2}-[0-9]{2}')::date
WHERE application_deadline IS NOT NULL
  AND substring(btrim(application_deadline) from '^[0-9]{4}-[0-9]{2}-[0-9]{2}') IS NOT NULL
  AND (
    application_deadline <> substring(btrim(application_deadline) from '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
    OR application_deadline_date IS DISTINCT FROM substring(btrim(application_deadline) from '^[0-9]{4}-[0-9]{2}-[0-9]{2}')::date
  );

UPDATE public.jobs
SET application_deadline = NULL,
    application_deadline_date = NULL
WHERE application_deadline IS NOT NULL
  AND btrim(application_deadline) = '';

DROP TRIGGER IF EXISTS sync_jobs_application_deadline_fields ON public.jobs;

CREATE TRIGGER sync_jobs_application_deadline_fields
BEFORE INSERT OR UPDATE OF application_deadline, application_deadline_date
ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.sync_jobs_application_deadline_fields();
