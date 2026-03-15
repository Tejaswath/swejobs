-- ============================================================
-- SWEJOBS HIGH-SIGNAL V3: precision ranking metadata
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_name TEXT NOT NULL DEFAULT 'jobtech',
  ADD COLUMN IF NOT EXISTS company_canonical TEXT,
  ADD COLUMN IF NOT EXISTS company_tier TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS career_stage TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS career_stage_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS is_grad_program BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS years_required_min INTEGER,
  ADD COLUMN IF NOT EXISTS swedish_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consultancy_flag BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_company_tier_check'
  ) THEN
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_company_tier_check;
  END IF;

  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_company_tier_check
    CHECK (company_tier IN ('A', 'B', 'C', 'unknown'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_career_stage_check'
  ) THEN
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_career_stage_check;
  END IF;

  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_career_stage_check
    CHECK (career_stage IN ('graduate', 'trainee', 'junior', 'mid', 'senior', 'unknown'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_role_family_check'
  ) THEN
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_role_family_check;
  END IF;

  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_role_family_check CHECK (
      role_family IN (
        -- New high-signal families
        'graduate_program',
        'trainee_program',
        'software_engineering',
        'backend',
        'frontend',
        'ai_ml',
        'data_engineering',
        'devops_platform',
        'qa_test',
        'noise',
        -- Legacy families kept for compatibility during migration
        'full_stack',
        'data',
        'ml_ai',
        'security',
        'product_other'
      )
    );
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_active_target_relevance_published
  ON public.jobs(is_active, is_target_role, relevance_score DESC, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_company_tier_published
  ON public.jobs(company_tier, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_career_stage_published
  ON public.jobs(career_stage, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_swedish_years_required
  ON public.jobs(swedish_required, years_required_min);
