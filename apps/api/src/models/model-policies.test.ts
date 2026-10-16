import { describe, expect, it } from "vitest";
import {
  credentialFor,
  externalProviderAllowed,
  modelAllowedForUser,
} from "./model-policies";

describe("provider and model authorization policy", () => {
  it("requires both the external switch and credentials", () => {
    expect(externalProviderAllowed("OPENAI", false, "secret")).toBe(false);
    expect(externalProviderAllowed("OPENAI", true, "")).toBe(false);
    expect(externalProviderAllowed("OPENAI", true, "secret")).toBe(true);
    expect(externalProviderAllowed("MOCK", false)).toBe(true);
  });
  it("reads each provider credential from its own variable and treats local providers as credential-free", () => {
    const env = {
      OPENAI_API_KEY: "o",
      ANTHROPIC_API_KEY: "a",
      GEMINI_API_KEY: "g",
      GROQ_CREDENTIAL_CONFIGURED: "true",
      GROQ_FREE_TIER_CONFIRMED: "true",
      OPENROUTER_CREDENTIAL_CONFIGURED: "true",
    };
    expect([
      credentialFor("OPENAI", env),
      credentialFor("ANTHROPIC", env),
      credentialFor("GEMINI", env),
      credentialFor("GROQ", env),
      credentialFor("OPENROUTER", env),
    ]).toEqual([
      "o",
      "a",
      "g",
      "groq-proxy-configured",
      "openrouter-proxy-configured",
    ]);
    expect(credentialFor("MOCK", {})).toBe("local");
  });
  it("fails closed for Groq until the operator confirms the organization is on Free tier", () => {
    expect(
      credentialFor("GROQ", {
        GROQ_CREDENTIAL_CONFIGURED: "true",
        GROQ_FREE_TIER_CONFIRMED: "false",
      }),
    ).toBeUndefined();
    expect(
      externalProviderAllowed(
        "GROQ",
        true,
        credentialFor("GROQ", { GROQ_CREDENTIAL_CONFIGURED: "true" }),
      ),
    ).toBe(false);
  });
  it("requires the OpenRouter credential proxy marker", () => {
    expect(credentialFor("OPENROUTER", {})).toBeUndefined();
    expect(
      externalProviderAllowed(
        "OPENROUTER",
        true,
        credentialFor("OPENROUTER", {
          OPENROUTER_CREDENTIAL_CONFIGURED: "true",
        }),
      ),
    ).toBe(true);
  });
  it("honors explicit user permissions over role defaults", () => {
    expect(modelAllowedForUser(["USER"], ["USER"])).toBe(true);
    expect(modelAllowedForUser(["USER"], ["USER"], false)).toBe(false);
    expect(modelAllowedForUser(["ADMIN"], ["USER"], true)).toBe(true);
  });
});
