CREATE TABLE public.user_profile (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT DEFAULT '',
    headline TEXT DEFAULT '',
    location TEXT DEFAULT '',
    linkedin_url TEXT DEFAULT '',
    portfolio_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.user_profile
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own profile" ON public.user_profile
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.user_profile
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_user_profile_updated_at
  BEFORE UPDATE ON public.user_profile
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.profile_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fact_type TEXT NOT NULL
        CHECK (fact_type IN ('experience', 'education', 'project', 'award', 'summary')),
    title TEXT NOT NULL DEFAULT '',
    organization TEXT DEFAULT '',
    location TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    is_current BOOLEAN DEFAULT FALSE,
    description TEXT DEFAULT '',
    structured_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profile_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile facts" ON public.profile_facts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own profile facts" ON public.profile_facts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile facts" ON public.profile_facts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own profile facts" ON public.profile_facts
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_profile_facts_user_type_order
  ON public.profile_facts(user_id, fact_type, sort_order, created_at);

CREATE TRIGGER update_profile_facts_updated_at
  BEFORE UPDATE ON public.profile_facts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
