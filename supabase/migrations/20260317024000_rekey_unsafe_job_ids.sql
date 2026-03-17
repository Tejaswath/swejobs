-- ============================================================
-- REKEY JOB IDS TO JAVASCRIPT-SAFE BIGINTS
-- ============================================================
--
-- The frontend consumes PostgREST JSON through JavaScript. BIGINT values
-- above Number.MAX_SAFE_INTEGER lose precision client-side, which breaks
-- row selection, detail fetches, tag lookups, and tracked-job writes.
--
-- This migration:
-- 1. deterministically rekeys existing unsafe job ids to 52-bit values
-- 2. updates child tables that reference jobs.id
-- 3. leaves future ingestion to use the new safe-id generator in Python

DO $$
DECLARE
  duplicate_target_count integer;
  existing_collision_count integer;
BEGIN
  CREATE TEMP TABLE job_id_rekey_map (
    old_id bigint PRIMARY KEY,
    new_id bigint NOT NULL UNIQUE
  ) ON COMMIT DROP;

  INSERT INTO job_id_rekey_map (old_id, new_id)
  SELECT
    j.id AS old_id,
    (('x' || substr(md5(COALESCE(j.raw_json ->> 'id', j.source_url, j.id::text)), 1, 13))::bit(52)::bigint) AS new_id
  FROM public.jobs j
  WHERE abs(j.id) > 9007199254740991;

  IF NOT EXISTS (SELECT 1 FROM job_id_rekey_map) THEN
    RAISE NOTICE 'No unsafe job ids found; skipping rekey.';
    RETURN;
  END IF;

  SELECT count(*)
  INTO duplicate_target_count
  FROM (
    SELECT new_id
    FROM job_id_rekey_map
    GROUP BY new_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_target_count > 0 THEN
    RAISE EXCEPTION 'Unsafe job id rekey aborted: duplicate target ids detected (%).', duplicate_target_count;
  END IF;

  SELECT count(*)
  INTO existing_collision_count
  FROM public.jobs j
  JOIN job_id_rekey_map m
    ON j.id = m.new_id
   AND j.id <> m.old_id;

  IF existing_collision_count > 0 THEN
    RAISE EXCEPTION 'Unsafe job id rekey aborted: target ids collide with existing safe ids (%).', existing_collision_count;
  END IF;

  INSERT INTO public.jobs (
    id,
    headline,
    description,
    employer_name,
    employer_id,
    municipality,
    municipality_code,
    region,
    region_code,
    occupation_id,
    occupation_label,
    ssyk_code,
    employment_type,
    working_hours,
    application_deadline,
    source_url,
    lang,
    remote_flag,
    is_relevant,
    is_active,
    published_at,
    updated_at,
    removed_at,
    ingested_at,
    raw_json,
    role_family,
    relevance_score,
    reason_codes,
    is_target_role,
    is_noise,
    source_name,
    company_canonical,
    company_tier,
    career_stage,
    career_stage_confidence,
    is_grad_program,
    years_required_min,
    swedish_required,
    consultancy_flag,
    source_provider,
    source_kind,
    source_company_key,
    is_direct_company_source,
    citizenship_required,
    security_clearance_required
  )
  SELECT
    m.new_id,
    j.headline,
    j.description,
    j.employer_name,
    j.employer_id,
    j.municipality,
    j.municipality_code,
    j.region,
    j.region_code,
    j.occupation_id,
    j.occupation_label,
    j.ssyk_code,
    j.employment_type,
    j.working_hours,
    j.application_deadline,
    j.source_url,
    j.lang,
    j.remote_flag,
    j.is_relevant,
    j.is_active,
    j.published_at,
    j.updated_at,
    j.removed_at,
    j.ingested_at,
    j.raw_json,
    j.role_family,
    j.relevance_score,
    j.reason_codes,
    j.is_target_role,
    j.is_noise,
    j.source_name,
    j.company_canonical,
    j.company_tier,
    j.career_stage,
    j.career_stage_confidence,
    j.is_grad_program,
    j.years_required_min,
    j.swedish_required,
    j.consultancy_flag,
    j.source_provider,
    j.source_kind,
    j.source_company_key,
    j.is_direct_company_source,
    j.citizenship_required,
    j.security_clearance_required
  FROM public.jobs j
  JOIN job_id_rekey_map m
    ON j.id = m.old_id;

  UPDATE public.job_tags jt
  SET job_id = m.new_id
  FROM job_id_rekey_map m
  WHERE jt.job_id = m.old_id;

  UPDATE public.tracked_jobs tj
  SET job_id = m.new_id
  FROM job_id_rekey_map m
  WHERE tj.job_id = m.old_id;

  UPDATE public.job_events je
  SET job_id = m.new_id
  FROM job_id_rekey_map m
  WHERE je.job_id = m.old_id;

  DELETE FROM public.jobs j
  USING job_id_rekey_map m
  WHERE j.id = m.old_id;
END $$;
