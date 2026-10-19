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

API documentation is generated from the controllers and DTOs with `@nestjs/swagger` and served at `/api/docs`. Swagger UI uses its own public Keycloak client (`enterprise-ai-swagger`, PKCE, redirect limited to the docs page), so documentation logins get exactly the same token validation and RBAC as the web client. A unit test fails if a route lacks an operation summary, a documented response, or a security requirement.

## Chat lifecycle

1. The API checks conversation ownership, model state, role/user permission, and external-provider gates.
   With **Product catalog** on, the question is then embedded and the most similar products are retrieved, before anything is persisted, so a failed search leaves no half-written turn.
2. A unique request ID and `STREAMING` assistant message are persisted before inference.
3. The last 50 messages go through the gateway abstraction to LiteLLM. Failed and empty turns stay in the user's history but are never replayed to a provider (some providers reject empty content).
4. Tokens stream as SSE `token` events. Client disconnect aborts the gateway request.
5. Completion, interruption, or error is persisted without discarding partial content.
6. Usage is upserted by unique request ID with the pricing version and a complete price snapshot.

SSE streams do not survive an API restart. A sweep at startup and every minute marks assistant messages still `STREAMING` after 10 minutes (longer than any gateway timeout) as `INTERRUPTED`.

The mock exposes an OpenAI-compatible endpoint, but the API never calls it directly. LiteLLM performs the route.

## Data and pricing

PostgreSQL owns application state. LiteLLM has no application-table access and no gateway database in this POC, keeping schemas logically separated.

`PricingVersion` rows are append-only: the API only inserts, and a database trigger rejects `UPDATE` and `DELETE`. `UsageRecord` references the version used and stores decimal cost/charge snapshots, so later changes cannot alter history. Monetary arithmetic uses `big.js`; database values use `DECIMAL(24,12)`.

Provider cost and customer charge are independent columns. Local models force actual external cost to zero. Simulation has separate provider/customer values and no invoice path.

Conversation deletion is a soft delete so usage and immutable pricing references remain intact. User lists and ownership reads exclude deleted conversations.

## Product catalog retrieval

The `products` table follows the supplied `schema.sql` exactly. Each product is rendered to one passage (stock and status spelled out in words so natural questions match them) and stored in `KnowledgeChunk` with a `vector(768)` embedding and an HNSW cosine index (pgvector, built into the `postgres:17-alpine` image so existing volumes keep their collation behaviour). Rows are keyed by source, item and embedding model, with a hash of the exact embedded text, so indexing re-embeds only new or changed products and removes passages of deleted ones.

Embeddings go through `GatewayService.embed` → LiteLLM `/v1/embeddings`, like chat. `mock-embedding` (signed feature hashing in the mock provider) keeps development and tests offline; `gemini-embedding` reaches Gemini Embedding 2 only through the credential proxy. Model capabilities in the registry drive provider differences: `embedding` keeps a model out of chat, `task-prefix` adds Gemini Embedding 2's query/document prefixes, `output-dimensions` requests 768-d vectors.

Every embedding call takes a governance reservation, is metered as usage with operation `EMBEDDING` (conversation-less for indexing), and releases the reservation. External indexing runs in the background, paced to the provider's per-minute quota, and reports progress through `GET /knowledge/status`. Retrieved passages join workspace document citations as `[S#]` references marked as untrusted data.

## Provider safety

The active LiteLLM file contains only `local-mock` and optional local Ollama. External registry rows start disabled. External use needs the global switch, a matching credential, an active gateway route, an enabled registry row, and user permission. The default network and test path therefore cannot accidentally spend paid API credits.

The opt-in Gemini, Groq and OpenRouter overlays add routes through credential proxies:

```text
NestJS ──► LiteLLM (internal network only) ──► gemini-proxy ──► generativelanguage.googleapis.com
                                               holds the key, sends it as a header
                                               allows only text generation for GEMINI_MODEL
                                               rejects tools / grounding / cached content
                                               clamps output tokens, forces one candidate

                                         └──► groq-proxy ──► api.groq.com
                                               holds the key, replaces the dummy authorization header
                                               fails closed until Free tier is explicitly confirmed
                                               allows only chat completions for GROQ_MODEL
                                               rejects tools / functions / other endpoint families
                                               clamps output tokens, forces one response

                                         └──► openrouter-proxy ──► openrouter.ai
                                               holds the key, allows only openrouter/free
                                               rejects paid model/fallback/provider overrides
                                               rejects tools / plugins / web search / other endpoints
                                               clamps output tokens, forces one response
```

The API also enforces an installation-wide daily request and token ceiling across all external providers, computed from usage records, before a request is persisted or streamed. Model availability checks read LiteLLM's configured routes and Ollama's local tag list; they never call a provider.

## Repository layout

```text
apps/
  api/                    NestJS REST/SSE API
    prisma/               schema, migrations (incl. pricing immutability trigger), seed
      data/               products.csv and schema.sql (product catalog source)
    src/
      main.ts, app.module.ts
      common/
        auth/             JWT guard, @Public/@Roles/@CurrentUser
        prisma/           PrismaService (global module)
        swagger/          OpenAPI setup, shared doc decorators and schema types
      users/              mirror of the Keycloak subject and roles
      audit/              append-only audit log (writes + admin listing)
      gateway/            the only inference boundary (LiteLLM client)
      pricing/            versioned pricing, preview, version-in-effect lookup
      usage/              usage records, price snapshots, external daily limits
      models/             registry, provider/permission policy, availability
      conversations/      conversation CRUD and SSE chat (ChatService)
      knowledge/          product catalog import, embedding index, retrieval (pgvector)
      admin/              aggregate dashboard, user permissions, admin routes
      health/             public liveness endpoint
      testing/            unit-test fixtures (excluded from the build)
    test/                 vitest setup (offline network guard)
  web/                    Next.js app
    app/                  routes (/ and /c/[id] for chat, /usage, /usage/live, /admin, /settings), root layout and providers
    features/             one folder per screen: chat, usage, admin, settings
    components/           shared: auth (OIDC provider, gate), brand (provider, logo), layout (shell, theme and language switchers), ui (charts, section and metric cards, status tags), api (typed client provider)
    config/brands/        one file per customer brand, selected with NEXT_PUBLIC_BRAND at build time
    theme/                AntD theme from the brand, --app-* CSS variables, light/dark/system mode, bundled fonts
    i18n/                 next-intl setup (locale cookie, AntD locales, formats, browser time zone)
    messages/             UI texts per language (en, th)
    stores/               Zustand UI state (navigation drawer, chosen model, active stream, session notice)
    lib/                  API client and types generated from the OpenAPI document, auth helpers, small helpers
  mock-provider/          offline OpenAI-compatible deterministic provider
  gemini-proxy/           opt-in credential proxy and cost allowlist for Gemini
  groq-proxy/             opt-in credential proxy and cost allowlist for Groq
  openrouter-proxy/       zero-price router enforcement and credential proxy
packages/shared/          pricing and token logic shared by API and web
infra/postgres/           postgres:17-alpine with pgvector compiled in
infra/keycloak/           importable development realm
infra/litellm/            active local routes and disabled external examples
scripts/                  e2e/provider smoke tests, Keycloak client sync
docs/                     architecture and production gap analysis
```

Reasons for this layout:

- **Feature modules in the API.** Each folder owns its controller, service, DTOs (`*.dto.ts`) and OpenAPI response schemas (`*.schemas.ts`), and is a Nest module that exports only its service. Dependencies point one way (`admin` → `models` → `usage` → `pricing`; `conversations` → `models`/`usage`/`gateway`), so a future feature (RAG, agents, budgets) is a new folder, not more lines in a shared service. Pure rules (`model-policies.ts`, `external-limits.ts`, `chat-history.ts`) are plain functions next to the module that owns them, and are unit-tested without Nest.
- **Tests next to the code.** `*.test.ts` sits beside the file it covers; shared fixtures live in `src/testing/` and are excluded from the production build.
- **Routes stay thin in the web app.** `app/` only composes an auth gate and a feature, so moving to different routing or adding pages doesn't touch feature code. The chat's `/` (new chat) and `/c/<id>` share one layout, so switching chats or creating one keeps a streaming reply alive.
- **Server data and UI state are kept apart in the web app.** API data goes through TanStack Query (`features/*/…-queries.ts`) with a typed client generated from the API's OpenAPI document; state that only the UI cares about lives in a Zustand store. A request refused with 401 renews the token once and is repeated; if that fails, the user is signed out and returned to the same page after signing in again.
- **One brand source in the web app.** Everything that changes per customer (name, logo, favicon, colors, radius, font, default language) lives in `config/brands/<id>.ts`. Only the root layout calls `getBrand()`; it passes the brand to `<BrandProvider>` and client components read it with `useBrand()` (an ESLint rule rejects other imports). Loading a brand at runtime later, for example from a mounted file, therefore changes `getBrand()` only.
- **One set of theme tokens.** Ant Design tokens generated from the brand are the only color source: AntD components read them through `ConfigProvider`, and the same tokens are emitted as `--app-*` CSS variables that Tailwind maps to classes such as `bg-primary` or `text-fg-secondary`. The chosen mode sits in a cookie, so the server renders the right theme and an inline script covers the first visit and `system` mode without a flash.
- **Dockerfiles stay with each app** instead of a central `infra/docker/`: each image builds from the repository root (for the shared workspace package) but is owned and versioned with the app it packages. `infra/` holds only deployment configuration (identity realm, gateway routes) that a customer environment would replace.
