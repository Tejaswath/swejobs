-- ============================================================
-- ATS V1 COVERAGE PREREQS: source_url dedupe + first-screen index
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_jobs_source_url_not_null
  ON public.jobs(source_url)
  WHERE source_url IS NOT NULL;

DROP INDEX IF EXISTS idx_jobs_active_target_relevance_published;
CREATE INDEX idx_jobs_active_target_relevance_published
  ON public.jobs(is_active, is_target_role, relevance_score DESC, published_at DESC);

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
        -- v1 high-signal families
        'software_engineering',
        'full_stack',
        'backend',
        'frontend',
        'mobile',
        'ai_ml',
        'data_engineering',
        'devops_platform',
        'qa_test',
        'security',
        'noise',
        -- compatibility values
        'graduate_program',
        'trainee_program',
        'data',
        'ml_ai',
        'product_other'
      )
    );
END $$;

