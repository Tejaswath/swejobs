ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ats_job_description TEXT;

CREATE TABLE IF NOT EXISTS public.email_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gmail_email TEXT NOT NULL,
  gmail_app_password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.email_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own email config" ON public.email_config;
CREATE POLICY "Users can view own email config"
  ON public.email_config
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own email config" ON public.email_config;
CREATE POLICY "Users can insert own email config"
  ON public.email_config
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own email config" ON public.email_config;
CREATE POLICY "Users can update own email config"
  ON public.email_config
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own email config" ON public.email_config;
CREATE POLICY "Users can delete own email config"
  ON public.email_config
  FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_email_config_updated_at ON public.email_config;
CREATE TRIGGER update_email_config_updated_at
  BEFORE UPDATE ON public.email_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id UUID NOT NULL REFERENCES public.recruiters(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.email_templates(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  open_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own email logs" ON public.email_logs;
CREATE POLICY "Users can view own email logs"
  ON public.email_logs
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own email logs" ON public.email_logs;
CREATE POLICY "Users can insert own email logs"
  ON public.email_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own email logs" ON public.email_logs;
CREATE POLICY "Users can update own email logs"
  ON public.email_logs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own email logs" ON public.email_logs;
CREATE POLICY "Users can delete own email logs"
  ON public.email_logs
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_email_logs_user_sent_at
  ON public.email_logs(user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_logs_opened_at
  ON public.email_logs(opened_at DESC)
  WHERE opened_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_email_logs_updated_at ON public.email_logs;
CREATE TRIGGER update_email_logs_updated_at
  BEFORE UPDATE ON public.email_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.increment_email_open(log_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_logs
  SET
    open_count = open_count + 1,
    opened_at = COALESCE(opened_at, NOW()),
    updated_at = NOW()
  WHERE id = log_id
    AND status = 'sent'
    AND (opened_at IS NULL OR opened_at < NOW() - INTERVAL '10 seconds');
END;
$$;

REVOKE ALL ON FUNCTION public.increment_email_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_email_open(UUID) TO service_role;

COMMENT ON COLUMN public.applications.ats_job_description IS
  'Captured external job description text used for ATS scans when no linked SweJobs job tags are available.';

COMMENT ON TABLE public.email_config IS
  'Per-user SMTP credentials for outreach email sending.';

COMMENT ON TABLE public.email_logs IS
  'Outreach send history and open tracking metadata.';
