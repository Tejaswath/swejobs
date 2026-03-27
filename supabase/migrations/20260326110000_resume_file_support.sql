ALTER TABLE public.resume_versions
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS parsed_text TEXT,
  ADD COLUMN IF NOT EXISTS text_extracted_at TIMESTAMPTZ;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS resume_version_id UUID REFERENCES public.resume_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_applications_resume_version
  ON public.applications(user_id, resume_version_id)
  WHERE resume_version_id IS NOT NULL;

UPDATE public.applications AS application
SET resume_version_id = resume_version.id
FROM public.resume_versions AS resume_version
WHERE application.user_id = resume_version.user_id
  AND application.resume_version_id IS NULL
  AND COALESCE(NULLIF(application.resume_label, ''), '') <> ''
  AND resume_version.label = application.resume_label;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resume-files',
  'resume-files',
  false,
  3145728,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users can view own resume files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own resume files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own resume files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own resume files" ON storage.objects;

CREATE POLICY "Users can view own resume files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'resume-files'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can upload own resume files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'resume-files'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own resume files"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'resume-files'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'resume-files'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own resume files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'resume-files'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );
