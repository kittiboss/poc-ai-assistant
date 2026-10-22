# Vendor-managed POC — phases 1 and 2 (simulation)

This implements the supplied vendor-managed roadmap through phase 2 **without collecting real money**. Phase 3 (cloud operations, production payments, legal terms, SLA and provider invoice reconciliation) is deliberately not implemented.

## Run

Requires Node 22+, Docker Compose, and the repo dependencies (`npm ci`). No local LLM is needed. On a small Docker VM, stop the platform and tenant services before image builds; do not remove volumes.

```bash
npm run platform:build
npm run platform:up
npm run tenant:create -- a
npm run tenant:create -- b
npm run tenant:create -- c
```

`platform:build` builds API/web once for reuse by every customer. `platform:up` generates `deploy/platform/.env` if missing, imports existing provider settings from the root `.env` once, and starts the corresponding optional proxies. With no provider keys, only mock models are entitled. A new tenant registered in the vendor console always starts **mock-only**.

| Interface | URL | Sign-in |
| --- | --- | --- |
| Vendor console | http://localhost:4050/console/ | Browser Basic Auth: `vendor` / `VENDOR_ADMIN_KEY` from `deploy/platform/.env` |
| Customer A | http://localhost:3100 | `tenant-admin` / `TENANT_ADMIN_PASSWORD` from `deploy/tenants/a.env` |
| Customer B | http://localhost:3200 | Same username, unique password in `b.env` |
| Customer C | http://localhost:3300 | Same username, unique password in `c.env` |
| Keycloak admin | http://localhost:8180 | `admin` / `KEYCLOAK_ADMIN_PASSWORD` from platform `.env` |

Secrets are generated randomly, stored owner-readable only, ignored by Git, and never printed by provisioning commands. Customer containers receive only their gateway credential, database password and realm settings—not provider/master/vendor credentials. There are no demo users in new customer realms. On upgrading an existing POC realm, `admin`, `employee1`, and `employee2` are disabled (not deleted); their historical data is preserved. Each realm gets its own `tenant-admin`.

The customer application's **Test credits & billing** menu (`/billing`, ADMIN only) shows available/reserved/spent credit, current sale prices, the latest 100 ledger entries and requests, and downloadable JSON SIM receipts. It refreshes every 5 seconds. Top-ups here only grant test credit, with no card, payment gateway, bank transfer or payment integration.

## Vendor operations

The localhost vendor console supports tenant balances/status, simulated costs and margins, test credit grants, suspension/resumption, current prices, immutable version history, request history and stale-reservation reconciliation.

Registering a tenant in the console creates a record and $2 opening test credit. Run the displayed `npm run tenant:create -- <id>` on the vendor host to generate the deployment config, provision its LiteLLM team/key and Keycloak realm, and start its own API/web/Postgres stack. This explicit host activation avoids exposing the Docker socket to a web service. Choose unique adjacent web/API ports. For custom model allowlists/rate shares, edit `deploy/tenants/<id>.json` and re-run the same command.

```bash
npm run tenant:status
npm run tenant:credits -- a 5
npm run tenant:rotate -- a
npm run tenant:down -- a
```

`tenant:rotate` issues a new team key, switches the ledger credential, saves the new tenant secret, revokes the old LiteLLM key and recreates the backend. It preserves credit/history. Suspension blocks new calls immediately but does not cancel already admitted work. `tenant:credits` appends a positive grant; the former `--set` override is intentionally removed. Fix an incorrect debit with a documented compensating grant, never by rewriting history.

`tenant:down` stops/removes containers but keeps their volumes. **Do not use `--remove` unless intentionally deleting that tenant's data and realm.** The central ledger is retained, and that tenant is suspended.

## Architecture and accounting

```text
Customer web → Customer API → vendor-control → LiteLLM → mock / credential proxies
                   │               │             │
              own Postgres    vendor schema    LiteLLM tables
                   │               └──── shared gateway Postgres ────┘
              Keycloak realm per tenant
```

- One deployment/database and one Keycloak realm per customer; one LiteLLM team per customer. The common image gets API/realm settings at runtime.
- Only `vendor-control` and Keycloak join `platform-shared`. LiteLLM, gateway Postgres and credential proxies are on the private gateway network. LiteLLM's admin port and the vendor console bind to host loopback only. No automatic paid/provider fallback is configured.
- **The authoritative balance is the central PostgreSQL ledger, not LiteLLM's asynchronously updated `spend`.** This intentionally strengthens the PDF's suggested `max_budget` approach: tenant key/team budgets are unset upstream to avoid two conflicting billing authorities. LiteLLM still enforces model entitlements and per-model RPM/TPM. Its YAML prices/spend are diagnostics only, not customer billing.
- Ledger amounts are integer billionths of a simulated USD; rates are USD per million tokens. Charges round up to a nanodollar. Database triggers reject updates/deletes of ledger entries and price versions. Each request captures its price version when admitted, so later changes never reprice history.
- Under a row lock per tenant, admission reserves a conservative text-input upper bound (UTF-8 bytes plus framing) and the requested maximum output tokens. All pending reservations count against available credit. Insufficient credit fails with `402 CREDIT_EXHAUSTED` **before** inference. Models cannot consume another tenant's balance; retrying a submitted request ID is rejected with 409.
- Completed chat and embeddings settle returned token usage, release unused reservation, and append a debit before the response is finalized. If unusual tokenization exceeds the bound, the vendor absorbs the difference; customer balances never become negative.
- A definite upstream rejection (including rate limits) releases the reservation without a charge. If the connection fails and final usage is unknown, the reserved maximum is charged and explicitly labelled `ESTIMATED`. Client disconnects do not stop server-side metering. This is a POC accounting policy, **not invoice-grade provider reconciliation**.
- A process crash retains pending reservations rather than releasing potentially consumed credit. The console's **Settle stale reservations** action settles requests older than 5 minutes at their reserved maximum, visibly as estimates. Investigate first; issue a compensating grant if appropriate.
- Top-ups require an idempotency reference; repeating the same amount/reference returns the same receipt. A conflicting reuse is 409. All receipts are `SIM-*`, marked test-only and not tax invoices. There is no automatic renewal/reset/overdraft.
- Chat and embedding calls propagate `X-Request-Id`. Rate-limited embedding retries use a `:retryN` suffix and remain separately traceable. Tenant usage uses the central charge when returned, but **the central request ledger remains authoritative** for cancelled/interrupted work or pre-migration usage.
- Customer JSON APIs and CSV exports omit provider-cost/markup/margin snapshots. Only vendor admins see cost assumptions. Local customer pricing editors are disabled in vendor mode. The standalone developer stack retains its pricing simulator.

### Upgrade and migrations

`vendor-control` applies the additive, idempotent `apps/vendor-control/src/schema.sql` migration at startup in a separate `vendor` schema of gateway Postgres. It does not change LiteLLM tables. Tenant APIs continue to run existing Prisma migrations on startup; no new tenant Prisma migration is needed.

On first registration of an existing tenant, the remaining LiteLLM credit is imported as one **opening balance**, then future activity uses the new ledger. Old usage is not invented/backfilled as individual debits, and new aggregate totals start from that opening balance. Re-running `tenant:create`, restarting containers or rotating keys never adds opening credit twice. Existing tenant data/volumes are preserved.

### Pricing

The console supports `PERCENTAGE_MARKUP` and `FIXED_RATE`, with separate input/output rates and version history:

```text
PERCENTAGE_MARKUP: sale rate = simulated provider rate × (1 + markupPercent / 100)
FIXED_RATE:       sale rate = explicitly configured input/output rate
request debit:    (input tokens × input sale rate + output tokens × output sale rate) / 1,000,000
simulated margin: test-credit consumption − simulated provider cost
```

Markup is not gross-margin percentage. Cost assumptions are scenario values, not verified provider invoices. Sale input rates must be positive; embedding output rates may be zero. New versions apply immediately to new requests only. Existing seed rates mirror the earlier gateway YAML so the upgrade does not silently change the initial sale prices.

## Quotas and no-paid-call boundaries

The three checked-in tenant configs divide sample per-minute limits and daily external request/token limits. **These are example allocations, not authoritative current provider quotas.** Check the relevant provider console before enabling external models. Shared account quotas and other API users can still cause 429 responses; applications do not retry with paid fallbacks.

Mock chat/embedding run fully offline and consume only simulated credit. Using an external model still contacts its provider and uses its free-tier allowance; simulated billing does not make a paid provider free. Gemini requires a free-tier project without paid billing; Groq additionally requires the operator's `GROQ_FREE_TIER_CONFIRMED=true` attestation; OpenRouter remains free-router-only. This app cannot independently verify a provider account's billing plan. All verification described below uses mocks only.

## Verify

```bash
npm test
npm run test:vendor
npm run test:vendor:integration
npm run tenant:smoke -- a
npm run tenant:smoke -- b
npm run tenant:smoke -- c
npm run tenant:smoke -- a --rag
node scripts/platform/vendor-browser-smoke.mjs
npm run typecheck -w @enterprise/web
npm run lint -w @enterprise/web
```

- Vendor unit tests check exact arithmetic, markup, input validation and routing-override stripping.
- Integration tests create/drop only their own randomly named temporary database in gateway Postgres. They verify concurrent admission, idempotency, immutable history, price snapshots, restart persistence, tenant isolation, role/endpoint boundaries, embeddings, streaming settlement, rejection/uncertain failure and immediate recovery after top-up. Upstream responses are in-process mocks.
- Tenant smoke tests log in through PKCE, create one mock conversation and a $0.01 **test-only** top-up, verify request-ID correlation and synchronous debit, and inspect JSON/CSV redaction and credential isolation. They do not reset real tenant credit or change provider quotas.
- The earlier `platform:smoke` remains a low-level LiteLLM diagnostic. Its asynchronous LiteLLM spend checks are not the new ledger's acceptance criteria.
- `tenant:smoke -- a --rag` incrementally indexes the existing catalog and checks cited mock chat plus both request-ledger entries; it refuses external embedding models. The browser smoke verifies vendor/customer pages, mock top-up, mobile layout and browser errors using an installed Chrome (`CHROME_PATH` override supported).

## Production exclusions

Verification on 2026-10-22: 136 unit/regression tests passed (Ollama and the separately run vendor integration suite are skipped by the default command); all 14 vendor integration tests passed. All three tenant smoke tests, mock RAG over 200 catalog products, real-browser desktop/mobile checks, API/web builds, web typecheck/lint, and key rotation/revocation with preserved balance passed. The production dependency audit still reports 9 inherited low/moderate advisories (0 high/critical); no unrelated major dependency upgrades were made. These checks do not constitute production certification.

No real payment processing, invoices/tax, refunds, provider invoice reconciliation, cloud deployment, MFA/federated vendor administration, guaranteed uptime/SLA, cross-host HA or automated backups are provided. Basic Auth and localhost HTTP are for this local POC only. Use TLS, a vendor identity role, production database roles, secret management, backups/restore tests, distributed provider quota controls and security review before deployment. See [production gaps](PRODUCTION_GAPS.md).
