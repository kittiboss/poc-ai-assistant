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

For the **vendor-managed, three-customer POC with a simulated credit ledger and vendor console**, use the separate [phase 1–2 setup guide](docs/VENDOR_MANAGED_POC.md). It uses ports 3100/3200/3300, unique tenant logins, and never collects real payments. Its [central knowledge base](docs/VENDOR_MANAGED_POC.md#central-knowledge-base-rag-engine) serves every customer from one RAG engine, with each customer's data isolated and its limits set by the vendor. The instructions below remain the original standalone developer stack.

Requirements:

- Docker Desktop / Docker Engine with Compose v2
- Approximately 3–4 GB free RAM for the application infrastructure
- At least 6 GB of memory assigned to Docker Desktop when building the images; with less, `next build` in the web image can be killed (exit code 137) while the rest of the stack is running
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

| Username    | Password       | Roles           |
| ----------- | -------------- | --------------- |
| `admin`     | `Admin123!`    | `ADMIN`, `USER` |
| `employee1` | `Employee123!` | `USER`          |
| `employee2` | `Employee123!` | `USER`          |

These credentials are intentionally local and must never be reused outside this POC.

Stop the services without deleting history:

```bash
docker compose down
```

Delete local volumes and all POC data only when explicitly desired:

```bash
docker compose down --volumes
```

### Which Compose files to use

| Stack                            | Command                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Default, mock only               | `docker compose up --build -d`                                                        |
| With Gemini                      | `docker compose -f docker-compose.yml -f docker-compose.gemini.yml up --build -d`     |
| With Groq                        | `docker compose -f docker-compose.yml -f docker-compose.groq.yml up --build -d`       |
| With OpenRouter                  | `docker compose -f docker-compose.yml -f docker-compose.openrouter.yml up --build -d` |
| With Gemini, Groq and OpenRouter | `docker compose -f docker-compose.yml -f docker-compose.external.yml up --build -d`   |

An overlay only adds the gateway routes and credential proxies. Each provider still needs its `.env` settings and an administrator enabling the model; see the provider sections below.

Pass the same `-f` files to every later command (`ps`, `logs`, `down`). Otherwise the proxy containers are left out, or reported as orphans:

```bash
docker compose -f docker-compose.yml -f docker-compose.external.yml down
```

### After pulling or merging changes

```bash
npm install                    # for tests and tools run on the host
docker compose up --build -d   # with the same -f files as above, if you use an overlay
```

`--build` picks up new dependencies and services. The backend applies new Prisma migrations and the seed every time it starts, so there is no separate database step; check `docker compose logs backend` if it does not become healthy.

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
- Animated live token meter with automatic refresh, completed input/output totals, recent request activity, and separately labelled in-flight quota reservations
- OpenAI/Anthropic registry placeholders and an opt-in Gemini route, all disabled by default
- Layered external-cost guardrails: credential proxy allowlist, output-token cap, daily request/token ceiling (see [Cost safety](#cost-safety))
- Admin console filters (date range, provider, model), per-day/provider/model charts, cost breakdown, model availability, pricing overview, and audit log
- Database-enforced immutability of pricing versions; abandoned streams are marked `INTERRUPTED` after an API restart
- Product-catalog RAG: the supplied 200-product catalog in PostgreSQL, semantic search with pgvector using Gemini Embedding 2 (opt-in) or offline mock embeddings, cited answers in chat, admin CSV import and incremental indexing (see [Product catalog (RAG)](#product-catalog-rag))
- Conversation search, pin/archive, branch, edit-and-resend, regenerate, feedback, and Markdown/JSON export
- Admin quotas by user, role, model, and department; simulated budget limits, usage CSV, feedback aggregates, retention preview/policy, external-provider kill switch, and best-effort sensitive-data warnings/blocking

The user-facing Projects & tools, prompt-persona, local-tool, CSV-analysis, and response-comparison controls have been removed from the POC. Their server APIs and existing stored data remain intact for backward compatibility and data preservation, but the chat UI no longer requests or links to them. Quotas and budgets are admission controls based on conservative token estimates; simulated costs do not charge money.

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

To switch brands quickly, for a demo, with the stack running:

```bash
npm run switch-brand -- acme          # about 2 s; builds the brand's image the first time
npm run switch-brand -- default
npm run switch-brand -- acme build    # rebuild that brand's image after pulling new code
npm run switch-brand                  # list brands and the one running
```

Each brand is built once into its own image (`enterprise-ai-assistant-frontend:brand-<id>`), and switching recreates only the frontend container with the same Compose files the stack was started with. The script sets the brand for the build itself, so `NEXT_PUBLIC_BRAND` in `.env` does not change what it builds. It stops with a message if another program, such as a forgotten `next dev`, holds port 3000. Reload open tabs after switching, or use a private window to see the brand's default language and theme.

A brand sets the product name, organization, logo, favicon, primary color, corner radius, font (one of the fonts bundled in `apps/web/theme/fonts.ts`), default language, default theme mode, and optional Ant Design token overrides per mode. Fonts are committed to the repository, so builds need no internet access.

Users pick light, dark, or system theme and Thai or English on the **Settings** page (language also on the sign-in screen); both choices are stored in cookies. Colors in both Ant Design components and Tailwind classes come from the same brand tokens (see [Architecture](docs/ARCHITECTURE.md)).

## API types (web)

The web app's API client and types are generated from the API's OpenAPI document and committed (`apps/web/lib/api/schema.d.ts`). After changing an API route or DTO, start the API and run:

```bash
npm run api:types -w @enterprise/web
```

## Languages (web)

The web app is available in Thai and English. Texts live in `apps/web/messages/{en,th}.json`; TypeScript checks every key used in the code and fails if the two files do not have the same keys. Numbers, currency, and dates follow the selected language, and times are shown in each user's device time zone. In Thai, dates show the Buddhist Era year (2569), date pickers included, where they are typed as `DD/MM/BBBB` (`apps/web/i18n/dayjs.ts`); the API still receives ordinary ISO dates. The default language comes from the brand. Ant Design and Ant Design X use the matching locale (Thai strings for Ant Design X are in `apps/web/i18n/antd-locale.ts`). Sign-in passes the language to Keycloak as `ui_locales`, which takes effect only if the realm enables that language.

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
npm run test:workspace
npm run test:browser   # optional: requires local Chrome
```

The default suite never needs external credentials and has no active paid-provider route. The API test setup also replaces `fetch` with a guard that fails any non-loopback request, so a test cannot reach a paid provider even by mistake. The Ollama integration test remains skipped unless an operator explicitly supplies `OLLAMA_TEST_URL`. `npm run test:e2e` additionally checks the admin console APIs and the pricing example below (3,000 in / 700 out → `$0` actual, `$0.01` simulated provider cost, `$0.015` simulated charge).
`npm run test:workspace` is a backward-compatibility API smoke: it signs in with all three demo accounts and exercises ownership, retained workspace APIs, branches, feedback, quotas, and CSV export against the running stack. It sends chat only to `local-mock`.
The optional browser smoke checks the simplified mock chat, absence of the removed controls, live-token dashboard, and admin controls through the real UI; set `CHROME_PATH` if Chrome is installed elsewhere.

### Web end-to-end tests (Playwright)

With the Compose stack running and the web on `http://localhost:3000`:

```bash
npm run test:e2e:install -w @enterprise/web   # once: downloads Playwright's Chromium
npm run test:e2e:web
```

The tests sign in through the Keycloak development realm (`admin` and `employee1`), send a message to the mock model and stop one mid-reply, rename and delete chats, switch theme and language, and open every page at desktop (1440 px) and phone (390 px, touch) sizes, checking there is no sideways scrolling. Any console error or warning from the app fails a test. Chats the tests create are deleted afterwards. The files are in `apps/web/e2e`.

- `npm run test:e2e:ui -w @enterprise/web` opens Playwright's UI mode to run and watch tests one at a time.
- `npm run test:e2e:report -w @enterprise/web` opens the HTML report of the last run; a failed test keeps a screenshot, a retried one (on CI) a trace.
- `E2E_BASE_URL` and `E2E_API_URL` point the tests at another web or API address. Keycloak's development client only redirects back to `http://localhost:3000`.
- `E2E_BROWSER_CHANNEL=msedge` (or `chrome`) uses an installed browser instead of Playwright's Chromium.

## Using Google Gemini on the free tier

Gemini has a ready, opt-in external route. It stays off until you take every one of these steps; adding a key alone changes nothing.

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

Usage is recorded as `ACTUAL` (Google's token counts). The seeded Gemini pricing records actual provider cost as `$0` (free tier) and sets the simulation rates to Google's published paid-tier list price for `gemini-3.5-flash-lite` ($0.30 input / $2.50 output per 1M tokens, checked 2026-10-14). Dashboards therefore show what the same usage _would_ cost on a paid tier, clearly labelled as simulated. If the project's tier changes, create a new pricing version in the admin console.

Optional connectivity check: it validates the key with Google's model-list endpoint, briefly enables Gemini through the audited admin API, sends one streamed `Reply with exactly: GEMINI_OK` request, checks the persisted usage, and restores the registry state:

```bash
npm run test:gemini
```

## Using Groq on the free tier

The Groq route uses the production model `openai/gpt-oss-20b`, starts disabled, and is limited to `ADMIN` until an administrator changes its role policy.

1. Verify that the Groq organization associated with the key is on the intended free plan and review its current limits. The app cannot inspect billing-plan state.
2. Keep the credential only in the ignored `.env` file:

   ```dotenv
   GROQ_API_KEY=your-key
   GROQ_MODEL=openai/gpt-oss-20b
   GROQ_FREE_TIER_CONFIRMED=true
   ENABLE_EXTERNAL_PROVIDERS=true
   ```

   Leave `GROQ_FREE_TIER_CONFIRMED=false` until **Groq Console → Settings → Billing** shows the organization is on Free tier. A key alone cannot bypass this application guard.

3. Start Groq alone, or use the combined overlay to retain both Gemini and Groq:

   ```bash
   # Groq only
   docker compose -f docker-compose.yml -f docker-compose.groq.yml up --build -d

   # Gemini + Groq
   docker compose -f docker-compose.yml -f docker-compose.external.yml up --build -d
   ```

4. In **Admin console** → **Model registry**, enable **GPT-OSS 20B (Groq)**. Leave the `USER` role unchecked unless employee access is intentional.

Groq token counts are stored as `ACTUAL`. The seeded pricing is `$0` pass-through for a free-plan POC; if the organization becomes billable, set `GROQ_FREE_TIER_CONFIRMED=false` immediately and create an accurate pricing version before any future use. Both the API and credential proxy reject Groq generation while the confirmation is false. The optional smoke test validates the key/model, performs one short generation, verifies persisted usage, and normally restores the previous enabled state. Set `GROQ_KEEP_ENABLED=true` to leave it enabled after a successful test:

```bash
GROQ_KEEP_ENABLED=true npm run test:groq
```

## Using OpenRouter free models

OpenRouter is integrated only through [`openrouter/free`](https://openrouter.ai/openrouter/free), a zero-price router that selects from the free variants currently available. The underlying model can change between requests, so use this route for POC workloads rather than model-specific evaluation.

1. Put the key in the ignored `.env` and keep the model fixed:

   ```dotenv
   OPENROUTER_API_KEY=your-key
   OPENROUTER_MODEL=openrouter/free
   ENABLE_EXTERNAL_PROVIDERS=true
   ```

2. Start OpenRouter alone, or retain all configured providers with the combined overlay:

   ```bash
   # OpenRouter only
   docker compose -f docker-compose.yml -f docker-compose.openrouter.yml up --build -d

   # Gemini + Groq + OpenRouter
   docker compose -f docker-compose.yml -f docker-compose.external.yml up --build -d
   ```

3. Enable **OpenRouter Free Models** in **Admin console** → **Model registry**. It is restricted to `ADMIN` by default.

The proxy accepts only `model=openrouter/free`; paid model IDs, alternate model lists, provider overrides, plugins, web search, tools, response formats and other endpoint families are rejected before egress. The smoke test first confirms that the live catalog still reports zero prompt/completion/request pricing, then sends one short request:

```bash
OPENROUTER_KEEP_ENABLED=true npm run test:openrouter
```

Return to the default mock-only stack at any time:

```bash
docker compose up -d --force-recreate --remove-orphans litellm backend
```

## Product catalog (RAG)

Chat can answer product questions from the company catalog. The catalog is the `products` table defined by [`apps/api/prisma/data/schema.sql`](apps/api/prisma/data/schema.sql); the seed loads the bundled [`products.csv`](apps/api/prisma/data/products.csv) (200 products) into an empty table. Every product becomes one text passage (name, SKU, brand, category, price, cost price, stock, status, rating, attributes, description), which is embedded and stored in PostgreSQL with pgvector.

```text
Index:  products ─► passage ─► LiteLLM /v1/embeddings ─► KnowledgeChunk (vector(768), HNSW)
Chat:   question ─► embed ─► top-5 cosine search ─► cited context [S1]… ─► chat model
```

How to use it:

1. **Choose the embedding model.** The base stack uses `mock-embedding` (offline, word-overlap only, $0). The Gemini overlays default to `gemini-embedding` (Gemini Embedding 2, semantic). Override with `RAG_EMBEDDING_MODEL`.
2. **Enable it.** For Gemini, sign in as `admin` → **Admin console → Model registry** → enable **Gemini Embedding 2**. It also needs `ENABLE_EXTERNAL_PROVIDERS=true` and the Gemini overlay, like Gemini chat.
3. **Index.** **Admin console → Product catalog (RAG) → Index catalog.** Only new or changed products are embedded; re-running with no changes makes no provider call. Progress shows while it runs.
4. **Chat.** Turn on **Product catalog** next to the model selector (on by default once the catalog is indexed). Answers cite products as `[S1]`, `[S2]`, and the retrieved passages with match scores appear under the answer.

To update the catalog, use **Import CSV** in the same panel (same columns as `schema.sql`; rows are upserted by `product_id`; the whole file is rejected if any row is invalid), then **Index catalog** again.

Cost and free-tier behaviour with Gemini:

- Gemini Embedding 2 is free of charge on the free tier (paid list price $0.20 per 1M input tokens, used for the simulated cost). As with Gemini chat, free-tier content may be used by Google to improve its products.
- The free tier counts **every text** as one request against a **100-per-minute** quota. Indexing therefore runs in the background in small paced batches (`RAG_EXTERNAL_BATCH_SIZE=25` every `RAG_EXTERNAL_BATCH_INTERVAL_MS=15500`); a provider rate limit waits a minute and retries. 200 products take about two minutes.
- Every embedding call (indexing and each catalog-enabled question) goes through the same reservation, quotas, kill switch and daily external limits as chat, and is recorded as usage with operation `EMBEDDING`. Calls the provider refuses are recorded as 0 tokens.
- With an external embedding model, the question text itself is sent to the provider for the search; the chat shows a notice and the sensitive-data check runs first.

Changing `RAG_EMBEDDING_MODEL` requires indexing again (vectors from different models are not comparable; each model keeps its own index).

Limits of this POC: retrieval returns the 5 most similar products (`RAG_TOP_K`), so questions that need the whole table ("how many products are out of stock?") get partial answers; that needs SQL-backed answers, see [production gaps](docs/PRODUCTION_GAPS.md). The catalog, including cost price, is visible to every signed-in user.

Verification: `npm run test:rag` (offline mock; also part of `npm run test:e2e`) and `npm run test:rag:gemini` (calls Gemini: indexes changes, embeds one question, asks Gemini chat as `admin`).

## Cost safety

Everything in the default stack is local: the mock provider, Ollama, PostgreSQL, Keycloak, Valkey, and LiteLLM are open-source containers and make no paid calls. OpenAI and Anthropic have no gateway route and no credential. Gemini, Groq and OpenRouter can reach external services only through explicit opt-in overlays, constrained in layers:

| Layer                                                                                                                                                                                                                                                                                                                          | What it prevents                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Base `docker-compose.yml` has no external route; LiteLLM sits on an internal-only network                                                                                                                                                                                                                                      | Any provider call in the default stack, including during startup, migrations, health checks, and model discovery |
| `ENABLE_EXTERNAL_PROVIDERS=true` **and** a server-side credential **and** an admin enabling the model **and** per-user permission                                                                                                                                                                                              | Accidental activation by just adding a key                                                                       |
| Groq additionally requires `GROQ_FREE_TIER_CONFIRMED=true` in both the API and credential proxy                                                                                                                                                                                                                                | Any Groq generation before an operator verifies Free tier in Groq Console                                        |
| Provider credential proxies are the only containers with provider internet egress and hold the keys                                                                                                                                                                                                                            | LiteLLM or the browser ever seeing a provider credential                                                         |
| Provider allowlists restrict Gemini/Groq to configured models; OpenRouter accepts only the zero-price `openrouter/free` router; all reject tools/side features                                                                                                                                                                 | Paid model fallback, search grounding, function calls, context-cache storage, batch/audio jobs                   |
| Output tokens capped by `AI_MAX_OUTPUT_TOKENS` in the API **and** again in each proxy; response count forced to 1                                                                                                                                                                                                              | Long or multi-candidate generations                                                                              |
| `EXTERNAL_DAILY_REQUEST_LIMIT` (default 100) and `EXTERNAL_DAILY_TOKEN_LIMIT` (default 100,000) per UTC day across all external providers; `0` blocks external use                                                                                                                                                             | Runaway usage; the admin console shows today's consumption                                                       |
| Product-catalog embeddings default to the offline `mock-embedding`; `gemini-embedding` needs the overlay **and** an admin enabling it; the Gemini proxy allows embedding only for `GEMINI_EMBEDDING_MODEL`; indexing is paced to the free-tier quota and every embedding call is reserved, metered and daily-limited like chat | Embedding calls without explicit opt-in, embedding other (paid) models, quota bursts                             |
| Default test suite blocks non-loopback network access                                                                                                                                                                                                                                                                          | Tests calling a provider                                                                                         |

The POC cannot read provider billing-plan state. A `$0` result depends on using a genuinely free provider project/organization; application limits reduce exposure but are not a billing guarantee. Configure provider-side budgets/limits before using any billed key.

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
POST   /api/conversations/:id/messages  (SSE response; useProductCatalog=true adds cited catalog context)
POST   /api/conversations/:id/tools     (retained compatibility API; not exposed in the UI)
POST   /api/conversations/:id/branch
POST   /api/conversations/:id/messages/:messageId/feedback
GET    /api/usage/me
GET    /api/usage/me/live      (auto-refresh token snapshot and in-flight reservations)
GET    /api/usage/models       (organization-wide use of each model today against its MODEL quota and the shared daily external limit)
GET    /api/knowledge/status   (product catalog availability and index state)
GET/POST/PATCH/DELETE /api/workspace/... (retained compatibility APIs; not exposed in the UI)
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
POST   /api/admin/knowledge/products/import               upsert the product catalog from CSV (multipart, audited)
POST   /api/admin/knowledge/reindex                       start incremental embedding in the background (audited)
GET/PATCH/POST /api/admin/workspace/...                    governance, quotas, departments, templates, usage CSV, retention preview
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

OpenAI, Anthropic, Gemini, Groq, and OpenRouter are inert by default. Gemini, Groq and OpenRouter have separately activated overlays (see above); the base Compose file contains no external-provider route:

```dotenv
ENABLE_EXTERNAL_PROVIDERS=false
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
GROQ_FREE_TIER_CONFIRMED=false
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
```

Adding a key alone does not enable anything. A future administrator must perform all of these deliberate actions:

1. Set `ENABLE_EXTERNAL_PROVIDERS=true`.
2. Supply the corresponding server-side credential.
3. Review and add a route based on `infra/litellm/external-models.example.yaml`.
4. Configure/version provider and customer pricing.
5. Enable the model in the admin registry.

The backend rejects external enablement unless both the global switch and matching credential proxy exist, and refuses external requests once the daily ceiling is reached. Default startup, migrations, tests, health checks, and model discovery never call a provider. OpenAI and Anthropic still need credential proxies and allowlists like the Gemini/Groq/OpenRouter integrations before use.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Production gap analysis](docs/PRODUCTION_GAPS.md)
- [Prisma schema](apps/api/prisma/schema.prisma)
- [Keycloak realm](infra/keycloak/enterprise-ai-realm.json)
- [LiteLLM configuration](infra/litellm/config.yaml)
