// The `vendor` realm of the platform Keycloak: vendor staff sign in to the vendor console here.
// `npm run platform:up` runs it after Keycloak is healthy, every time; existing passwords are kept.
import { consoleUrl, keycloakAdmin } from './lib.mjs';

export const VENDOR_REALM = 'vendor';
/** Must match apps/vendor-control/src/staff.mjs. */
const STAFF_ROLE = 'vendor-admin';
const STAFF_AUDIENCE = 'vendor-control';
const CLIENT_ID = 'vendor-console';
const ADMIN_USERNAME = 'vendor-admin';

/** Public client with PKCE; its access tokens are meant for vendor-control's admin API. */
const consoleClient = (url) => ({
  clientId: CLIENT_ID,
  name: 'Vendor Console',
  enabled: true,
  publicClient: true,
  standardFlowEnabled: true,
  implicitFlowEnabled: false,
  directAccessGrantsEnabled: false,
  serviceAccountsEnabled: false,
  rootUrl: url,
  baseUrl: url,
  redirectUris: [`${url}/*`],
  webOrigins: [url],
  // '+': signing out may return to any of the redirect URIs.
  attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': '+' },
  protocolMappers: [
    {
      name: `${STAFF_AUDIENCE} audience`,
      protocol: 'openid-connect',
      protocolMapper: 'oidc-audience-mapper',
      consentRequired: false,
      config: {
        'included.custom.audience': STAFF_AUDIENCE,
        'id.token.claim': 'false',
        'access.token.claim': 'true',
        'introspection.token.claim': 'true',
      },
    },
  ],
});

const realm = (url) => ({
  realm: VENDOR_REALM,
  displayName: 'Vendor Console',
  enabled: true,
  registrationAllowed: false,
  resetPasswordAllowed: false,
  rememberMe: false,
  editUsernameAllowed: false,
  // Repeated wrong passwords lock the account for a while, longer each time (up to 15 minutes).
  bruteForceProtected: true,
  failureFactor: 5,
  waitIncrementSeconds: 60,
  maxFailureWaitSeconds: 900,
  // Short access tokens that the console renews while it is open; idle for 30 minutes or 8 hours in all ends the session.
  accessTokenLifespan: 300,
  ssoSessionIdleTimeout: 1800,
  ssoSessionMaxLifespan: 28800,
  roles: { realm: [{ name: STAFF_ROLE, description: 'Uses the vendor console' }] },
  clients: [consoleClient(url)],
});

async function ok(response, action) {
  if (!response.ok) throw new Error(`${action} failed (${response.status}): ${await response.text()}`);
  return response;
}

/** Creates the realm once, keeps the console client's addresses current and the admin account in place. */
export async function syncVendorRealm(env) {
  const admin = await keycloakAdmin(env);
  const url = consoleUrl(env);
  const path = `/realms/${VENDOR_REALM}`;
  const existing = await admin(path);
  if (existing.status === 404) {
    await ok(await admin('/realms', { method: 'POST', body: realm(url) }), `Creating realm ${VENDOR_REALM}`);
  } else {
    await ok(existing, `Reading realm ${VENDOR_REALM}`);
    const [client] = await (await admin(`${path}/clients?clientId=${CLIENT_ID}`)).json();
    if (!client) {
      await ok(await admin(`${path}/clients`, { method: 'POST', body: consoleClient(url) }), `Creating client ${CLIENT_ID}`);
    } else {
      const { rootUrl, baseUrl, redirectUris, webOrigins } = consoleClient(url);
      await ok(
        await admin(`${path}/clients/${client.id}`, {
          method: 'PUT',
          body: { ...client, rootUrl, baseUrl, redirectUris, webOrigins },
        }),
        `Updating client ${CLIENT_ID}`,
      );
    }
  }

  const find = async () =>
    (await (await admin(`${path}/users?username=${ADMIN_USERNAME}&exact=true`)).json())[0];
  let user = await find();
  if (!user) {
    await ok(
      await admin(`${path}/users`, {
        method: 'POST',
        body: {
          username: ADMIN_USERNAME,
          enabled: true,
          // Keycloak's user profile asks for these on the first sign-in when they are missing.
          firstName: 'Vendor',
          lastName: 'Administrator',
          email: `${ADMIN_USERNAME}@vendor.example.test`,
          emailVerified: true,
          credentials: [{ type: 'password', value: env.VENDOR_CONSOLE_PASSWORD, temporary: false }],
        },
      }),
      `Creating ${ADMIN_USERNAME}`,
    );
    user = await find();
  }
  const role = await (await ok(await admin(`${path}/roles/${STAFF_ROLE}`), `Reading role ${STAFF_ROLE}`)).json();
  await ok(
    await admin(`${path}/users/${user.id}/role-mappings/realm`, { method: 'POST', body: [role] }),
    `Granting ${STAFF_ROLE} to ${ADMIN_USERNAME}`,
  );
  return { realm: VENDOR_REALM, username: ADMIN_USERNAME, consoleUrl: url };
}
