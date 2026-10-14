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
- OpenAI/Anthropic/Gemini registry placeholders, all disabled by default

The mock provider supports deterministic test controls:

- `Explain Docker Compose` → `This is a mock AI response for local POC testing.`
- Include `[mock:error]` to return a simulated provider error.
- Include `[mock:timeout]` to simulate a slow provider.

Mock usage is always `SYNTHETIC`; actual provider cost is always `$0`. Pricing simulation is clearly separate and never creates an invoice.

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

The default suite never needs external credentials and has no active paid-provider route. The Ollama integration test remains skipped unless an operator explicitly supplies `OLLAMA_TEST_URL`.

### Explicit Gemini free-tier connectivity test

Google lists `gemini-3.5-flash-lite` text generation as free of charge for eligible free-tier projects. Project billing status cannot be inferred from an API key, so confirm **Free tier** in Google AI Studio before running this test. Free-tier inputs and outputs may be used by Google to improve its products.

Put the credential only in the ignored `.env` file (never in Git):

```dotenv
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.5-flash-lite
```

Start the explicit Gemini overlay and run one no-tools request capped at 32 output tokens:

```bash
docker compose -f docker-compose.yml -f docker-compose.gemini.yml up --build -d litellm backend
npm run test:gemini
```

The probe validates the credential with Google's model-list endpoint, temporarily enables Gemini through the audited admin API, sends one streamed request through `NestJS → LiteLLM → internal credential proxy → Gemini`, checks persisted usage, and restores the registry state. The proxy keeps the real provider credential out of LiteLLM URLs and logs. Return the running services to the default mock-only configuration afterward:

```bash
docker compose up -d --force-recreate litellm backend
```

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

Admin endpoints under `/api/admin` provide aggregate summary, model management, user model permissions, pricing preview, pricing version creation, and history. Every route is guarded with `ADMIN` on the backend.

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

OpenAI, Anthropic, and Gemini are inert by default. Gemini has a separately activated test overlay; the base Compose file still contains no external-provider route:

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

The backend rejects external enablement unless both the global switch and matching credential exist. Default startup, migrations, tests, health checks, and model discovery never call a paid provider.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Production gap analysis](docs/PRODUCTION_GAPS.md)
- [Prisma schema](apps/api/prisma/schema.prisma)
- [Keycloak realm](infra/keycloak/enterprise-ai-realm.json)
- [LiteLLM configuration](infra/litellm/config.yaml)

