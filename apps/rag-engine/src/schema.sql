-- Central knowledge store for every tenant. Idempotent: applied by the owner role at each start.
-- Isolation is enforced twice: every query filters by tenant_id, and row-level security limits
-- the application role (rag_app, never a superuser) to the tenant set for its transaction.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS rag;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rag_app') THEN
    CREATE ROLE rag_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS rag.settings (
  tenant_id text PRIMARY KEY,
  embedding_model text NOT NULL,
  top_k integer NOT NULL,
  min_score real NOT NULL,
  chunk_size integer NOT NULL,
  chunk_overlap integer NOT NULL,
  -- The version being indexed. Search keeps using active_version until it is complete.
  version integer NOT NULL DEFAULT 1,
  active_version integer,
  active_model text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag.documents (
  tenant_id text NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  type text NOT NULL,
  file_bytes integer NOT NULL,
  text_bytes integer NOT NULL,
  -- Extracted text, so a settings change can re-chunk without a new upload.
  sections jsonb NOT NULL,
  sensitive_findings integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'INDEXING' CHECK (status IN ('INDEXING', 'READY', 'PAUSED')),
  reason text,
  -- The tenant user whose quotas and policies apply to this document's embedding calls.
  requested_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS rag.chunks (
  tenant_id text NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  version integer NOT NULL,
  ordinal integer NOT NULL,
  page integer,
  title text NOT NULL,
  content text NOT NULL,
  embedding_model text NOT NULL,
  embedding vector(768),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, document_id, version, ordinal),
  -- Foreign keys ignore row-level security; including tenant_id keeps a chunk inside its tenant.
  FOREIGN KEY (tenant_id, document_id) REFERENCES rag.documents (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rag_chunks_scope ON rag.chunks (tenant_id, embedding_model, version);
CREATE INDEX IF NOT EXISTS rag_chunks_pending ON rag.chunks (tenant_id, version, document_id) WHERE embedding IS NULL;
CREATE INDEX IF NOT EXISTS rag_chunks_embedding ON rag.chunks USING hnsw (embedding vector_cosine_ops);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['settings', 'documents', 'chunks'] LOOP
    EXECUTE format('ALTER TABLE rag.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE rag.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'rag' AND tablename = name AND policyname = 'tenant_isolation') THEN
      -- current_setting returns '' (not NULL) on a pooled connection that set it before.
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON rag.%I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), ''''))',
        name);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA rag TO rag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON rag.settings, rag.documents, rag.chunks TO rag_app;

-- Totals per tenant for the vendor console: counts only, never content. Owned by the migrating
-- superuser, so it reads across tenants; rag_app may call it but not query the rows themselves.
CREATE OR REPLACE FUNCTION rag.tenant_usage()
RETURNS TABLE (tenant text, documents bigint, text_bytes bigint, chunks bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, rag AS $$
  SELECT d.tenant_id, count(*), sum(d.text_bytes)::bigint,
    (SELECT count(*) FROM rag.chunks c JOIN rag.settings s ON s.tenant_id = c.tenant_id
      WHERE c.tenant_id = d.tenant_id AND c.version = s.version)
  FROM rag.documents d GROUP BY d.tenant_id ORDER BY d.tenant_id
$$;
REVOKE ALL ON FUNCTION rag.tenant_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rag.tenant_usage() TO rag_app;
