CREATE OR REPLACE FUNCTION public.enforce_resume_versions_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM public.resume_versions
    WHERE user_id = NEW.user_id
  ) >= 10 THEN
    RAISE EXCEPTION 'Resume limit reached (10). Delete an older resume before uploading a new one.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_resume_versions_limit_before_insert ON public.resume_versions;

CREATE TRIGGER enforce_resume_versions_limit_before_insert
  BEFORE INSERT ON public.resume_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_resume_versions_limit();
