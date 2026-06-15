-- Preserve compact change detection after raw_json retention clears source blobs.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS payload_hash TEXT;

COMMENT ON COLUMN public.jobs.payload_hash IS
  'SHA-256 of the latest normalized source payload; prevents duplicate update events after raw_json compaction.';
