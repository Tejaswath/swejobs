DROP POLICY IF EXISTS "Ingestion state is viewable by everyone" ON public.ingestion_state;
DROP POLICY IF EXISTS "Ingestion state is viewable by authenticated users" ON public.ingestion_state;

CREATE POLICY "Ingestion state is viewable by authenticated users"
  ON public.ingestion_state
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Taxonomy cache is viewable by everyone" ON public.taxonomy_cache;
DROP POLICY IF EXISTS "Taxonomy cache is viewable by authenticated users" ON public.taxonomy_cache;

CREATE POLICY "Taxonomy cache is viewable by authenticated users"
  ON public.taxonomy_cache
  FOR SELECT
  TO authenticated
  USING (true);
