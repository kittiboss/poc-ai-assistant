# Architecture

## Boundaries

One installation represents one enterprise customer. There is no centralized multi-tenant control plane.

```text
┌──────────────┐       OIDC + PKCE       ┌──────────────┐
│ Next.js web  │◄───────────────────────►│   Keycloak   │
└──────┬───────┘                         └──────────────┘
       │ Bearer JWT / REST / streamed SSE
       ▼
┌──────────────┐    OpenAI-compatible    ┌──────────────┐
│ NestJS API   │────────────────────────►│   LiteLLM    │
│ policy layer │                         └──────┬───────┘
└──┬────────┬──┘                                │
   │        │                         ┌──────────┴──────────┐
   ▼        ▼                         ▼                     ▼
PostgreSQL Valkey                mock provider       Ollama (profile)
```

The browser never receives provider credentials and never calls a model provider. `GatewayService` is the only inference boundary used by application logic, so replacing LiteLLM does not require frontend or conversation-domain changes.

## Authentication and authorization

The web client uses Authorization Code Flow with S256 PKCE. The API obtains the signing keys from Keycloak’s internal container URL but validates the public issuer, `enterprise-ai-api` audience, signature, and expiration. It derives the subject and roles only from verified claims.

On authenticated requests, the API mirrors the Keycloak subject and current roles to PostgreSQL. Passwords remain in Keycloak. Conversation queries always include the mirrored user ID; foreign user-supplied IDs cannot override it. Admin controller metadata is enforced by a global guard.

## Chat lifecycle

1. The API checks conversation ownership, model state, role/user permission, and external-provider gates.
2. A unique request ID and `STREAMING` assistant message are persisted before inference.
3. The last 50 messages go through the gateway abstraction to LiteLLM.
4. Tokens stream as SSE `token` events. Client disconnect aborts the gateway request.
5. Completion, interruption, or error is persisted without discarding partial content.
6. Usage is upserted by unique request ID with the pricing version and a complete price snapshot.

The mock exposes an OpenAI-compatible endpoint, but the API never calls it directly. LiteLLM performs the route.

## Data and pricing

PostgreSQL owns application state. LiteLLM has no application-table access and no gateway database in this POC, keeping schemas logically separated.

`PricingVersion` rows are append-only through application APIs. `UsageRecord` references the version used and stores decimal cost/charge snapshots, so later changes cannot alter history. Monetary arithmetic uses `big.js`; database values use `DECIMAL(24,12)`.

Provider cost and customer charge are independent columns. Local models force actual external cost to zero. Simulation has separate provider/customer values and no invoice path.

Conversation deletion is a soft delete so usage and immutable pricing references remain intact. User lists and ownership reads exclude deleted conversations.

## Provider safety

The active LiteLLM file contains only `local-mock` and optional local Ollama. External registry rows start disabled. External use needs the global switch, a matching credential, an active gateway route, an enabled registry row, and user permission. The default network and test path therefore cannot accidentally spend paid API credits.

## Repository layout

```text
apps/web/              Next.js UI and local shadcn-style primitives
apps/api/              NestJS REST/SSE API and Prisma domain logic
apps/mock-provider/    Offline OpenAI-compatible deterministic provider
packages/shared/       Shared pricing/token logic
apps/api/prisma/       Schema, migration, and seed
infra/keycloak/        Importable development realm
infra/litellm/         Active local routes and disabled external examples
scripts/               Live end-to-end smoke verification
```

This keeps deployment-specific configuration out of business modules while retaining one straightforward local workspace.

