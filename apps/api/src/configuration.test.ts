import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdminController } from "./admin/admin.controller";
import { REQUIRED_ROLES } from "./common/auth/auth.decorators";

const root = resolve(process.cwd(), "../..");

describe("security and provider configuration", () => {
  it("configures Keycloak authorization code + PKCE, audience, roles, and demo users", () => {
    const realm = JSON.parse(
      readFileSync(
        resolve(root, "infra/keycloak/enterprise-ai-realm.json"),
        "utf8",
      ),
    );
    const web = realm.clients.find(
      (client: { clientId: string }) => client.clientId === "enterprise-ai-web",
    );
    expect(web.publicClient).toBe(true);
    expect(web.standardFlowEnabled).toBe(true);
    expect(web.directAccessGrantsEnabled).toBe(false);
    expect(web.attributes["pkce.code.challenge.method"]).toBe("S256");
    expect(web.protocolMappers[0].config["included.client.audience"]).toBe(
      "enterprise-ai-api",
    );
    expect(
      realm.users.map((user: { username: string }) => user.username),
    ).toEqual(["admin", "employee1", "employee2"]);
    expect(
      realm.roles.realm.map((role: { name: string }) => role.name),
    ).toEqual(["ADMIN", "USER"]);
  });

  it("gives Swagger UI its own public PKCE client limited to the docs redirect", () => {
    const realm = JSON.parse(
      readFileSync(
        resolve(root, "infra/keycloak/enterprise-ai-realm.json"),
        "utf8",
      ),
    );
    const swagger = realm.clients.find(
      (client: { clientId: string }) =>
        client.clientId === "enterprise-ai-swagger",
    );
    expect(swagger).toMatchObject({
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      implicitFlowEnabled: false,
    });
    expect(swagger.attributes["pkce.code.challenge.method"]).toBe("S256");
    expect(swagger.redirectUris).toEqual([
      "http://localhost:3001/api/docs/oauth2-redirect.html",
    ]);
    expect(swagger.protocolMappers[0].config["included.client.audience"]).toBe(
      "enterprise-ai-api",
    );
  });

  it("routes product-catalog embeddings offline by default and Gemini embeddings only in opt-in overlays", () => {
    const read = (file: string) => readFileSync(resolve(root, file), "utf8");
    for (const file of [
      "config.yaml",
      "config.gemini.yaml",
      "config.external.yaml",
      "config.groq.yaml",
      "config.openrouter.yaml",
    ])
      expect(read(`infra/litellm/${file}`)).toContain(
        "model_name: mock-embedding",
      );
    expect(read("infra/litellm/config.yaml")).not.toContain("gemini-embedding");
    for (const file of ["config.gemini.yaml", "config.external.yaml"]) {
      const config = read(`infra/litellm/${file}`);
      expect(config).toContain("model_name: gemini-embedding");
      expect(config).toMatch(
        /api_base: os\.environ\/GEMINI_EMBEDDING_PROXY_URL\s+api_key: local-gemini-proxy/,
      );
    }
    const base = read("docker-compose.yml");
    expect(base).toContain(
      "RAG_EMBEDDING_MODEL: ${RAG_EMBEDDING_MODEL:-mock-embedding}",
    );
    expect(base).toContain("context: infra/postgres");
    for (const overlay of [
      "docker-compose.gemini.yml",
      "docker-compose.external.yml",
    ])
      expect(read(overlay)).toMatch(
        /GEMINI_EMBEDDING_PROXY_URL: http:\/\/gemini-proxy:4020\//,
      );
  });

  it("keeps external providers out of the default LiteLLM routes", () => {
    const config = readFileSync(
      resolve(root, "infra/litellm/config.yaml"),
      "utf8",
    );
    expect(config).toContain("model_name: local-mock");
    expect(config).not.toMatch(
      /model_name:\s*(openai-gpt|anthropic-claude|google-gemini|groq-llama|openrouter-free)/,
    );
  });

  it("uses an isolated free-only credential proxy for OpenRouter", () => {
    const config = readFileSync(
      resolve(root, "infra/litellm/config.openrouter.yaml"),
      "utf8",
    );
    const overlay = readFileSync(
      resolve(root, "docker-compose.openrouter.yml"),
      "utf8",
    );
    expect(config).toContain("model_name: openrouter-free");
    expect(config).toContain("api_key: local-openrouter-proxy");
    expect(config).not.toContain("api_key: os.environ/OPENROUTER_API_KEY");
    expect(overlay).toContain("openrouter-proxy:");
    expect(overlay).toContain(
      "OPENROUTER_MODEL: ${OPENROUTER_MODEL:-openrouter/free}",
    );
    expect(overlay).toMatch(/OPENROUTER_API_KEY:\s*\$\{OPENROUTER_API_KEY:\?/);
    const backend = overlay.slice(overlay.indexOf("\n  backend:"));
    expect(backend).toContain('OPENROUTER_CREDENTIAL_CONFIGURED: "true"');
    expect(backend).not.toContain("OPENROUTER_API_KEY");
    const litellm = overlay.slice(
      overlay.indexOf("\n  litellm:"),
      overlay.indexOf("\n  backend:"),
    );
    expect(litellm).not.toContain("edge");
  });

  it("requires a separate Compose overlay and credential proxy for Groq", () => {
    const config = readFileSync(
      resolve(root, "infra/litellm/config.groq.yaml"),
      "utf8",
    );
    const overlay = readFileSync(
      resolve(root, "docker-compose.groq.yml"),
      "utf8",
    );
    expect(config).toContain("model_name: groq-llama");
    expect(config).toContain("api_key: local-groq-proxy");
    expect(config).not.toContain("api_key: os.environ/GROQ_API_KEY");
    expect(overlay).toContain("groq-proxy:");
    expect(overlay).toMatch(/GROQ_API_KEY:\s*\$\{GROQ_API_KEY:\?/);
    expect(overlay).toContain(
      "ENABLE_EXTERNAL_PROVIDERS: ${ENABLE_EXTERNAL_PROVIDERS:-false}",
    );
    expect(overlay).toContain(
      "GROQ_FREE_TIER_CONFIRMED: ${GROQ_FREE_TIER_CONFIRMED:-false}",
    );
    const backend = overlay.slice(overlay.indexOf("\n  backend:"));
    expect(backend).toContain('GROQ_CREDENTIAL_CONFIGURED: "true"');
    expect(backend).not.toContain("GROQ_API_KEY");
    expect(overlay).not.toMatch(/ENABLE_EXTERNAL_PROVIDERS:\s*"?true/);
    const litellm = overlay.slice(
      overlay.indexOf("\n  litellm:"),
      overlay.indexOf("\n  backend:"),
    );
    expect(litellm).not.toContain("edge");
  });

  it("provides a combined overlay without exposing provider credentials to LiteLLM", () => {
    const config = readFileSync(
      resolve(root, "infra/litellm/config.external.yaml"),
      "utf8",
    );
    const overlay = readFileSync(
      resolve(root, "docker-compose.external.yml"),
      "utf8",
    );
    expect(config).toContain("model_name: google-gemini");
    expect(config).toContain("model_name: groq-llama");
    expect(config).toContain("model_name: openrouter-free");
    expect(config).not.toMatch(
      /api_key:\s*os\.environ\/(GEMINI|GROQ|OPENROUTER)_API_KEY/,
    );
    const litellm = overlay.slice(
      overlay.indexOf("\n  litellm:"),
      overlay.indexOf("\n  backend:"),
    );
    expect(litellm).not.toContain("edge");
  });

  it("requires a separate Compose overlay and environment-only secret for Gemini", () => {
    const config = readFileSync(
      resolve(root, "infra/litellm/config.gemini.yaml"),
      "utf8",
    );
    const overlay = readFileSync(
      resolve(root, "docker-compose.gemini.yml"),
      "utf8",
    );
    expect(config).toContain("model_name: google-gemini");
    expect(config).toContain("api_key: local-gemini-proxy");
    expect(config).not.toContain("api_key: os.environ/GEMINI_API_KEY");
    expect(overlay).toContain("gemini-proxy:");
    expect(overlay).toMatch(/GEMINI_API_KEY:\s*\$\{GEMINI_API_KEY:\?/);
    // The overlay does not flip the global switch itself; the operator must set it explicitly in .env.
    expect(overlay).toContain(
      "ENABLE_EXTERNAL_PROVIDERS: ${ENABLE_EXTERNAL_PROVIDERS:-false}",
    );
    expect(overlay).not.toMatch(/ENABLE_EXTERNAL_PROVIDERS:\s*"?true/);
    // Only the credential proxy may reach the internet; LiteLLM stays on the internal network.
    const litellm = overlay.slice(
      overlay.indexOf("\n  litellm:"),
      overlay.indexOf("\n  backend:"),
    );
    expect(litellm).not.toContain("edge");
  });

  it("makes Ollama opt-in and protects every admin endpoint with ADMIN", () => {
    const compose = readFileSync(resolve(root, "docker-compose.yml"), "utf8");
    expect(compose).toMatch(/ollama:\n[\s\S]*?profiles: \["ollama"\]/);
    expect(Reflect.getMetadata(REQUIRED_ROLES, AdminController)).toEqual([
      "ADMIN",
    ]);
  });
});

/** One top-level service (or network) block of a Compose file, as text. */
function block(compose: string, section: "services" | "networks", name: string) {
  const sectionText = compose.slice(compose.indexOf(`\n${section}:\n`));
  const start = sectionText.indexOf(`\n  ${name}:\n`);
  if (start < 0) return undefined;
  const rest = sectionText.slice(start + 1);
  const end = rest.slice(1).search(/\n(\s{2}\S|\S)/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}
const serviceNames = (compose: string) => {
  const services = compose.slice(compose.indexOf("\nservices:\n"), compose.search(/\n(volumes|networks):\n/));
  return [...services.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1]);
};

describe("vendor-managed platform deployment", () => {
  const read = (file: string) => readFileSync(resolve(root, file), "utf8");
  const platform = read("deploy/platform/docker-compose.yml");
  const tenant = read("deploy/tenant/docker-compose.yml");

  it("gives a customer deployment no provider credential and no way around the gateway", () => {
    expect(serviceNames(tenant)).toEqual(["postgres", "backend", "frontend"]);
    expect(tenant).not.toMatch(/MASTER_KEY|(GEMINI|GROQ|OPENROUTER|OPENAI|ANTHROPIC)_API_KEY|CREDENTIAL_CONFIGURED/);
    const backend = block(tenant, "services", "backend")!;
    expect(backend).toContain("MODEL_ACCESS: vendor-gateway");
    expect(backend).toContain("LITELLM_API_KEY: ${LITELLM_API_KEY:?");
    expect(backend).toContain("LITELLM_URL: http://vendor-control:4050");
    // Knowledge lives in the central engine, reached with the same platform credential.
    expect(backend).toContain("RAG_ENGINE_URL: http://rag-engine:4060");
    expect(backend).not.toMatch(/RAG_ADMIN_KEY|RAG_DB_PASSWORD|RAG_APP_DB_PASSWORD/);
    expect(block(tenant, "networks", "platform-shared")).toMatch(/external: true\n\s+name: platform-shared/);
  });

  it("lets customer deployments reach only Keycloak, the gateway and the RAG engine on the platform", () => {
    expect(block(platform, "networks", "shared")).toMatch(/name: platform-shared\n\s+internal: true/);
    const onShared = serviceNames(platform).filter((name) => /networks: \[[^\]]*\bshared\b/.test(block(platform, "services", name)!));
    expect(onShared).toEqual(["keycloak", "vendor-control", "rag-engine"]);
    // Every customer's documents sit in rag-db: only the engine reaches it, and neither has egress.
    expect(block(platform, "services", "rag-db")).toContain("networks: [rag]");
    expect(block(platform, "services", "rag-engine")).toContain("networks: [rag, shared]");
    expect(block(platform, "networks", "rag")).toContain("internal: true");
    expect(block(platform, "services", "rag-engine")).not.toMatch(/ports:/);
    // The credential proxies do not authenticate callers, so only the gateway may reach them.
    for (const proxy of ["gemini-proxy", "groq-proxy", "openrouter-proxy"]) {
      const service = block(platform, "services", proxy)!;
      expect(service).toContain("networks: [gateway, egress]");
      expect(service).toMatch(/profiles: \[\w+\]/);
    }
    expect(block(platform, "services", "mock-provider")).toContain("networks: [gateway]");
    expect(block(platform, "networks", "gateway")).toContain("internal: true");
    // The admin API is published to this machine only.
    expect(block(platform, "services", "litellm")).toContain('"127.0.0.1:4000:4000"');
  });

  it("prices every gateway route so prepaid credit goes down, and keeps keys in the proxies", () => {
    const config = read("deploy/platform/litellm.yaml");
    const routes = config.split("\n  - model_name: ").slice(1);
    expect(routes.map((route) => route.split("\n")[0])).toEqual([
      "local-mock",
      "mock-embedding",
      "google-gemini",
      "gemini-embedding",
      "groq-llama",
      "openrouter-free",
    ]);
    for (const route of routes) expect(route).toMatch(/input_cost_per_token: 0\.\d+[1-9]/);
    expect(config).not.toMatch(/api_key: os\.environ/);
    expect(config).toContain("master_key: os.environ/LITELLM_MASTER_KEY");
  });

  it("keeps platform and customer secrets out of Git", () => {
    const ignored = read(".gitignore").split("\n");
    expect(ignored).toEqual(expect.arrayContaining(["deploy/platform/.env", "deploy/tenants/*.env"]));
  });
});
