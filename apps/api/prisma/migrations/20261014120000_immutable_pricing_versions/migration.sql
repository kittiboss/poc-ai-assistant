-- Pricing versions are append-only. Usage records reference them for historical
-- charges, so the database itself rejects edits and deletions, not just the API.
CREATE FUNCTION "reject_pricing_version_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PricingVersion rows are immutable; create a new version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PricingVersion_immutable"
  BEFORE UPDATE OR DELETE ON "PricingVersion"
  FOR EACH ROW EXECUTE FUNCTION "reject_pricing_version_change"();
