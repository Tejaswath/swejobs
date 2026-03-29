CREATE TABLE IF NOT EXISTS public.edge_function_quota (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, function_name, window_start)
);

CREATE INDEX IF NOT EXISTS idx_edge_function_quota_function_window
  ON public.edge_function_quota(function_name, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_edge_function_quota_user_window
  ON public.edge_function_quota(user_id, window_start DESC);

ALTER TABLE public.edge_function_quota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own edge function quota" ON public.edge_function_quota;
CREATE POLICY "Users can view own edge function quota"
  ON public.edge_function_quota
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.consume_edge_quota(
  p_user_id UUID,
  p_function_name TEXT,
  p_window_minutes INTEGER DEFAULT 60,
  p_max_requests INTEGER DEFAULT 60
)
RETURNS TABLE (
  allowed BOOLEAN,
  request_count INTEGER,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_minutes INTEGER := GREATEST(1, LEAST(COALESCE(p_window_minutes, 60), 1440));
  v_window_seconds INTEGER := v_window_minutes * 60;
  v_now TIMESTAMPTZ := NOW();
  v_epoch BIGINT := EXTRACT(EPOCH FROM v_now)::BIGINT;
  v_window_start TIMESTAMPTZ := TO_TIMESTAMP((v_epoch / v_window_seconds) * v_window_seconds);
  v_request_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(BTRIM(p_function_name), '') = '' THEN
    RAISE EXCEPTION 'Function name is required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.edge_function_quota (user_id, function_name, window_start, request_count, updated_at)
  VALUES (p_user_id, BTRIM(p_function_name), v_window_start, 1, NOW())
  ON CONFLICT (user_id, function_name, window_start)
  DO UPDATE
  SET
    request_count = public.edge_function_quota.request_count + 1,
    updated_at = NOW()
  RETURNING public.edge_function_quota.request_count
  INTO v_request_count;

  RETURN QUERY
  SELECT
    v_request_count <= p_max_requests,
    v_request_count,
    CASE
      WHEN v_request_count <= p_max_requests THEN 0
      ELSE v_window_seconds - (v_epoch % v_window_seconds)
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_edge_quota(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_edge_quota(UUID, TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_orphan_resume_storage(p_limit INTEGER DEFAULT 500)
RETURNS TABLE (deleted_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 500), 5000));
BEGIN
  RETURN QUERY
  WITH orphan AS (
    SELECT object_row.name
    FROM storage.objects AS object_row
    LEFT JOIN public.resume_versions AS resume_version
      ON resume_version.storage_path = object_row.name
    WHERE object_row.bucket_id = 'resume-files'
      AND resume_version.id IS NULL
    ORDER BY object_row.created_at ASC
    LIMIT v_limit
  ),
  deleted AS (
    DELETE FROM storage.objects AS object_row
    USING orphan
    WHERE object_row.bucket_id = 'resume-files'
      AND object_row.name = orphan.name
    RETURNING object_row.name
  )
  SELECT deleted.name FROM deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_orphan_resume_storage(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_resume_storage(INTEGER) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $sql$
        SELECT cron.schedule(
          'cleanup_orphan_resume_storage_nightly',
          '15 3 * * *',
          $$SELECT public.cleanup_orphan_resume_storage(500);$$
        );
      $sql$;
    EXCEPTION
      WHEN unique_violation THEN NULL;
    END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.system_resource_alerts(
  p_storage_warn_bytes BIGINT DEFAULT 1073741824,
  p_storage_critical_bytes BIGINT DEFAULT 3221225472,
  p_extract_warn_calls BIGINT DEFAULT 1000,
  p_extract_critical_calls BIGINT DEFAULT 5000
)
RETURNS TABLE (
  resume_file_count BIGINT,
  resume_storage_bytes BIGINT,
  extract_job_title_calls_24h BIGINT,
  storage_status TEXT,
  egress_status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH storage_stats AS (
    SELECT
      COUNT(*)::BIGINT AS resume_file_count,
      COALESCE(
        SUM(
          CASE
            WHEN (object_row.metadata ->> 'size') ~ '^[0-9]+$' THEN (object_row.metadata ->> 'size')::BIGINT
            ELSE 0
          END
        ),
        0
      )::BIGINT AS resume_storage_bytes
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'resume-files'
  ),
  quota_stats AS (
    SELECT
      COALESCE(SUM(edge_quota.request_count), 0)::BIGINT AS extract_job_title_calls_24h
    FROM public.edge_function_quota AS edge_quota
    WHERE edge_quota.function_name = 'extract-job-title'
      AND edge_quota.window_start >= NOW() - INTERVAL '24 hours'
  )
  SELECT
    storage_stats.resume_file_count,
    storage_stats.resume_storage_bytes,
    quota_stats.extract_job_title_calls_24h,
    CASE
      WHEN storage_stats.resume_storage_bytes >= p_storage_critical_bytes THEN 'critical'
      WHEN storage_stats.resume_storage_bytes >= p_storage_warn_bytes THEN 'warning'
      ELSE 'ok'
    END AS storage_status,
    CASE
      WHEN quota_stats.extract_job_title_calls_24h >= p_extract_critical_calls THEN 'critical'
      WHEN quota_stats.extract_job_title_calls_24h >= p_extract_warn_calls THEN 'warning'
      ELSE 'ok'
    END AS egress_status
  FROM storage_stats
  CROSS JOIN quota_stats;
$$;

REVOKE ALL ON FUNCTION public.system_resource_alerts(BIGINT, BIGINT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_resource_alerts(BIGINT, BIGINT, BIGINT, BIGINT) TO authenticated;
