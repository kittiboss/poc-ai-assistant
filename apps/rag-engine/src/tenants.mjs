// Resolves a tenant from the credential its deployment presents. vendor-control is the only
// authority: it answers GET /customer/rag with the tenant id and the vendor's knowledge limits.
// Results are cached by the credential's hash (never the credential itself, never logged).
import { createHash } from "node:crypto";
import { Fault } from "./errors.mjs";

const MAX_ENTRIES = 1000;

export class Tenants {
  constructor({ vendorUrl, fetchVendor = fetch, ttlMs = 30_000, failureTtlMs = 5_000, now = Date.now }) {
    if (!vendorUrl) throw new Error("VENDOR_CONTROL_URL is required");
    Object.assign(this, { vendorUrl, fetchVendor, ttlMs, failureTtlMs, now });
    this.cache = new Map();
  }

  async resolve(key) {
    if (typeof key !== "string" || !key.startsWith("sk-") || key.length < 20)
      throw new Fault(401, "unauthorized", "A tenant credential is required");
    const id = createHash("sha256").update(key).digest("hex");
    const cached = this.cache.get(id);
    if (cached && cached.expires > this.now()) {
      if (cached.error) throw cached.error;
      return cached.value;
    }
    try {
      const value = await this.lookup(key);
      this.remember(id, { value, expires: this.now() + this.ttlMs });
      return value;
    } catch (error) {
      // A revoked key stays refused briefly; an outage is retried on the next request.
      if (error.status === 401) this.remember(id, { error, expires: this.now() + this.failureTtlMs });
      throw error;
    }
  }

  async lookup(key) {
    let response;
    try {
      response = await this.fetchVendor(`${this.vendorUrl}/customer/rag`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Fault(503, "vendor_unavailable", "Tenant directory is unavailable");
    }
    if (response.status === 401)
      throw new Fault(401, "unauthorized", "Invalid or suspended tenant credential");
    if (!response.ok) throw new Fault(503, "vendor_unavailable", "Tenant directory is unavailable");
    const body = await response.json();
    if (typeof body.tenant !== "string" || !body.limits)
      throw new Fault(503, "vendor_unavailable", "Tenant directory returned an invalid answer");
    return body;
  }

  remember(id, entry) {
    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(id, entry);
  }
}
