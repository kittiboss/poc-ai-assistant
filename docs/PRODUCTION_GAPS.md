# Production gap analysis

This repository is an enterprise-shaped POC, not a production security or billing system.

## Must change before production

- Replace all development credentials and move secrets to the customer’s secret manager.
- Terminate TLS at an approved ingress, use strict HTTPS/host settings, and narrow redirect origins/CORS.
- Upgrade to a currently supported Keycloak release validated on the target runtime. The local Compose file pins Keycloak 24/Java 17 only because Java 21 ARM images crash on the tested older Apple Docker virtualization.
- Configure Keycloak with a production PostgreSQL database, backups, recovery, HA expectations, MFA, corporate federation, and session policy.
- Pin container images by reviewed digest; add image signing, SBOM generation, vulnerability gates, and patch operations.
- Disable Swagger UI (`SWAGGER_ENABLED=false`) and the `enterprise-ai-swagger` Keycloak client, or restrict them to an internal network. `@nestjs/swagger` 11.x (the line compatible with NestJS 11) pulls `js-yaml` 5.3.0 (GHSA-2883-xcg3-v3hh, moderate); the POC serves only the JSON spec, so the YAML serializer is never invoked, and the advisory concerns parsing, which Swagger does not do. Upgrade to NestJS 12 / `@nestjs/swagger` 12 to clear it.
- Replace in-memory throttling with a Valkey-backed distributed limiter; add per-user/model/department budgets and concurrency controls. The external daily ceiling is installation-wide and check-then-act, so concurrent requests can overshoot it slightly.
- Add provider billing guardrails outside the application: provider-side budgets/alerts and, for paid tiers, hard quota caps. The POC cannot read a provider project's billing status; its $0 guarantee for Gemini depends on the operator using a free-tier project without a billing account.
- Give OpenAI and Anthropic the same credential-proxy + allowlist treatment as Gemini before enabling them.
- Add a production job/outbox strategy for audit/usage durability across abrupt process loss.
- Define retention, legal hold, export/deletion, data residency, encryption, and backup policies.
- Add centralized metrics/traces/security events without logging prompt or response bodies by default.
- Add browser CSP/security headers, ingress request limits, WAF controls where appropriate, and formal threat modeling.
- Perform penetration testing and dependency/container/license review.

## Billing limitations

- Simulation creates no bill, payment, tax, credit, refund, subscription, or accounting record.
- Provider usage can be estimated when metadata is absent; production reconciliation must compare provider statements.
- Cached-token tiers and provider-specific fees are configurable but need provider-specific metadata adapters before authoritative billing.
- Currency conversion, effective-time approval workflows, account contracts, and invoice-grade rounding policy are not implemented.

## Platform limitations

- Single-customer/single-installation architecture only; this is intentional.
- No RAG, agents, connectors, BYOK workflow, department budgets, license enforcement, or subscription plans yet.
- No attachment ingestion, malware scanning, DLP, moderation policy, or data-classification workflow.
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
5. Add RAG and enterprise integrations behind the existing gateway and authorization boundaries.
