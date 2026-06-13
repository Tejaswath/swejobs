-- Alerts should be explicit user opt-in.
-- 1) New saved searches default to alerts disabled.
ALTER TABLE public.saved_searches
  ALTER COLUMN alerts_enabled SET DEFAULT FALSE;

-- 2) Existing saved searches are disabled until each user re-enables.
UPDATE public.saved_searches
SET alerts_enabled = FALSE,
    updated_at = NOW()
WHERE alerts_enabled = TRUE;

