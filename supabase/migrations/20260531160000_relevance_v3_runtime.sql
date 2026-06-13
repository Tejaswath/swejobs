-- ============================================================
-- SWEJOBS V3 RUNTIME RELEVANCE + ALERTS INFRASTRUCTURE
-- ============================================================

-- 1) Jobs: runtime source-feed link used by serve-time quality gating.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_feed_key TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_source_feed_key
  ON public.jobs(source_feed_key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_source_feed_key_fkey'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_source_feed_key_fkey
      FOREIGN KEY (source_feed_key)
      REFERENCES public.source_feed_registry(feed_key)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    -- source_feed_registry is created below; FK is added in a second block later.
    NULL;
END;
$$;

-- 2) Runtime source registry (DB source of truth, YAML is seed only).
CREATE TABLE IF NOT EXISTS public.source_feed_registry (
  feed_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  company_canonical TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  high_signal_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  quality_band TEXT NOT NULL DEFAULT 'unrated'
    CHECK (quality_band IN ('trusted', 'verified', 'candidate', 'blocked', 'unrated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_feed_registry_quality
  ON public.source_feed_registry(quality_band, enabled, high_signal_eligible);

ALTER TABLE public.source_feed_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Source feed registry is public read" ON public.source_feed_registry;
CREATE POLICY "Source feed registry is public read"
  ON public.source_feed_registry
  FOR SELECT
  USING (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_source_feed_key_fkey'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_source_feed_key_fkey
      FOREIGN KEY (source_feed_key)
      REFERENCES public.source_feed_registry(feed_key)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- 3) Raw probe history for feed-quality computation.
CREATE TABLE IF NOT EXISTS public.source_feed_probe_runs (
  id BIGSERIAL PRIMARY KEY,
  feed_key TEXT NOT NULL REFERENCES public.source_feed_registry(feed_key) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  http_status INTEGER,
  http_requests INTEGER NOT NULL DEFAULT 0 CHECK (http_requests >= 0),
  fetched_rows INTEGER NOT NULL DEFAULT 0 CHECK (fetched_rows >= 0),
  persisted_rows INTEGER NOT NULL DEFAULT 0 CHECK (persisted_rows >= 0),
  target_rows INTEGER NOT NULL DEFAULT 0 CHECK (target_rows >= 0),
  removed_rows INTEGER NOT NULL DEFAULT 0 CHECK (removed_rows >= 0),
  location_filtering_supported BOOLEAN NOT NULL DEFAULT TRUE,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_feed_probe_runs_feed_time
  ON public.source_feed_probe_runs(feed_key, run_at DESC);

ALTER TABLE public.source_feed_probe_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Source feed probes service-role only" ON public.source_feed_probe_runs;
CREATE POLICY "Source feed probes service-role only"
  ON public.source_feed_probe_runs
  FOR SELECT
  TO authenticated
  USING (false);

-- 4) User feedback events (user-scoped only; no global poisoning).
CREATE TABLE IF NOT EXISTS public.job_feedback_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id BIGINT REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_external_key TEXT NOT NULL,
  signal_type TEXT NOT NULL
    CHECK (signal_type IN ('apply', 'save', 'follow_company', 'hide', 'skip')),
  employer_name TEXT,
  role_family TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_feedback_events_user_time
  ON public.job_feedback_events(user_id, created_at DESC);

ALTER TABLE public.job_feedback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own job feedback" ON public.job_feedback_events;
CREATE POLICY "Users can view own job feedback"
  ON public.job_feedback_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own job feedback" ON public.job_feedback_events;
CREATE POLICY "Users can create own job feedback"
  ON public.job_feedback_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 5) Explicit user ranking state (consumed by serve layer/UI ranking overlay).
CREATE TABLE IF NOT EXISTS public.user_ranking_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  high_signal_score_delta SMALLINT NOT NULL DEFAULT 0,
  preferred_companies TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  demoted_companies TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  preferred_role_families TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  demoted_role_families TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_ranking_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ranking state" ON public.user_ranking_state;
CREATE POLICY "Users can view own ranking state"
  ON public.user_ranking_state
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own ranking state" ON public.user_ranking_state;
CREATE POLICY "Users can create own ranking state"
  ON public.user_ranking_state
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own ranking state" ON public.user_ranking_state;
CREATE POLICY "Users can update own ranking state"
  ON public.user_ranking_state
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6) Saved-search alert controls/state.
ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS alert_frequency TEXT NOT NULL DEFAULT 'daily'
    CHECK (alert_frequency IN ('daily', 'weekly')),
  ADD COLUMN IF NOT EXISTS alert_last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lens TEXT NOT NULL DEFAULT 'high_signal'
    CHECK (lens IN ('high_signal', 'broad', 'graduate_trainee')),
  ADD COLUMN IF NOT EXISTS include_jobtech_in_high_signal BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_saved_searches_alert_schedule
  ON public.saved_searches(alerts_enabled, alert_frequency, alert_last_sent_at);

-- 7) Delivery log (durable dedupe even when jobs are purged).
CREATE TABLE IF NOT EXISTS public.alert_delivery_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_search_id BIGINT NOT NULL REFERENCES public.saved_searches(id) ON DELETE CASCADE,
  job_id BIGINT REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_external_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app'
    CHECK (channel IN ('in_app', 'email')),
  status TEXT NOT NULL DEFAULT 'delivered',
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, saved_search_id, job_external_key, channel)
);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_events_user_time
  ON public.alert_delivery_events(user_id, delivered_at DESC);

ALTER TABLE public.alert_delivery_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own alert delivery events" ON public.alert_delivery_events;
CREATE POLICY "Users can view own alert delivery events"
  ON public.alert_delivery_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 8) In-app alert inbox rows.
CREATE TABLE IF NOT EXISTS public.in_app_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_search_id BIGINT NOT NULL REFERENCES public.saved_searches(id) ON DELETE CASCADE,
  job_id BIGINT REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_external_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  alert_frequency TEXT NOT NULL
    CHECK (alert_frequency IN ('daily', 'weekly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_in_app_alerts_user_time
  ON public.in_app_alerts(user_id, created_at DESC);

ALTER TABLE public.in_app_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own in-app alerts" ON public.in_app_alerts;
CREATE POLICY "Users can view own in-app alerts"
  ON public.in_app_alerts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own in-app alerts" ON public.in_app_alerts;
CREATE POLICY "Users can update own in-app alerts"
  ON public.in_app_alerts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 9) Human labels for precision loop (export -> ingest -> report).
CREATE TABLE IF NOT EXISTS public.relevance_labels (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  lens TEXT NOT NULL CHECK (lens IN ('high_signal', 'broad', 'graduate_trainee')),
  label SMALLINT NOT NULL CHECK (label IN (0, 1)),
  reviewer_key TEXT NOT NULL,
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, lens, reviewer_key)
);

ALTER TABLE public.relevance_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Relevance labels authenticated read" ON public.relevance_labels;
CREATE POLICY "Relevance labels authenticated read"
  ON public.relevance_labels
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Relevance labels authenticated write" ON public.relevance_labels;
CREATE POLICY "Relevance labels authenticated write"
  ON public.relevance_labels
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 10) Scheduled in-app alert generation.
CREATE OR REPLACE FUNCTION public.generate_saved_search_alerts(p_frequency TEXT)
RETURNS TABLE (
  processed_searches INTEGER,
  inserted_alerts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_frequency TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_frequency), ''), 'daily'));
  v_processed INTEGER := 0;
  v_inserted INTEGER := 0;
BEGIN
  IF v_frequency NOT IN ('daily', 'weekly') THEN
    RAISE EXCEPTION 'Unsupported alert frequency: %', p_frequency
      USING ERRCODE = '22023';
  END IF;

  WITH search_scope AS (
    SELECT
      s.id,
      s.user_id,
      COALESCE(s.alert_last_sent_at, s.created_at, to_timestamp(0)) AS cutoff,
      COALESCE(s.keywords, '{}'::TEXT[]) AS keywords,
      COALESCE(s.remote_only, FALSE) AS remote_only,
      COALESCE(s.english_only, FALSE) AS english_only,
      COALESCE(s.lens, 'high_signal') AS lens,
      COALESCE(s.include_jobtech_in_high_signal, FALSE) AS include_jobtech_in_high_signal
    FROM public.saved_searches s
    WHERE s.alerts_enabled = TRUE
      AND COALESCE(s.alert_frequency, 'daily') = v_frequency
  ),
  candidates AS (
    SELECT
      ss.id AS saved_search_id,
      ss.user_id,
      j.id AS job_id,
      COALESCE(NULLIF(j.source_url, ''), 'job:' || j.id::TEXT) AS job_external_key,
      j.headline,
      j.employer_name,
      j.source_url,
      j.published_at,
      ss.lens,
      ss.cutoff
    FROM search_scope ss
    JOIN public.jobs j
      ON j.is_active = TRUE
     AND j.published_at IS NOT NULL
     AND j.published_at > ss.cutoff
    LEFT JOIN public.source_feed_registry sfr
      ON sfr.feed_key = j.source_feed_key
    WHERE
      (
        ss.lens = 'high_signal'
        AND j.is_target_role = TRUE
        AND j.is_noise = FALSE
        AND COALESCE(j.relevance_score, 0) >= 30
        AND (
          (
            j.source_kind = 'jobtech'
            AND ss.include_jobtech_in_high_signal = TRUE
          )
          OR (
            j.source_kind <> 'jobtech'
            AND COALESCE(sfr.enabled, FALSE) = TRUE
            AND COALESCE(sfr.high_signal_eligible, FALSE) = TRUE
            AND COALESCE(sfr.quality_band, 'unrated') IN ('trusted', 'verified')
          )
        )
      )
      OR (
        ss.lens = 'broad'
        AND j.is_noise = FALSE
      )
      OR (
        ss.lens = 'graduate_trainee'
        AND j.is_noise = FALSE
        AND COALESCE(j.relevance_score, 0) >= 15
        AND (
          j.is_grad_program = TRUE
          OR j.career_stage IN ('graduate', 'trainee', 'junior')
          OR (j.years_required_min IS NOT NULL AND j.years_required_min <= 1)
        )
      )
  ),
  filtered AS (
    SELECT c.*
    FROM candidates c
    JOIN search_scope ss
      ON ss.id = c.saved_search_id
     AND ss.user_id = c.user_id
    WHERE
      (
        COALESCE(array_length(ss.keywords, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(ss.keywords) AS kw
          WHERE
            LOWER(COALESCE(c.headline, '')) LIKE '%' || LOWER(BTRIM(kw)) || '%'
            OR LOWER(COALESCE(c.employer_name, '')) LIKE '%' || LOWER(BTRIM(kw)) || '%'
        )
      )
      AND (NOT ss.remote_only OR EXISTS (
        SELECT 1 FROM public.jobs j2 WHERE j2.id = c.job_id AND COALESCE(j2.remote_flag, FALSE) = TRUE
      ))
      AND (NOT ss.english_only OR EXISTS (
        SELECT 1 FROM public.jobs j3 WHERE j3.id = c.job_id AND j3.lang = 'en'
      ))
  ),
  inserted_delivery AS (
    INSERT INTO public.alert_delivery_events (
      user_id,
      saved_search_id,
      job_id,
      job_external_key,
      channel,
      status,
      delivered_at,
      created_at
    )
    SELECT
      f.user_id,
      f.saved_search_id,
      f.job_id,
      f.job_external_key,
      'in_app',
      'delivered',
      NOW(),
      NOW()
    FROM filtered f
    ON CONFLICT (user_id, saved_search_id, job_external_key, channel)
      DO NOTHING
    RETURNING user_id, saved_search_id, job_id, job_external_key
  ),
  inserted_alerts AS (
    INSERT INTO public.in_app_alerts (
      user_id,
      saved_search_id,
      job_id,
      job_external_key,
      title,
      body,
      alert_frequency,
      created_at
    )
    SELECT
      d.user_id,
      d.saved_search_id,
      d.job_id,
      d.job_external_key,
      'New job match',
      COALESCE(j.headline, 'Untitled role') || ' at ' || COALESCE(j.employer_name, 'Unknown company'),
      v_frequency,
      NOW()
    FROM inserted_delivery d
    LEFT JOIN public.jobs j ON j.id = d.job_id
    RETURNING 1
  ),
  touched_searches AS (
    SELECT DISTINCT saved_search_id
    FROM inserted_delivery
  ),
  updated_searches AS (
    UPDATE public.saved_searches s
    SET alert_last_sent_at = NOW(),
        updated_at = NOW()
    WHERE s.id IN (SELECT saved_search_id FROM touched_searches)
    RETURNING s.id
  )
  SELECT
    (SELECT COUNT(*) FROM search_scope),
    (SELECT COUNT(*) FROM inserted_alerts)
  INTO v_processed, v_inserted;

  processed_searches := COALESCE(v_processed, 0);
  inserted_alerts := COALESCE(v_inserted, 0);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_saved_search_alerts(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_saved_search_alerts(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_saved_search_alerts(TEXT) TO service_role;

-- 11) cron schedule: 07:15 daily and 08:00 Monday weekly
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.schedule(
        'saved_search_alerts_daily_0715',
        '15 7 * * *',
        'SELECT public.generate_saved_search_alerts(''daily'');'
      );
    EXCEPTION
      WHEN unique_violation THEN NULL;
      WHEN others THEN NULL;
    END;

    BEGIN
      PERFORM cron.schedule(
        'saved_search_alerts_weekly_mon_0800',
        '0 8 * * 1',
        'SELECT public.generate_saved_search_alerts(''weekly'');'
      );
    EXCEPTION
      WHEN unique_violation THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END;
$$;
