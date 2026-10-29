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
| Customer A | http://localhost:3100 | `tenant-admin` / `TENANT_ADMIN_PASSWORD` from `deploy/tenants/a.env`; users `user-1` / `USER_1_PASSWORD`, `user-2` / `USER_2_PASSWORD` |
| Customer B | http://localhost:3200 | Same usernames, unique passwords in `b.env` |
| Customer C | http://localhost:3300 | Same usernames, unique passwords in `c.env` |
| Keycloak admin | http://localhost:8180 | `admin` / `KEYCLOAK_ADMIN_PASSWORD` from platform `.env` |

Secrets are generated randomly, stored owner-readable only, ignored by Git, and never printed by provisioning commands. Customer containers receive only their gateway credential, database password and realm settings—not provider/master/vendor credentials. There are no demo users in new customer realms. On upgrading an existing POC realm, `admin`, `employee1`, and `employee2` are disabled (not deleted); their historical data is preserved. Each realm gets its own `tenant-admin` (ADMIN) plus the accounts listed under `users` in `deploy/tenants/<id>.json` (each `{ "username", "name", "roles" }`, roles from `ADMIN`/`USER`; the checked-in customers have `user-1` and `user-2` with `USER`). `tenant:create` creates missing accounts, keeps their app roles as listed and never changes an existing password; each password is `<USERNAME>_PASSWORD` in the customer's `.env`. The list stays in the provisioning script and is not sent to vendor-control.

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

## Central knowledge base (RAG engine)

Every customer's documents live in one central service, `apps/rag-engine`, backed by `rag-db` (pgvector). Each customer only ever reaches its own data.

```text
Customer web /knowledge ─► Customer API ─(platform credential)─► rag-engine ─► rag-db (row-level security)
   upload, settings         extracts text, embeds via               stores, chunks, versions, searches
                            vendor-control (metered)                       │
                                                                           └─► vendor-control GET /customer/rag (tenant + limits)
Vendor console ─► vendor-control ─(RAG_ADMIN_KEY)─► rag-engine /admin (usage totals, purge)
```

- **Isolation.** The tenant is taken from the credential the customer API presents, never from a request field. Every query filters by tenant, and PostgreSQL row-level security binds the engine's role (`rag_app`: not a superuser, no BYPASSRLS) to the tenant of each transaction. A query without that context sees no rows, and composite foreign keys keep a passage inside its tenant. The vendor console only receives counts.
- **Vendor limits** (console → *Knowledge (RAG) limits*, stored in `vendor.tenants.rag`) control: on/off, embedding models (also limited by the tenant's model plan), file types (CSV, TXT, MD, PDF), maximum documents, file MB, stored text MB, passages per document and in total, and maximum top-K. `deploy/tenants/<id>.json` seeds them once; after that, re-running `tenant:create` or `tenant:rotate` keeps the console's values.
- **Customer settings** (customer app → *Knowledge base*, ADMIN only) control: embedding model, top-K, minimum score, chunk size (400–2000 characters) and overlap (≤ 40%), all within the vendor's limits. Lowered limits apply at once (the engine caches them for up to 30 s). Changing the model or chunking re-chunks the stored text into a new index version, and chat keeps the previous version until the new one is complete.
- **Files** are parsed in the customer's deployment by the existing bounded extractor, and only their text reaches the engine. PDF pages keep page numbers for citations. A CSV becomes one passage per row; the product catalog's columns keep the catalog passage format.
- **Embedding and credit.** The customer API embeds passages (`rag-index:<uuid>`) and questions (`<request>:retrieval`) through vendor-control, so they are charged to that customer's credit, count against its quotas and LiteLLM rate share, and appear in its usage and billing pages. With an external embedding model, the kill switch and sensitive-information review apply at upload, at model change and at search. Indexing pauses with a reason (credit used up, external providers paused, daily limit, rate limit). It resumes on retry, after a top-up, or when the limit resets.
- **Removal.** `tenant:down -- <id> --remove` also purges the customer's knowledge.

## Quotas and no-paid-call boundaries

The three checked-in tenant configs divide sample per-minute limits and daily external request/token limits. **These are example allocations, not authoritative current provider quotas.** Check the relevant provider console before enabling external models. Shared account quotas and other API users can still cause 429 responses; applications do not retry with paid fallbacks.

**Usage bars.** The customer app shows each model's use today (UTC) against its limits in the chat model picker, the admin Overview and the live usage page, from `GET /api/usage/models`. The bars count what admission counts (completed requests plus reservations of running ones) against an administrator's MODEL quota, or, for an external model without one, the shared daily external limit (how full it is for every external model, with the model's own use in the label). The vendor console's **Model usage today** table shows the same day per customer and model from the credit ledger (`GET /admin/usage/today`), leaving out calls the provider rejected. Provider free-tier quotas are not shown: Groq reports them only in response headers, Gemini has no API for them, and the proxies do not keep those headers. A request reserves its input in bytes plus the maximum reply, so a message can be refused while a bar still shows room: the refusal (HTTP 429, code `QUOTA_EXCEEDED`) carries what the message needed, what was left, the limit and the reset time. The chat says so in those numbers, and the bar of that limit turns red with the amount the message needed until one goes through.

Mock chat/embedding run fully offline and consume only simulated credit. Using an external model still contacts its provider and uses its free-tier allowance; simulated billing does not make a paid provider free. Gemini requires a free-tier project without paid billing; Groq additionally requires the operator's `GROQ_FREE_TIER_CONFIRMED=true` attestation; OpenRouter remains free-router-only. This app cannot independently verify a provider account's billing plan. All verification described below uses mocks only.

## Verify

```bash
npm test
npm run test:vendor
npm run test:vendor:integration
npm run test:rag-engine
npm run test:rag-engine:integration
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
- RAG engine integration tests also use their own temporary database, on `rag-db`, connected as `rag_app`. They verify isolation (listing, search, edits by ID, forged rows, no-context reads), every vendor limit, version switching, stale vectors, pause/resume, a small tenant beside a large one in the same HNSW index, and purge.
- `tenant:smoke -- a --rag` uploads TXT, MD, PDF and CSV documents with conflicting facts to customers a and b (`--with <id>` picks the second). It checks that each customer's chat cites only its own documents, including a PDF page. It also checks the embedding ledger entries, that a vendor-lowered top-K is clamped, and that a chunking change switches the index version. It refuses any embedding model other than `mock-embedding` and deletes its uploads afterwards. The browser smoke verifies vendor/customer pages, mock top-up, mobile layout and browser errors using an installed Chrome (`CHROME_PATH` override supported).

## Production exclusions

Verification on 2026-10-22: 136 unit/regression tests passed (Ollama and the separately run vendor integration suite are skipped by the default command); all 14 vendor integration tests passed. All three tenant smoke tests, mock RAG over 200 catalog products, real-browser desktop/mobile checks, API/web builds, web typecheck/lint, and key rotation/revocation with preserved balance passed. The production dependency audit still reports 9 inherited low/moderate advisories (0 high/critical); no unrelated major dependency upgrades were made. These checks do not constitute production certification.

Central knowledge base verification, also on 2026-10-22, used mock models only:
- RAG engine unit tests passed, and all 12 integration checks passed as `rag_app` on `rag-db`.
- 16 vendor integration tests passed.
- `tenant:smoke -- a --rag` and `-- b --rag` passed. Each customer cited only its own TXT/MD/PDF/CSV documents, including the PDF page. A vendor-lowered top-K was clamped, a chunking change switched the index version, and the embedding requests appeared in each ledger.
- The browser smoke passed for the console limits and the `/knowledge` page (upload, ready, delete, mobile).
- `rag-db` and the engine used about 95 MB together.

No real payment processing, invoices/tax, refunds, provider invoice reconciliation, cloud deployment, MFA/federated vendor administration, guaranteed uptime/SLA, cross-host HA or automated backups are provided. Basic Auth and localhost HTTP are for this local POC only. Use TLS, a vendor identity role, production database roles, secret management, backups/restore tests, distributed provider quota controls and security review before deployment. See [production gaps](PRODUCTION_GAPS.md).
