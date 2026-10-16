# Enterprise AI Assistant — Local POC

A working, single-enterprise AI assistant built with Next.js, NestJS, Prisma/PostgreSQL, Keycloak, LiteLLM, Valkey, and Docker Compose.

The default deployment is deliberately **mock-only**. It needs no AI API key, makes no paid model call, starts no Ollama container, and downloads no model. Every chat request still follows the production-shaped path:

```text
Browser → Next.js → NestJS → LiteLLM → local mock provider
                    ├─ PostgreSQL
                    ├─ Keycloak
                    └─ Valkey
```

## Start locally

Requirements:

- Docker Desktop / Docker Engine with Compose v2
- Approximately 3–4 GB free RAM for the application infrastructure
- Ports `3000`, `3001`, and `8080` available

Start the default mock-only stack:

```bash
cp .env.example .env
docker compose up --build
```

The copy step is optional because Compose has safe local defaults. It is useful when changing development secrets.

Open:

- Web application: <http://localhost:3000>
- Keycloak: <http://localhost:8080>
- API health: <http://localhost:3001/api/health>
- API documentation (Swagger UI): <http://localhost:3001/api/docs>

Demo accounts:

| Username | Password | Roles |
|---|---|---|
| `admin` | `Admin123!` | `ADMIN`, `USER` |
| `employee1` | `Employee123!` | `USER` |
| `employee2` | `Employee123!` | `USER` |

These credentials are intentionally local and must never be reused outside this POC.

Stop the services without deleting history:

```bash
docker compose down
```

Delete local volumes and all POC data only when explicitly desired:

```bash
docker compose down --volumes
```

## What works

- Keycloak SSO via OIDC Authorization Code Flow with S256 PKCE
- JWT signature, issuer, audience, and expiration validation
- `ADMIN` / `USER` RBAC and backend-enforced conversation ownership
- Conversation create/list/read/rename/delete, with persistence and soft deletion
- Deterministic mock responses and SSE streaming through LiteLLM
- Client cancellation with `INTERRUPTED` message and `CANCELLED` usage status
- Markdown, highlighted code, response copy, model selector, themes, errors, and loading states
- Model registry, role defaults, per-user overrides, availability, and enable/disable controls
- Idempotent request IDs and actual/estimated/synthetic token classification
- Decimal-safe provider cost and separate customer selling price
- Pass-through, percentage markup, fixed-rate, and simulation strategies
- Immutable pricing versions, usage price snapshots, and pricing/model audit logs
- User usage and aggregate admin dashboards; admin APIs never return chat content
- OpenAI/Anthropic registry placeholders and an opt-in Gemini route, all disabled by default
- Layered external-cost guardrails: credential proxy allowlist, output-token cap, daily request/token ceiling (see [Cost safety](#cost-safety))
- Admin console filters (date range, provider, model), per-day/provider/model charts, cost breakdown, model availability, pricing overview, and audit log
- Database-enforced immutability of pricing versions; abandoned streams are marked `INTERRUPTED` after an API restart

The mock provider supports deterministic test controls:

- `Explain Docker Compose` → `This is a mock AI response for local POC testing.`
- Include `[mock:error]` to return a simulated provider error.
- Include `[mock:timeout]` to simulate a slow provider.

Mock usage is always `SYNTHETIC`; actual provider cost is always `$0`. Pricing simulation is clearly separate and never creates an invoice.

## Branding and theme (web)

One installation serves one customer, so the brand is chosen when the web image is built:

```bash
NEXT_PUBLIC_BRAND=acme docker compose up --build -d frontend
```

`default` is the Enterprise AI look; `acme` is a fictional example brand. To add a customer brand:

1. Copy `apps/web/config/brands/acme.ts`, give it a new `id`, and register it in `apps/web/config/brands/index.ts`.
2. Put the logo and favicon in `apps/web/public/brands/<id>/`.
3. Build with `NEXT_PUBLIC_BRAND=<id>`. An unknown id fails the build rather than shipping another brand.

A brand sets the product name, organization, logo, favicon, primary color, corner radius, font (one of the fonts bundled in `apps/web/theme/fonts.ts`), default language, default theme mode, and optional Ant Design token overrides per mode. Fonts are committed to the repository, so builds need no internet access.

Users pick light, dark, or system theme and Thai or English on the **Settings** page (language also on the sign-in screen); both choices are stored in cookies. Colors in both Ant Design components and Tailwind classes come from the same brand tokens (see [Architecture](docs/ARCHITECTURE.md)).

## API types (web)

The web app's API client and types are generated from the API's OpenAPI document and committed (`apps/web/lib/api/schema.d.ts`). After changing an API route or DTO, start the API and run:

```bash
npm run api:types -w @enterprise/web
```

## Languages (web)

The web app is available in Thai and English. Texts live in `apps/web/messages/{en,th}.json`; TypeScript checks every key used in the code and fails if the two files do not have the same keys. Numbers, currency, and dates follow the selected language, and times are shown in each user's device time zone. The default language comes from the brand. Ant Design and Ant Design X use the matching locale (Thai strings for Ant Design X are in `apps/web/i18n/antd-locale.ts`). Sign-in passes the language to Keycloak as `ui_locales`, which takes effect only if the realm enables that language.

## Tests and verification

Install dependencies and run the offline/default test suite:

```bash
npm install
npm test
npm run build
```

With the Compose stack running, exercise real PKCE login, all three demo users, audience validation, RBAC, ownership isolation, LiteLLM streaming, persistence, and usage:

```bash
npm run test:e2e
```

The default suite never needs external credentials and has no active paid-provider route. The API test setup also replaces `fetch` with a guard that fails any non-loopback request, so a test cannot reach a paid provider even by mistake. The Ollama integration test remains skipped unless an operator explicitly supplies `OLLAMA_TEST_URL`. `npm run test:e2e` additionally checks the admin console APIs and the pricing example below (3,000 in / 700 out → `$0` actual, `$0.01` simulated provider cost, `$0.015` simulated charge).

## Using Google Gemini on the free tier

Gemini is the only external provider with a ready route. It stays off until you take every one of these steps; adding a key alone changes nothing.

1. **Use a key from a free-tier project.** In [Google AI Studio](https://aistudio.google.com/apikey), the project behind the key must be on the **Free** plan with **no billing account linked**. Google cannot charge a project that has no billing account; over-limit requests fail with HTTP 429 instead. If the project shows a paid tier, every request is billed: do not use that key here.
2. Put the credential and the switch in the ignored `.env` file (never in Git):

   ```dotenv
   GEMINI_API_KEY=your-key
   GEMINI_MODEL=gemini-3.5-flash-lite
   ENABLE_EXTERNAL_PROVIDERS=true
   ```

3. Start the stack with the Gemini overlay:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.gemini.yml up --build -d
   ```

4. Sign in as `admin` → **Admin console** → **Model registry** and enable **Gemini 3.5 Flash-Lite**. By default only `ADMIN` may use it; tick `USER` to open it to employees.

Free-tier prompts and responses may be used by Google to improve its products, and the chat UI shows a notice whenever an external model is selected. Do not send confidential data. Free-tier rate limits are per project and are shown in AI Studio; when they are hit, the chat shows a rate-limit message and local models keep working.

Usage is recorded as `ACTUAL` (Google's token counts). The seeded Gemini pricing records actual provider cost as `$0` (free tier) and sets the simulation rates to Google's published paid-tier list price for `gemini-3.5-flash-lite` ($0.30 input / $2.50 output per 1M tokens, checked 2026-10-14). Dashboards therefore show what the same usage *would* cost on a paid tier, clearly labelled as simulated. If the project's tier changes, create a new pricing version in the admin console.

Optional connectivity check: it validates the key with Google's model-list endpoint, briefly enables Gemini through the audited admin API, sends one streamed `Reply with exactly: GEMINI_OK` request, checks the persisted usage, and restores the registry state:

```bash
npm run test:gemini
```

Return to the default mock-only stack at any time:

```bash
docker compose up -d --force-recreate --remove-orphans litellm backend
```

## Cost safety

Everything in the default stack is local: the mock provider, Ollama, PostgreSQL, Keycloak, Valkey, and LiteLLM are open-source containers and make no paid calls. OpenAI and Anthropic have no gateway route and no credential. The only path that can reach a paid service is the opt-in Gemini overlay, and it is constrained in layers:

| Layer | What it prevents |
|---|---|
| Base `docker-compose.yml` has no external route; LiteLLM sits on an internal-only network | Any provider call in the default stack, including during startup, migrations, health checks, and model discovery |
| `ENABLE_EXTERNAL_PROVIDERS=true` **and** a server-side credential **and** an admin enabling the model **and** per-user permission | Accidental activation by just adding a key |
| `gemini-proxy` is the only container with internet egress for a provider and holds the key | LiteLLM or the browser ever seeing the credential |
| `gemini-proxy` allowlist: only `generateContent` / `streamGenerateContent` / `countTokens` for `GEMINI_MODEL`; rejects `tools`, `toolConfig`, `cachedContent` | Other (possibly paid-only) models, search grounding, context-cache storage, batch jobs |
| Output tokens capped by `AI_MAX_OUTPUT_TOKENS` in the API **and** again in the proxy; `candidateCount` forced to 1 | Long or multi-candidate generations |
| `EXTERNAL_DAILY_REQUEST_LIMIT` (default 100) and `EXTERNAL_DAILY_TOKEN_LIMIT` (default 100,000) per UTC day across all external providers; `0` blocks external use | Runaway usage; the admin console shows today's consumption |
| Default test suite blocks non-loopback network access | Tests calling a provider |

The POC cannot read a Google project's billing status. The guarantee of **$0** comes from step 1 above: a key from a project without a billing account. The daily ceiling only bounds the worst case if a billed key is used by mistake (at the list price above, 100,000 tokens/day is at most about $0.25/day).

## API documentation (Swagger)

Interactive OpenAPI docs are served by the API at **<http://localhost:3001/api/docs>** (raw spec: `/api/docs-json`). Every endpoint lists its request body, parameters, response schema, and error codes; the SSE endpoint documents its `token` / `done` / `error` events.

To call endpoints from the page:

1. Click **Authorize**.
2. Under `keycloak (OAuth2, authorizationCode)`, leave the client secret empty and click **Authorize**.
3. Sign in through Keycloak in the popup (for example `admin` / `Admin123!`).
4. Open an endpoint → **Try it out** → **Execute**.

Swagger UI signs in with Authorization Code + PKCE through its own public Keycloak client, `enterprise-ai-swagger`, so the same JWT, audience, RBAC, and ownership checks apply as in the web app. You can also paste an access token under `bearer`. Sending a message with an external model from Swagger calls that provider exactly like the chat UI does, within the same limits.

Installs created before this client existed (Keycloak imports the realm file only once) add it with:

```bash
npm run keycloak:sync-clients
```

The script only creates clients that are missing and leaves existing ones unchanged. Swagger is enabled for the local POC; set `SWAGGER_ENABLED=false` for customer deployments.

## API summary

User endpoints:

```text
GET    /api/models
POST   /api/conversations
GET    /api/conversations
GET    /api/conversations/:id
PATCH  /api/conversations/:id
DELETE /api/conversations/:id
POST   /api/conversations/:id/messages  (SSE response)
GET    /api/usage/me
```

Admin endpoints under `/api/admin` (every route guarded with `ADMIN` on the backend):

```text
GET    /api/admin/summary?from=&to=&provider=&modelId=   aggregate usage, costs, daily series, external guardrail status
GET    /api/admin/models                                  registry with configuration and availability
PATCH  /api/admin/models/:id                              enable/disable, allowed roles (audited)
GET    /api/admin/users
PATCH  /api/admin/users/:userId/models/:modelId           explicit per-user permission (audited)
GET    /api/admin/pricing?modelId=                        all pricing versions
POST   /api/admin/pricing/:modelId                        create a new immutable version (audited)
POST   /api/admin/pricing/preview/calculate               preview without saving
GET    /api/admin/audit?entityType=                       latest 100 audit entries
```

## Optional Ollama — not needed for this machine

Ollama is disabled in seed data and isolated behind a Compose profile. The default command never starts it or pulls a model.

On a different machine with sufficient memory, start it and explicitly download the selected model:

```bash
docker compose --profile ollama up -d ollama
docker compose --profile ollama exec ollama ollama pull qwen2.5:1.5b
```

Then sign in as `admin` and enable `qwen-local` in the model registry. No cloud fallback exists. If Ollama stops or the model is absent, the UI reports it unavailable and the mock remains operational.

A small 1.5B quantized model commonly needs roughly 2–4 GB free memory plus application overhead and about 1–2 GB disk, but runtime requirements vary by quantization and context. CPU inference is supported and may be slow. Review the exact model artifact’s license before commercial redistribution; do not infer redistribution rights from the Ollama integration itself.

## External providers

OpenAI, Anthropic, and Gemini are inert by default. Gemini has a separately activated overlay (see above); the base Compose file contains no external-provider route:

```dotenv
ENABLE_EXTERNAL_PROVIDERS=false
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

Adding a key alone does not enable anything. A future administrator must perform all of these deliberate actions:

1. Set `ENABLE_EXTERNAL_PROVIDERS=true`.
2. Supply the corresponding server-side credential.
3. Review and add a route based on `infra/litellm/external-models.example.yaml`.
4. Configure/version provider and customer pricing.
5. Enable the model in the admin registry.

The backend rejects external enablement unless both the global switch and matching credential exist, and refuses external requests once the daily ceiling is reached. Default startup, migrations, tests, health checks, and model discovery never call a paid provider. OpenAI and Anthropic would need a credential proxy and allowlist like Gemini's before use.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Production gap analysis](docs/PRODUCTION_GAPS.md)
- [Prisma schema](apps/api/prisma/schema.prisma)
- [Keycloak realm](infra/keycloak/enterprise-ai-realm.json)
- [LiteLLM configuration](infra/litellm/config.yaml)

