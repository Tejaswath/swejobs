CREATE TABLE public.resume_versions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    target_role TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, label)
);

ALTER TABLE public.resume_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own resume versions" ON public.resume_versions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own resume versions" ON public.resume_versions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own resume versions" ON public.resume_versions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own resume versions" ON public.resume_versions
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_resume_versions_user_created ON public.resume_versions(user_id, created_at DESC);
CREATE UNIQUE INDEX idx_resume_versions_one_default_per_user
  ON public.resume_versions(user_id)
  WHERE is_default = true;

CREATE TRIGGER update_resume_versions_updated_at
  BEFORE UPDATE ON public.resume_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
