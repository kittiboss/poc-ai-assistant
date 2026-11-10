import test from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  STAFF_AUDIENCE,
  STAFF_ROLE,
  staffVerifier,
  staffVerifierFromEnv,
} from "./staff.mjs";

const issuer = "http://idp.test/realms/vendor";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({
  keys: [
    { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" },
  ],
});
const verify = staffVerifier({ issuer, keys });

const token = ({
  roles = [STAFF_ROLE],
  aud = STAFF_AUDIENCE,
  iss = issuer,
  expires = "5m",
  key = privateKey,
} = {}) =>
  new SignJWT({ realm_access: { roles }, preferred_username: "vendor-admin" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject("user-1")
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);

test("a vendor-admin token from the vendor realm is allowed", async () => {
  assert.deepEqual(await verify(await token()), {
    subject: "user-1",
    username: "vendor-admin",
    allowed: true,
  });
});

test("a valid token without the console role is recognised but not allowed", async () => {
  const staff = await verify(await token({ roles: ["offline_access"] }));
  assert.equal(staff.allowed, false);
  assert.equal(staff.username, "vendor-admin");
});

test("tokens of another realm, audience, signer or an expired one are rejected", async () => {
  const { privateKey: otherKey } = await generateKeyPair("RS256");
  for (const bad of [
    await token({ iss: "http://idp.test/realms/tenant-a" }),
    await token({ aud: "enterprise-ai-api" }),
    await token({ key: otherKey }),
    await token({ expires: Math.floor(Date.now() / 1000) - 60 }),
    "not-a-token",
    "vendor-test-key-that-is-not-a-real-secret",
  ])
    assert.equal(await verify(bad), undefined);
});

test("an unreachable Keycloak is reported as unavailable, not as a bad token", async () => {
  const offline = staffVerifier({
    issuer,
    keys: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(offline(await token()), {
    status: 503,
    type: "auth_unavailable",
  });
});

test("staff sign-in is off unless Keycloak and the realm are configured", () => {
  assert.equal(staffVerifierFromEnv({}), undefined);
  assert.equal(
    staffVerifierFromEnv({ KEYCLOAK_URL: "http://localhost:8180" }),
    undefined,
  );
  assert.equal(
    typeof staffVerifierFromEnv({
      KEYCLOAK_URL: "http://localhost:8180",
      VENDOR_REALM: "vendor",
    }),
    "function",
  );
});
