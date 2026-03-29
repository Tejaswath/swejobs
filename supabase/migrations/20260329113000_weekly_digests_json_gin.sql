CREATE INDEX IF NOT EXISTS idx_weekly_digests_json_gin
  ON public.weekly_digests
  USING gin (digest_json);
