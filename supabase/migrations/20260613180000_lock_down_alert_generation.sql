-- Alert generation processes searches for all users and must not be callable
-- directly by regular authenticated clients.
REVOKE ALL ON FUNCTION public.generate_saved_search_alerts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_saved_search_alerts(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_saved_search_alerts(TEXT) TO service_role;

-- Precision labels are an operational review input, not end-user content.
DROP POLICY IF EXISTS "Relevance labels authenticated write" ON public.relevance_labels;
