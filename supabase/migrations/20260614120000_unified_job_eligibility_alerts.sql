-- Mirror the deterministic eligibility contract used by the frontend and worker.
CREATE OR REPLACE FUNCTION public.job_passes_default_eligibility(
  p_job public.jobs,
  p_lens TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE LOWER(COALESCE(p_lens, 'high_signal'))
    WHEN 'broad' THEN
      COALESCE(p_job.is_active, FALSE)
      AND NOT COALESCE(p_job.is_noise, FALSE)
      AND NOT COALESCE(p_job.swedish_required, FALSE)
      AND NOT COALESCE(p_job.citizenship_required, FALSE)
      AND NOT COALESCE(p_job.security_clearance_required, FALSE)
    WHEN 'graduate_trainee' THEN
      COALESCE(p_job.is_active, FALSE)
      AND NOT COALESCE(p_job.is_noise, FALSE)
      AND NOT COALESCE(p_job.swedish_required, FALSE)
      AND NOT COALESCE(p_job.citizenship_required, FALSE)
      AND NOT COALESCE(p_job.security_clearance_required, FALSE)
      AND COALESCE(p_job.years_required_min, 0) < 3
      AND COALESCE(LOWER(p_job.career_stage), 'unknown') NOT IN ('senior', 'lead', 'staff', 'principal')
      AND NOT (COALESCE(p_job.reason_codes, '{}'::TEXT[]) && ARRAY['career_stage_senior', 'years_required_3plus'])
      AND COALESCE(p_job.headline, '') !~* '\m(senior|lead|principal|staff|architect|manager|head of|director|vp|vice president|experienced|expert|seasoned|erfaren|erfarenhet|flerårig|flerarig)\M|gedigen erfarenhet'
      AND COALESCE(p_job.relevance_score, 0) >= 15
      AND (
        COALESCE(p_job.is_grad_program, FALSE)
        OR COALESCE(LOWER(p_job.career_stage), 'unknown') IN ('graduate', 'trainee', 'junior')
        OR (p_job.years_required_min IS NOT NULL AND p_job.years_required_min <= 1)
      )
    ELSE
      COALESCE(p_job.is_active, FALSE)
      AND COALESCE(p_job.is_target_role, FALSE)
      AND NOT COALESCE(p_job.is_noise, FALSE)
      AND NOT COALESCE(p_job.swedish_required, FALSE)
      AND NOT COALESCE(p_job.citizenship_required, FALSE)
      AND NOT COALESCE(p_job.security_clearance_required, FALSE)
      AND COALESCE(p_job.years_required_min, 0) < 3
      AND COALESCE(LOWER(p_job.career_stage), 'unknown') NOT IN ('senior', 'lead', 'staff', 'principal')
      AND NOT (COALESCE(p_job.reason_codes, '{}'::TEXT[]) && ARRAY['career_stage_senior', 'years_required_3plus'])
      AND COALESCE(p_job.headline, '') !~* '\m(senior|lead|principal|staff|architect|manager|head of|director|vp|vice president|experienced|expert|seasoned|erfaren|erfarenhet|flerårig|flerarig)\M|gedigen erfarenhet'
      AND COALESCE(p_job.relevance_score, 0) >= 30
  END;
$$;

REVOKE ALL ON FUNCTION public.job_passes_default_eligibility(public.jobs, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.job_passes_default_eligibility(public.jobs, TEXT) TO service_role;

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
    RAISE EXCEPTION 'Unsupported alert frequency: %', p_frequency USING ERRCODE = '22023';
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
    LEFT JOIN public.source_feed_registry sfr ON sfr.feed_key = j.source_feed_key
    WHERE public.job_passes_default_eligibility(j, ss.lens)
      AND (
        ss.lens <> 'high_signal'
        OR (
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
  ),
  filtered AS (
    SELECT c.*
    FROM candidates c
    JOIN search_scope ss ON ss.id = c.saved_search_id AND ss.user_id = c.user_id
    WHERE (
      COALESCE(array_length(ss.keywords, 1), 0) = 0
      OR EXISTS (
        SELECT 1 FROM unnest(ss.keywords) AS kw
        WHERE LOWER(COALESCE(c.headline, '')) LIKE '%' || LOWER(BTRIM(kw)) || '%'
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
      user_id, saved_search_id, job_id, job_external_key, channel, status, delivered_at, created_at
    )
    SELECT
      f.user_id, f.saved_search_id, f.job_id, f.job_external_key, 'in_app', 'delivered', NOW(), NOW()
    FROM filtered f
    ON CONFLICT (user_id, saved_search_id, job_external_key, channel) DO NOTHING
    RETURNING user_id, saved_search_id, job_id, job_external_key
  ),
  inserted_alerts AS (
    INSERT INTO public.in_app_alerts (
      user_id, saved_search_id, job_id, job_external_key, title, body, alert_frequency, created_at
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
    SELECT DISTINCT saved_search_id FROM inserted_delivery
  ),
  updated_searches AS (
    UPDATE public.saved_searches s
    SET alert_last_sent_at = NOW(), updated_at = NOW()
    WHERE s.id IN (SELECT saved_search_id FROM touched_searches)
    RETURNING s.id
  )
  SELECT (SELECT COUNT(*) FROM search_scope), (SELECT COUNT(*) FROM inserted_alerts)
  INTO v_processed, v_inserted;

  processed_searches := COALESCE(v_processed, 0);
  inserted_alerts := COALESCE(v_inserted, 0);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_saved_search_alerts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_saved_search_alerts(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_saved_search_alerts(TEXT) TO service_role;
