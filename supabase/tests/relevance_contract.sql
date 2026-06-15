-- Run after migrations in a disposable/local Supabase database.
-- These assertions keep SQL eligibility aligned with tests/fixtures/eligibility_cases.json.
DO $$
DECLARE
  j public.jobs;
BEGIN
  j.is_active := TRUE;
  j.is_target_role := TRUE;
  j.is_noise := FALSE;
  j.relevance_score := 60;
  j.headline := 'Junior Backend Engineer';
  j.career_stage := 'junior';
  j.years_required_min := 1;
  IF NOT public.job_passes_default_eligibility(j, 'high_signal') THEN
    RAISE EXCEPTION 'eligible junior role failed high-signal eligibility';
  END IF;

  j.headline := 'Experienced Computer Vision Engineer';
  j.career_stage := 'unknown';
  j.years_required_min := NULL;
  IF public.job_passes_default_eligibility(j, 'high_signal') THEN
    RAISE EXCEPTION 'experienced title passed high-signal eligibility';
  END IF;

  j.headline := 'Software Engineer';
  j.years_required_min := 3;
  IF public.job_passes_default_eligibility(j, 'graduate_trainee') THEN
    RAISE EXCEPTION '3+ years role passed graduate eligibility';
  END IF;

  j.years_required_min := NULL;
  j.swedish_required := TRUE;
  IF public.job_passes_default_eligibility(j, 'broad') THEN
    RAISE EXCEPTION 'Swedish-required role passed broad eligibility';
  END IF;

  j.swedish_required := FALSE;
  j.career_stage := 'senior';
  j.career_stage_confidence := 0.2;
  IF public.job_passes_default_eligibility(j, 'high_signal') THEN
    RAISE EXCEPTION 'senior career stage passed high-signal eligibility';
  END IF;
END;
$$;
