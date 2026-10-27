# Production gap analysis

This repository is an enterprise-shaped POC, not a production security or billing system.

## Must change before production

- Replace all development credentials and move secrets to the customer’s secret manager.
- Terminate TLS at an approved ingress, use strict HTTPS/host settings, and narrow redirect origins/CORS.
- Upgrade to a currently supported Keycloak release validated on the target runtime. The local Compose file pins Keycloak 24/Java 17 only because Java 21 ARM images crash on the tested older Apple Docker virtualization.
- Configure Keycloak with a production PostgreSQL database, backups, recovery, HA expectations, MFA, corporate federation, and session policy.
- Pin container images by reviewed digest; add image signing, SBOM generation, vulnerability gates, and patch operations.
- Disable Swagger UI (`SWAGGER_ENABLED=false`) and the `enterprise-ai-swagger` Keycloak client, or restrict them to an internal network. `@nestjs/swagger` 11.x (the line compatible with NestJS 11) pulls `js-yaml` 5.3.0 (GHSA-2883-xcg3-v3hh, moderate); the POC serves only the JSON spec, so the YAML serializer is never invoked, and the advisory concerns parsing, which Swagger does not do. Upgrade to NestJS 12 / `@nestjs/swagger` 12 to clear it.
- Replace in-memory HTTP throttling with a Valkey-backed distributed limiter. POC chat quota admission is serialized in PostgreSQL and reserves estimated tokens/cost, but production still needs load-tested distributed concurrency controls, provider reconciliation, and retry/idempotency policy.
- Add provider billing guardrails outside the application: provider-side budgets/alerts and, for paid tiers, hard quota caps. The POC cannot read a provider project's billing status; its $0 guarantee for Gemini depends on the operator using a free-tier project without a billing account.
- The Groq integration fails closed until an operator attests that its organization is on Free tier, but this is not machine-verifiable from an API key. Reconfirm after organization/billing changes; paid plans need provider-side spend limits and accurate pricing configuration.
- OpenRouter is pinned to its zero-price free router and blocks paid fallback, but the selected underlying model and its retention/training policy can vary per request. Production workloads need an approved fixed provider/model and contractual data controls.
- Give OpenAI and Anthropic the same credential-proxy + allowlist treatment as Gemini before enabling them.
- Add a production job/outbox strategy for audit/usage durability across abrupt process loss.
- Define retention, legal hold, export/deletion, data residency, encryption, and backup policies. The POC's hourly retention sweep only purges inactive chat text, citations, and feedback; project documents, explicit memories, and usage records have separate lifecycles.
- Add centralized metrics/traces/security events without logging prompt or response bodies by default.
- Add browser CSP/security headers, ingress request limits, WAF controls where appropriate, and formal threat modeling.
- Perform penetration testing and dependency/container/license review.

## Billing limitations

- Simulation creates no real bill, payment, tax invoice, refund or subscription. Vendor-managed mode has a durable **test-credit** ledger, SIM receipts, reservation/settlement and mock top-ups; these are not financial accounting records or provider-invoice reconciliation.
- Provider usage can be estimated when metadata is absent; production reconciliation must compare provider statements.
- Cached-token tiers and provider-specific fees are configurable but need provider-specific metadata adapters before authoritative billing.
- Currency conversion, effective-time approval workflows, account contracts, and invoice-grade rounding policy are not implemented.

## Platform limitations

- Single-customer/single-installation architecture only; this is intentional. The vendor-managed POC hosts one such installation per customer; there is no shared multi-tenant database.
- Vendor-managed POC: customer APIs share an internal network with Keycloak and vendor-control (production needs a network per customer). Scripts provision on one Docker host; console registration needs explicit host activation, avoiding a web-accessible Docker socket. Vendor console authentication is a localhost-only Basic Auth secret, not production RBAC/MFA.
- Central PostgreSQL reservations prevent concurrent overspend of test credit. Missing final usage is conservatively estimated, and crash-orphaned reservations need explicit operator reconciliation. Provider invoice reconciliation, invoice-grade tokenization and transactional outbox durability between tenant records and central ledger are still needed. The tenant's local usage dashboard may omit a cancelled request whose debit exists centrally; the central ledger is authoritative.
- Central knowledge base (vendor-managed POC): one engine and one database serve every customer. Row-level security plus explicit tenant filters isolate the rows, but there is no per-customer database, encryption key or network, and no backup/restore per tenant. The engine resolves tenants through vendor-control (cached 30 s), so a suspension or limit change takes up to 30 s to apply there. Text extraction runs in each customer API and the engine trusts its extracted sections. There is no OCR, no hybrid keyword search or reranker, no per-document or per-role access (every signed-in user of the organization can retrieve every enabled document), and no charge for storage. Indexing is driven by an in-process loop in each customer API. Running several API replicas needs a distributed lock, otherwise passages may be embedded twice. While a settings change re-indexes, newly uploaded documents become searchable only when the new version completes.
- Project-document RAG is PostgreSQL full-text/substring retrieval over bounded, locally extracted text. It has no embeddings, OCR, semantic ranking, citation-grounding evaluation, document versioning, or enterprise search connectors.
- Product-catalog RAG returns the top-k most similar products. Questions over the whole table (counts, totals, "all out-of-stock items", price ranges) need SQL-backed answers (text-to-SQL or structured filters), and ranking would benefit from hybrid keyword search, a reranker, and an evaluation set.
- The catalog is visible to every signed-in user, including cost price. Add field-level and per-collection access control before mixing data of different sensitivity.
- Indexing state lives in the API process (one run at a time per instance) and planning reads the whole catalog into memory. For large catalogs or multiple API replicas, move indexing to a durable job queue (Valkey/BullMQ worker) with a distributed lock and streamed planning.
- Gemini free-tier embeddings may be used by Google to improve its products, and the free tier's per-minute quota bounds indexing speed. Production needs a paid tier with appropriate data terms, or a self-hosted embedding model.
- POC document ingestion supports TXT/MD/CSV/JSON/text PDF/DOCX with size/page/count limits and an isolated parser worker. It has no malware scanning, content-disarm, DLP, classification workflow, or secure enterprise file connector.
- POC local tools are explicitly invoked allowlisted functions, not an autonomous agent or arbitrary code/shell execution. There is no connector permission framework, BYOK workflow, license enforcement, or subscription plan.
- POC department/user/model/role quotas and simulated budgets are admission controls, not payment or invoice controls. Department and role totals use current membership rather than historical snapshots. Sensitive-content detection is regex best-effort, not enterprise DLP or moderation.
- Streaming recovery is request-oriented; it does not resume an SSE stream across API restarts. Abandoned messages are marked `INTERRUPTED`, but no usage record is written for a request lost mid-stream.
- Free-tier Gemini prompts and responses may be used by Google to improve its products; enterprise use requires a paid tier or a provider with appropriate data terms, plus a DLP/classification policy.
- Valkey is provisioned for the future shared cache/rate limiter but is not yet in the critical request path.
- Dashboards provide core totals and charts, not a full analytics warehouse or scheduled audit reports.
- Ollama capacity, model license, model provenance, and security must be assessed separately per customer. It is disabled in the default POC.

## Recommended commercialization sequence

1. Harden identity, secrets, TLS, audit export, backup/recovery, and supply chain.
2. Add deployment overlays for AWS, Azure, and supported on-prem Kubernetes distributions while preserving single tenancy.
3. Implement BYOK/provider onboarding with approval, connectivity tests, budgets, and kill switches.
4. Build invoice-grade usage reconciliation and contract/version governance.
5. Harden RAG and document ingestion, then add enterprise integrations behind the existing gateway and authorization boundaries.
