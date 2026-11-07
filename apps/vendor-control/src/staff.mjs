import { createRemoteJWKSet, jwtVerify } from "jose";
import { Fault } from "./store.mjs";

/** The realm role that lets a Keycloak account use the vendor console. */
export const STAFF_ROLE = "vendor-admin";
/** Access tokens of the vendor realm carry this audience (scripts/platform/vendor-realm.mjs). */
export const STAFF_AUDIENCE = "vendor-control";

/**
 * Checks an access token of a vendor staff member, signed in to the `vendor` realm through the
 * vendor console. Resolves to undefined when the token is not valid (signature, issuer, audience,
 * expiry); otherwise to who it is and whether the account holds the console role. Fails with 503
 * when Keycloak's signing keys cannot be fetched, so an outage does not look like a bad sign-in.
 */
export function staffVerifier({ issuer, keys }) {
  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer,
        audience: STAFF_AUDIENCE,
        algorithms: ["RS256"],
      }));
    } catch (error) {
      // Node's fetch fails with a TypeError; jose reports a slow key endpoint as ERR_JWKS_TIMEOUT.
      if (error?.code === "ERR_JWKS_TIMEOUT" || error instanceof TypeError)
        throw new Fault(
          503,
          "auth_unavailable",
          "Sign-in service is unavailable",
        );
      return undefined;
    }
    const roles = payload.realm_access?.roles;
    return {
      subject: payload.sub,
      username: String(payload.preferred_username ?? payload.sub),
      allowed: Array.isArray(roles) && roles.includes(STAFF_ROLE),
    };
  };
}

/**
 * Staff sign-in from the environment, or undefined when it is not configured. The issuer is the
 * Keycloak address the browser signs in at; the signing keys are fetched over the internal network.
 */
export function staffVerifierFromEnv(env = process.env) {
  if (!env.KEYCLOAK_URL || !env.VENDOR_REALM) return undefined;
  const internal = env.KEYCLOAK_INTERNAL_URL || env.KEYCLOAK_URL;
  return staffVerifier({
    issuer: `${env.KEYCLOAK_URL}/realms/${env.VENDOR_REALM}`,
    keys: createRemoteJWKSet(
      new URL(
        `${internal}/realms/${env.VENDOR_REALM}/protocol/openid-connect/certs`,
      ),
    ),
  });
}
