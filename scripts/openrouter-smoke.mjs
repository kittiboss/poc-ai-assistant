import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const keycloak = process.env.KEYCLOAK_URL || "http://localhost:8080";
const realm = process.env.KEYCLOAK_REALM || "enterprise-ai";
const api = process.env.API_URL || "http://localhost:3001/api";
const clientId = process.env.OIDC_CLIENT_ID || "enterprise-ai-web";
const redirectUri = process.env.OIDC_REDIRECT_URI || "http://localhost:3000";
const openRouterKey = process.env.OPENROUTER_API_KEY;
const openRouterModel = process.env.OPENROUTER_MODEL || "openrouter/free";
const keepEnabled = process.env.OPENROUTER_KEEP_ENABLED === "true";

assert(
  openRouterKey,
  "OPENROUTER_API_KEY is missing from the ignored .env file",
);
assert.equal(
  openRouterModel,
  "openrouter/free",
  "Refusing to test a model outside the OpenRouter free-only route",
);

function mergeCookies(existing, response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const jar = new Map(
    existing
      .split("; ")
      .filter(Boolean)
      .map((part) => [part.split("=")[0], part]),
  );
  for (const value of values) {
    const cookie = value.split(";")[0];
    jar.set(cookie.split("=")[0], cookie);
  }
  return [...jar.values()].join("; ");
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x3D;", "=")
    .replaceAll("&#61;", "=");
}

async function login(username, password) {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authUrl = new URL(
    `${keycloak}/realms/${realm}/protocol/openid-connect/auth`,
  );
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }))
    authUrl.searchParams.set(key, value);

  const page = await fetch(authUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  let cookie = mergeCookies("", page);
  const html = await page.text();
  const action = decodeHtml(
    html.match(/<form[^>]+id="kc-form-login"[^>]+action="([^"]+)"/i)?.[1] ||
      html.match(/<form[^>]+action="([^"]+)"[^>]+id="kc-form-login"/i)?.[1] ||
      "",
  );
  assert(action, `Could not find Keycloak login form for ${username}`);

  const submitted = await fetch(action, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams({ username, password, credentialId: "" }),
    signal: AbortSignal.timeout(10_000),
  });
  cookie = mergeCookies(cookie, submitted);
  const location = submitted.headers.get("location");
  assert(location, `Keycloak rejected demo credentials for ${username}`);
  const code = new URL(location).searchParams.get("code");
  assert(code, `Keycloak did not return an authorization code for ${username}`);

  const tokenResponse = await fetch(
    `${keycloak}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  assert.equal(
    tokenResponse.status,
    200,
    `Token exchange failed (${tokenResponse.status})`,
  );
  return (await tokenResponse.json()).access_token;
}

function request(path, token, init = {}) {
  return fetch(`${api}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
    signal: init.signal || AbortSignal.timeout(60_000),
  });
}

async function providerError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

// The smoke test refuses generation unless OpenRouter's live catalog still
// advertises this route with zero prompt, completion and request pricing.
const providerModelsResponse = await fetch(
  "https://openrouter.ai/api/v1/models",
  {
    headers: { Authorization: `Bearer ${openRouterKey}` },
    signal: AbortSignal.timeout(20_000),
  },
);
if (!providerModelsResponse.ok) {
  throw new Error(
    `OpenRouter key validation failed: ${await providerError(providerModelsResponse)}`,
  );
}
const providerModels = await providerModelsResponse.json();
const providerModel = providerModels.data?.find(
  (item) => item.id === openRouterModel,
);
assert(providerModel, `OpenRouter did not list ${openRouterModel}`);
assert.equal(
  Number(providerModel.pricing?.prompt),
  0,
  "Prompt price is not zero",
);
assert.equal(
  Number(providerModel.pricing?.completion),
  0,
  "Completion price is not zero",
);
assert.equal(
  Number(providerModel.pricing?.request || 0),
  0,
  "Per-request price is not zero",
);

const adminToken = await login(
  "admin",
  process.env.ADMIN_DEMO_PASSWORD || "Admin123!",
);
const adminModelsResponse = await request("/admin/models", adminToken);
assert.equal(
  adminModelsResponse.status,
  200,
  "Could not read the model registry",
);
const original = (await adminModelsResponse.json()).find(
  (model) => model.id === "openrouter-free",
);
assert(original, "openrouter-free is missing from the model registry");

let registryChanged = false;
try {
  if (!original.enabled) {
    const enableResponse = await request(
      "/admin/models/openrouter-free",
      adminToken,
      { method: "PATCH", body: JSON.stringify({ enabled: true }) },
    );
    assert.equal(
      enableResponse.status,
      200,
      `Could not enable OpenRouter: ${await enableResponse.text()}`,
    );
    registryChanged = true;
  }

  let selected;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request("/models", adminToken);
    assert.equal(response.status, 200, "Could not read available models");
    selected = (await response.json()).find(
      (model) => model.id === "openrouter-free",
    );
    if (selected?.available) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert(
    selected?.available,
    `OpenRouter route is not available (${selected?.status || "unknown status"})`,
  );

  const createResponse = await request("/conversations", adminToken, {
    method: "POST",
    body: JSON.stringify({ title: "OpenRouter connectivity smoke test" }),
  });
  assert.equal(
    createResponse.status,
    201,
    "Could not create the smoke-test conversation",
  );
  const conversation = await createResponse.json();
  const requestId = randomUUID();
  const streamResponse = await request(
    `/conversations/${conversation.id}/messages`,
    adminToken,
    {
      method: "POST",
      body: JSON.stringify({
        content: "Reply with exactly: OPENROUTER_OK",
        modelId: "openrouter-free",
        requestId,
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  assert.equal(
    streamResponse.status,
    200,
    `OpenRouter request failed before streaming (${streamResponse.status})`,
  );
  const stream = await streamResponse.text();
  const errorFrame = stream
    .split("\n\n")
    .find((frame) => frame.startsWith("event: error"));
  assert(
    !errorFrame,
    `OpenRouter generation failed: ${errorFrame?.match(/^data:\s*(.+)$/m)?.[1] || "unknown gateway error"}`,
  );
  const output = stream
    .split("\n\n")
    .filter((frame) => frame.startsWith("event: token"))
    .map((frame) => JSON.parse(frame.match(/^data:\s*(.+)$/m)[1]).text)
    .join("")
    .trim();
  assert(output, "OpenRouter returned an empty streamed response");
  assert(stream.includes("event: done"), "OpenRouter stream did not complete");

  const usageResponse = await request("/usage/me", adminToken);
  assert.equal(
    usageResponse.status,
    200,
    "Could not read usage after the OpenRouter request",
  );
  const record = (await usageResponse.json()).records.find(
    (item) => item.requestId === requestId,
  );
  assert(record, "OpenRouter usage record was not persisted");
  assert.equal(record.provider, "OPENROUTER");
  assert.equal(record.usageKind, "ACTUAL");

  console.log(
    JSON.stringify(
      {
        credential: "accepted",
        model: openRouterModel,
        verifiedPricing: { prompt: 0, completion: 0, request: 0 },
        gatewayRoute: "openrouter-free",
        response: output,
        usage: {
          kind: record.usageKind,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
        },
        registry:
          original.enabled || keepEnabled ? "enabled" : "restore scheduled",
      },
      null,
      2,
    ),
  );
} finally {
  if (registryChanged && !keepEnabled) {
    const restoreResponse = await request(
      "/admin/models/openrouter-free",
      adminToken,
      { method: "PATCH", body: JSON.stringify({ enabled: false }) },
    );
    if (!restoreResponse.ok) {
      process.stderr.write(
        "Warning: could not restore OpenRouter to disabled; disable it in Admin.\n",
      );
    }
  }
}
