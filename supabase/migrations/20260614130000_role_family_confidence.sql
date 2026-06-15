ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS role_family_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_role_family_confidence_range_check'
  ) THEN
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_role_family_confidence_range_check;
  END IF;

  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_role_family_confidence_range_check
    CHECK (role_family_confidence BETWEEN 0.0 AND 1.0);
END $$;
