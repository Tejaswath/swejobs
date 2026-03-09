
-- ============================================================
-- TIMESTAMP UPDATE FUNCTION (reusable)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============================================================
-- CORE JOB DATA (written by Azure VM pipeline, read by frontend)
-- ============================================================
CREATE TABLE public.jobs (
    id              BIGINT PRIMARY KEY,
    headline        TEXT NOT NULL,
    description     TEXT,
    employer_name   TEXT,
    employer_id     TEXT,
    municipality    TEXT,
    municipality_code TEXT,
    region          TEXT,
    region_code     TEXT,
    occupation_id   TEXT,
    occupation_label TEXT,
    ssyk_code       TEXT,
    employment_type TEXT,
    working_hours   TEXT,
    application_deadline TEXT,
    source_url      TEXT,
    lang            TEXT DEFAULT 'sv',
    remote_flag     BOOLEAN DEFAULT FALSE,
    is_relevant     BOOLEAN,
    is_active       BOOLEAN DEFAULT TRUE,
    published_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    removed_at      TIMESTAMPTZ,
    ingested_at     TIMESTAMPTZ DEFAULT NOW(),
    raw_json        JSONB
);

CREATE INDEX idx_jobs_active_relevant ON public.jobs(is_active, is_relevant, published_at DESC);
CREATE INDEX idx_jobs_employer ON public.jobs(employer_name);
CREATE INDEX idx_jobs_region ON public.jobs(region_code);
CREATE INDEX idx_jobs_lang ON public.jobs(lang);
CREATE INDEX idx_jobs_published ON public.jobs(published_at DESC);
CREATE INDEX idx_jobs_occupation ON public.jobs(ssyk_code);

-- RLS: Jobs are publicly readable (no auth needed to browse)
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Jobs are viewable by everyone" ON public.jobs FOR SELECT USING (true);
-- Pipeline writes via service_role key, so no INSERT/UPDATE policy needed for anon

-- ============================================================
-- TAG SYSTEM
-- ============================================================
CREATE TABLE public.job_tags (
    job_id  BIGINT NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (job_id, tag)
);

CREATE INDEX idx_job_tags_tag ON public.job_tags(tag);
CREATE INDEX idx_job_tags_job_id ON public.job_tags(job_id);

ALTER TABLE public.job_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job tags are viewable by everyone" ON public.job_tags FOR SELECT USING (true);

-- ============================================================
-- EVENT LOG
-- ============================================================
CREATE TABLE public.job_events (
    id           BIGSERIAL PRIMARY KEY,
    job_id       BIGINT NOT NULL,
    event_type   TEXT NOT NULL,
    event_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload_hash TEXT
);

CREATE INDEX idx_job_events_job_id ON public.job_events(job_id);
CREATE INDEX idx_job_events_time ON public.job_events(event_time DESC);
CREATE INDEX idx_job_events_type_time ON public.job_events(event_type, event_time DESC);

ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job events are viewable by everyone" ON public.job_events FOR SELECT USING (true);

-- ============================================================
-- INGESTION STATE
-- ============================================================
CREATE TABLE public.ingestion_state (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ingestion_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ingestion state is viewable by everyone" ON public.ingestion_state FOR SELECT USING (true);

-- ============================================================
-- TAXONOMY CACHE
-- ============================================================
CREATE TABLE public.taxonomy_cache (
    concept_id      TEXT PRIMARY KEY,
    concept_type    TEXT NOT NULL,
    preferred_label TEXT NOT NULL,
    ssyk_code       TEXT,
    parent_id       TEXT,
    cached_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.taxonomy_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Taxonomy cache is viewable by everyone" ON public.taxonomy_cache FOR SELECT USING (true);

-- ============================================================
-- SAVED SEARCHES (user-specific)
-- ============================================================
CREATE TABLE public.saved_searches (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    keywords        TEXT[],
    regions         TEXT[],
    remote_only     BOOLEAN DEFAULT FALSE,
    english_only    BOOLEAN DEFAULT FALSE,
    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saved_searches_user ON public.saved_searches(user_id);

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own searches" ON public.saved_searches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own searches" ON public.saved_searches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own searches" ON public.saved_searches FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own searches" ON public.saved_searches FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_saved_searches_updated_at
  BEFORE UPDATE ON public.saved_searches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- PERSONAL JOB TRACKING (user-specific)
-- ============================================================
CREATE TABLE public.tracked_jobs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id      BIGINT NOT NULL REFERENCES public.jobs(id),
    status      TEXT NOT NULL DEFAULT 'saved',
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, job_id)
);

CREATE INDEX idx_tracked_jobs_user ON public.tracked_jobs(user_id);
CREATE INDEX idx_tracked_jobs_status ON public.tracked_jobs(user_id, status);

ALTER TABLE public.tracked_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tracked jobs" ON public.tracked_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own tracked jobs" ON public.tracked_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tracked jobs" ON public.tracked_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own tracked jobs" ON public.tracked_jobs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_tracked_jobs_updated_at
  BEFORE UPDATE ON public.tracked_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- WEEKLY DIGESTS (immutable, public read)
-- ============================================================
CREATE TABLE public.weekly_digests (
    id           BIGSERIAL PRIMARY KEY,
    period_start TIMESTAMPTZ NOT NULL,
    period_end   TIMESTAMPTZ NOT NULL,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    digest_json  JSONB NOT NULL
);

CREATE INDEX idx_digests_period ON public.weekly_digests(period_end DESC);

ALTER TABLE public.weekly_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Digests are viewable by everyone" ON public.weekly_digests FOR SELECT USING (true);
