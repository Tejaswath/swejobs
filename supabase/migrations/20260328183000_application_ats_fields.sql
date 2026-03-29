ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ats_score SMALLINT
  CHECK (ats_score BETWEEN 0 AND 100);

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ats_keywords_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_applications_user_ats_score
  ON public.applications(user_id, ats_score DESC)
  WHERE ats_score IS NOT NULL;
