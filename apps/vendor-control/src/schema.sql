CREATE SCHEMA IF NOT EXISTS vendor;
CREATE TABLE IF NOT EXISTS vendor.tenants (
  id text PRIMARY KEY, name text NOT NULL, token_hash text UNIQUE,
  enabled boolean NOT NULL DEFAULT true, config jsonb NOT NULL,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Knowledge (RAG) limits, set by the vendor console. Kept out of config, which tenant:create rewrites.
ALTER TABLE vendor.tenants ADD COLUMN IF NOT EXISTS rag jsonb;
CREATE TABLE IF NOT EXISTS vendor.prices (
  id bigserial PRIMARY KEY, model text NOT NULL,
  input_rate bigint NOT NULL, output_rate bigint NOT NULL,
  input_cost bigint NOT NULL, output_cost bigint NOT NULL,
  strategy text NOT NULL, markup integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vendor.requests (
  tenant text NOT NULL REFERENCES vendor.tenants(id), request_id text NOT NULL,
  model text NOT NULL, kind text NOT NULL, price_id bigint NOT NULL REFERENCES vendor.prices(id),
  reserved bigint NOT NULL, state text NOT NULL DEFAULT 'PENDING',
  input_tokens integer, output_tokens integer, charge bigint, cost bigint,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  PRIMARY KEY(tenant, request_id)
);
CREATE TABLE IF NOT EXISTS vendor.ledger (
  id bigserial PRIMARY KEY, tenant text NOT NULL REFERENCES vendor.tenants(id),
  reference text NOT NULL, kind text NOT NULL, amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant, reference)
);
CREATE INDEX IF NOT EXISTS vendor_ledger_history ON vendor.ledger(tenant, id DESC);
CREATE INDEX IF NOT EXISTS vendor_requests_pending ON vendor.requests(tenant) WHERE state = 'PENDING';
CREATE OR REPLACE FUNCTION vendor.reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Vendor credit ledger and pricing versions are append-only'; END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='vendor_ledger_immutable') THEN
    CREATE TRIGGER vendor_ledger_immutable BEFORE UPDATE OR DELETE ON vendor.ledger FOR EACH ROW EXECUTE FUNCTION vendor.reject_history_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='vendor_prices_immutable') THEN
    CREATE TRIGGER vendor_prices_immutable BEFORE UPDATE OR DELETE ON vendor.prices FOR EACH ROW EXECUTE FUNCTION vendor.reject_history_change();
  END IF;
END $$;
