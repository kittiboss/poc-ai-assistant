// Customer deployments on the vendor platform:
//   npm run tenant:create -- <id>            gateway key, Keycloak realm, env file, start the deployment
//   npm run tenant:credits -- <id> <usd>     append a simulated credit grant
//   npm run tenant:status [-- <id>]          spend against credit
//   npm run tenant:down -- <id> [--remove]   stop; --remove also deletes its data, gateway key and realm
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  gateway,
  keycloakAdmin,
  keycloakUrl,
  providerModels,
  readEnvFile,
  readPlatformEnv,
  root,
  secret,
  tenantCompose,
  tenantsDir,
  waitHealthy,
  writeEnvFile,
  vendor,
} from "./lib.mjs";

const [command, id, ...rest] = process.argv.slice(2);
const usage = () => {
  console.error(
    "Usage: tenant.mjs create <id> | rotate <id> | credits <id> <usd> | status [id] | down <id> [--remove]",
  );
  process.exit(1);
};

const settingsFile = (tenant) => join(tenantsDir, `${tenant}.json`);
const envFile = (tenant) => join(tenantsDir, `${tenant}.env`);
const realmName = (tenant) => `tenant-${tenant}`;
const usd = (value) => `$${Number(value).toFixed(6)}`;
if (id && !/^[a-z0-9][a-z0-9-]{0,19}$/.test(id)) usage();

function settings(tenant) {
  if (!/^[a-z0-9-]{1,20}$/.test(tenant ?? "")) usage();
  if (!existsSync(settingsFile(tenant)))
    throw new Error(`deploy/tenants/${tenant}.json does not exist`);
  return JSON.parse(readFileSync(settingsFile(tenant), "utf8"));
}

/** Models whose credential proxy the platform can run; local mock models are always available. */
function allowedModels(config, platformEnv) {
  const unavailable = Object.entries(providerModels)
    .filter(
      ([key]) =>
        !platformEnv[key]?.trim() ||
        (key === "GROQ_API_KEY" &&
          platformEnv.GROQ_FREE_TIER_CONFIRMED !== "true"),
    )
    .flatMap(([, { models }]) => models);
  return config.models.filter((model) => !unavailable.includes(model));
}

function keySettings(config, models) {
  const limits = Object.entries(config.modelRateLimits ?? {}).filter(
    ([model]) => models.includes(model),
  );
  const pick = (field) =>
    Object.fromEntries(
      limits
        .filter(([, limit]) => limit[field])
        .map(([model, limit]) => [model, limit[field]]),
    );
  return { models, model_rpm_limit: pick("rpm"), model_tpm_limit: pick("tpm") };
}

/** The realm template of the single-installation stack, with this customer's name and addresses. */
function realmFor(config, web, api) {
  const realm = JSON.parse(
    readFileSync(
      join(root, "infra", "keycloak", "enterprise-ai-realm.json"),
      "utf8",
    ),
  );
  realm.realm = realmName(config.id);
  realm.displayName = config.name;
  realm.users = []; // Never copy the shared demo accounts into customer realms.
  for (const client of realm.clients) {
    if (client.clientId === "enterprise-ai-web")
      Object.assign(client, {
        rootUrl: web,
        baseUrl: web,
        redirectUris: [`${web}/*`],
        webOrigins: [web],
      });
    if (client.clientId === "enterprise-ai-swagger")
      Object.assign(client, {
        redirectUris: [`${api}/api/docs/oauth2-redirect.html`],
        webOrigins: [api],
      });
  }
  return realm;
}

async function create(tenant) {
  if (!id) usage();
  if (!existsSync(settingsFile(tenant))) {
    const config = await vendor(`/admin/tenants/${tenant}/config`);
    writeFileSync(settingsFile(tenant), `${JSON.stringify(config, null, 2)}\n`);
  }
  const config = settings(tenant);
  const platformEnv = readPlatformEnv();
  const existing = readEnvFile(envFile(tenant));
  const web = `http://localhost:${config.webPort}`;
  const api = `http://localhost:${config.apiPort}`;
  const models = allowedModels(config, platformEnv);

  // One team per tenant. Credit is authoritative in vendor-control, not LiteLLM's async spend cache.
  // Only vendor-control can reach LiteLLM from the tenant network.
  const teamId = `tenant-${tenant}`;
  const team = await gateway(`/team/info?team_id=${teamId}`).catch(() => null);
  const teamBody = {
    team_id: teamId,
    team_alias: config.name,
    models,
    max_budget: null,
  };
  await gateway(team ? "/team/update" : "/team/new", {
    method: "POST",
    body: teamBody,
  });
  let key = existing?.LITELLM_API_KEY;
  let openingCredit = config.initialCreditUsd;
  if (key) {
    const { info } = await gateway(`/key/info?key=${encodeURIComponent(key)}`);
    openingCredit =
      existing.VENDOR_MIGRATION_OPENING_USD ??
      Math.max(
        0,
        (info.max_budget ?? config.initialCreditUsd) - (info.spend ?? 0),
      ).toFixed(9);
    await gateway("/key/update", {
      method: "POST",
      body: {
        key,
        team_id: teamId,
        max_budget: null,
        ...keySettings(config, models),
      },
    });
  } else {
    const created = await gateway("/key/generate", {
      method: "POST",
      body: {
        key_alias: realmName(tenant),
        max_budget: null,
        team_id: teamId,
        ...keySettings(config, models),
        metadata: {
          tenant,
          name: config.name,
          creditGrants: [
            { at: new Date().toISOString(), usd: config.initialCreditUsd },
          ],
        },
      },
    });
    key = created.key;
  }
  // Save generated credentials before external provisioning steps, so interrupted setup is resumable.
  const adminPassword = existing?.TENANT_ADMIN_PASSWORD ?? secret(16);
  writeEnvFile(
    envFile(tenant),
    {
      ...existing,
      LITELLM_API_KEY: key,
      TENANT_ADMIN_PASSWORD: adminPassword,
      VENDOR_MIGRATION_OPENING_USD: openingCredit,
    },
    "Tenant provisioning secrets. Never commit.",
  );
  await vendor("/admin/register", {
    method: "POST",
    body: { config: { ...config, models }, key, openingCredit },
  });

  const admin = await keycloakAdmin(platformEnv);
  if ((await admin(`/realms/${realmName(tenant)}`)).status === 404) {
    const response = await admin("/realms", {
      method: "POST",
      body: realmFor(config, web, api),
    });
    if (!response.ok)
      throw new Error(
        `Creating realm ${realmName(tenant)} failed (${response.status}): ${await response.text()}`,
      );
  }

  // Preserve historical data, but disable inherited demo logins. Give each realm a unique admin.
  const realmPath = `/realms/${realmName(tenant)}`;
  const usersResponse = await admin(`${realmPath}/users?max=1000`);
  if (!usersResponse.ok) throw new Error("Cannot list tenant realm users");
  const realmUsers = await usersResponse.json();
  for (const user of realmUsers.filter((u) =>
    ["admin", "employee1", "employee2"].includes(u.username),
  )) {
    const response = await admin(`${realmPath}/users/${user.id}`, {
      method: "PUT",
      body: { enabled: false },
    });
    if (!response.ok) throw new Error("Cannot disable inherited demo account");
  }
  if (!realmUsers.some((u) => u.username === "tenant-admin")) {
    const response = await admin(`${realmPath}/users`, {
      method: "POST",
      body: {
        username: "tenant-admin",
        enabled: true,
        firstName: config.name,
        lastName: "Administrator",
        email: `admin@${tenant}.example.test`,
        emailVerified: true,
        credentials: [
          { type: "password", value: adminPassword, temporary: false },
        ],
      },
    });
    if (!response.ok) throw new Error("Cannot create tenant administrator");
  }
  const users = await (
    await admin(`${realmPath}/users?username=tenant-admin&exact=true`)
  ).json();
  const roles = await Promise.all(
    ["ADMIN", "USER"].map(async (role) =>
      (await admin(`${realmPath}/roles/${role}`)).json(),
    ),
  );
  const mapping = await admin(
    `${realmPath}/users/${users[0].id}/role-mappings/realm`,
    { method: "POST", body: roles },
  );
  if (!mapping.ok) throw new Error("Cannot assign administrator roles");

  writeEnvFile(
    envFile(tenant),
    {
      ...existing,
      TENANT_DB_PASSWORD: existing?.TENANT_DB_PASSWORD ?? secret(16),
      TENANT_ADMIN_PASSWORD: adminPassword,
      VENDOR_MIGRATION_OPENING_USD: openingCredit,
      LITELLM_API_KEY: key,
      KEYCLOAK_PUBLIC_URL: keycloakUrl(platformEnv),
      KEYCLOAK_REALM: realmName(tenant),
      WEB_PUBLIC_URL: web,
      API_PUBLIC_URL: api,
      WEB_PORT: config.webPort,
      API_PORT: config.apiPort,
      EXTERNAL_DAILY_REQUEST_LIMIT: config.dailyExternalLimits.requests,
      EXTERNAL_DAILY_TOKEN_LIMIT: config.dailyExternalLimits.tokens,
      RAG_EXTERNAL_BATCH_SIZE: config.embeddingBatch.size,
      RAG_EXTERNAL_BATCH_INTERVAL_MS: config.embeddingBatch.intervalMs,
    },
    `Customer ${tenant}: generated by npm run tenant:create. Never commit this file.`,
  );

  tenantCompose(tenant, ["up", "-d"]);
  await waitHealthy([
    `tenant-${tenant}-backend-1`,
    `tenant-${tenant}-frontend-1`,
  ]);
  console.log(
    `${config.name} is up: ${web} (realm ${realmName(tenant)}, API ${api})`,
  );
  console.log(`Models: ${models.join(", ")}`);
  console.log(
    `Sign in as tenant-admin; unique password is TENANT_ADMIN_PASSWORD in deploy/tenants/${tenant}.env (not printed).`,
  );
}

async function credits(tenant, args) {
  settings(tenant);
  const amount = args[0];
  if (!amount || amount === "--set")
    throw new Error(
      "Use a positive credit grant, not --set; history is immutable.",
    );
  const receipt = await vendor(`/admin/tenants/${tenant}/credits`, {
    method: "POST",
    body: { amount, reference: randomUUID() },
  });
  console.log(
    `${receipt.id}: granted ${usd(receipt.amount)} simulated USD. No payment collected.`,
  );
}

async function status(only) {
  const tenants = await vendor("/admin/tenants");
  console.table(
    tenants
      .filter((t) => !only || t.id === only)
      .map((t) => ({
        customer: t.id,
        credit: usd(t.credit.limit),
        spent: usd(t.credit.spent),
        reserved: usd(t.credit.reserved),
        remaining: usd(t.credit.remaining),
        enabled: t.enabled,
        models: t.config.models.join(" "),
      })),
  );
}

async function rotate(tenant) {
  const config = settings(tenant);
  const env = readEnvFile(envFile(tenant));
  if (!env) throw new Error("Create tenant first");
  const models = allowedModels(config, readPlatformEnv());
  const { key } = await gateway("/key/generate", {
    method: "POST",
    body: {
      team_id: `tenant-${tenant}`,
      // LiteLLM requires unique aliases while both the old and replacement key coexist.
      key_alias: `tenant-${tenant}-${randomUUID().slice(0, 8)}`,
      max_budget: null,
      ...keySettings(config, models),
    },
  });
  await vendor("/admin/register", {
    method: "POST",
    body: { config: { ...config, models }, key },
  });
  writeEnvFile(
    envFile(tenant),
    { ...env, LITELLM_API_KEY: key },
    "Tenant secrets. Never commit.",
  );
  await gateway("/key/delete", {
    method: "POST",
    body: { keys: [env.LITELLM_API_KEY] },
  });
  tenantCompose(tenant, ["up", "-d", "backend"]);
  await waitHealthy([`tenant-${tenant}-backend-1`]);
  console.log(
    `Tenant ${tenant} credential rotated; old credential revoked. Balance/history preserved.`,
  );
}

async function down(tenant, args) {
  settings(tenant);
  const remove = args.includes("--remove");
  tenantCompose(tenant, ["down", ...(remove ? ["--volumes"] : [])]);
  if (!remove) return;
  await vendor(`/admin/tenants/${tenant}`, {
    method: "PATCH",
    body: { enabled: false },
  });
  const env = readEnvFile(envFile(tenant));
  if (env?.LITELLM_API_KEY)
    await gateway("/key/delete", {
      method: "POST",
      body: { keys: [env.LITELLM_API_KEY] },
    });
  const admin = await keycloakAdmin();
  await admin(`/realms/${realmName(tenant)}`, { method: "DELETE" });
  rmSync(envFile(tenant), { force: true });
  console.log(
    `Customer ${tenant} removed: data, gateway key and realm deleted.`,
  );
}

if (command === "create") await create(id);
else if (command === "rotate") await rotate(id);
else if (command === "credits") await credits(id, rest);
else if (command === "status") await status(id);
else if (command === "down") await down(id, rest);
else usage();
