
-- User skills for Skill Gap Tracker
CREATE TABLE public.user_skills (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill text NOT NULL,
  proficiency text NOT NULL DEFAULT 'learning' CHECK (proficiency IN ('strong', 'learning', 'interested')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, skill)
);

ALTER TABLE public.user_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own skills" ON public.user_skills FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own skills" ON public.user_skills FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own skills" ON public.user_skills FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own skills" ON public.user_skills FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Company Watchlist
CREATE TABLE public.watched_companies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employer_name text NOT NULL,
  employer_id text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, employer_name)
);

ALTER TABLE public.watched_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watchlist" ON public.watched_companies FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can add to watchlist" ON public.watched_companies FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can remove from watchlist" ON public.watched_companies FOR DELETE TO authenticated USING (auth.uid() = user_id);
