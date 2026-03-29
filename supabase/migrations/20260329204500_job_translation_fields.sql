ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS headline_en TEXT,
  ADD COLUMN IF NOT EXISTS description_en TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_needs_translation
  ON public.jobs(id)
  WHERE is_active = true
    AND lang = 'sv'
    AND (headline_en IS NULL OR description_en IS NULL);

COMMENT ON COLUMN public.jobs.headline_en IS
  'English translation of headline (null when untranslated or source already English).';

COMMENT ON COLUMN public.jobs.description_en IS
  'English translation of description (null when untranslated or source already English).';
