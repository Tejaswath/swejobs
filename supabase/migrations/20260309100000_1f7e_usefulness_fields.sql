-- ============================================================
-- USEFULNESS LAYER FOR PERSONALIZED JOB INTELLIGENCE
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS role_family TEXT NOT NULL DEFAULT 'noise',
  ADD COLUMN IF NOT EXISTS relevance_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reason_codes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS is_target_role BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_noise BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_role_family_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_role_family_check CHECK (
        role_family IN (
          'backend',
          'frontend',
          'full_stack',
          'data',
          'ml_ai',
          'devops_platform',
          'qa_test',
          'security',
          'product_other',
          'noise'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_relevance_score_range_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_relevance_score_range_check
      CHECK (relevance_score BETWEEN -100 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_target_active_published
  ON public.jobs(is_target_role, is_active, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_role_family
  ON public.jobs(role_family);

CREATE INDEX IF NOT EXISTS idx_jobs_relevance_score
  ON public.jobs(relevance_score DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_is_noise
  ON public.jobs(is_noise);

CREATE INDEX IF NOT EXISTS idx_jobs_reason_codes_gin
  ON public.jobs USING GIN(reason_codes);

-- Backfill defaults for existing rows to avoid null/undefined behavior in older datasets
UPDATE public.jobs
SET
  is_target_role = COALESCE(is_relevant, FALSE),
  is_noise = NOT COALESCE(is_relevant, FALSE)
WHERE
  role_family = 'noise'
  AND relevance_score = 0
  AND reason_codes = '{}'::TEXT[];
