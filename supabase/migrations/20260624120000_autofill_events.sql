-- Autofill telemetry for Apply Assist (extension + SPA analytics).
CREATE TABLE public.autofill_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'unknown',
    fields_detected INTEGER NOT NULL DEFAULT 0 CHECK (fields_detected >= 0),
    fields_filled INTEGER NOT NULL DEFAULT 0 CHECK (fields_filled >= 0),
    resume_attached BOOLEAN NOT NULL DEFAULT false,
    page_host TEXT NOT NULL DEFAULT '',
    field_details JSONB,
    user_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.autofill_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own autofill events" ON public.autofill_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own autofill events" ON public.autofill_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_autofill_events_user_created ON public.autofill_events(user_id, created_at DESC);
