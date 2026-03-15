-- ============================================================
-- COVERAGE TRUST FIELDS: source metadata + eligibility signals
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_provider text,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_company_key text,
  ADD COLUMN IF NOT EXISTS is_direct_company_source boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS citizenship_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS security_clearance_required boolean NOT NULL DEFAULT false;

UPDATE public.jobs
SET source_provider = COALESCE(source_provider, NULLIF(source_name, 'jobtech'))
WHERE source_provider IS NULL;

UPDATE public.jobs
SET source_kind = CASE
  WHEN source_kind IS NOT NULL THEN source_kind
  WHEN source_name = 'jobtech' THEN 'jobtech'
  ELSE 'direct_company_ats'
END
WHERE source_kind IS NULL;

UPDATE public.jobs
SET is_direct_company_source = COALESCE(is_direct_company_source, false) OR source_kind = 'direct_company_ats'
WHERE source_kind = 'direct_company_ats';

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_source_kind_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_source_kind_check CHECK (
    source_kind IS NULL OR source_kind IN ('jobtech', 'direct_company_ats', 'html_fallback')
  );

CREATE INDEX IF NOT EXISTS idx_jobs_company_canonical_source_provider
  ON public.jobs(company_canonical, source_provider);
