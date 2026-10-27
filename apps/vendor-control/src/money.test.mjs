import test from "node:test";
import assert from "node:assert/strict";
import { charge, money, priceInput, usd, validateRequest } from "./money.mjs";

test("USD arithmetic is exact and rounds fractional nanodollars upward", () => {
  assert.equal(money("0.1") + money("0.2"), money("0.3"));
  assert.equal(usd(-money("0.000000001")), "-0.000000001");
  assert.equal(charge(1, 0, { input_rate: 1n, output_rate: 0n }), 1n);
  for (const bad of ["-1", "NaN", "Infinity", "1e3", "0.0000000001", null])
    assert.throws(() => money(bad));
});
test("percentage markup calculates sale rates, not gross margin percentage", () => {
  const p = priceInput({
    model: "local-mock",
    strategy: "PERCENTAGE_MARKUP",
    inputCost: "2",
    outputCost: "4",
    markupPercent: 50,
  });
  assert.equal(p.input, money("3"));
  assert.equal(p.output, money("6"));
  assert.equal(
    charge(3000, 700, { input_rate: p.input, output_rate: p.output }),
    money("0.0132"),
  );
  assert.throws(() =>
    priceInput({
      model: "local-mock",
      strategy: "PERCENTAGE_MARKUP",
      inputCost: "0",
      outputCost: "0",
      markupPercent: 50,
    }),
  );
});
test("text-only requests strip routing overrides and reserve a conservative maximum", () => {
  const body = {
    model: "local-mock",
    messages: [{ role: "user", content: "สวัสดี" }],
    stream: true,
    max_tokens: 32,
    api_base: "https://attacker.invalid",
    api_key: "secret",
    fallbacks: ["paid"],
    metadata: { tenant_id: "b" },
  };
  const result = validateRequest(body, false);
  assert.ok(result.input > Buffer.byteLength("สวัสดี"));
  assert.equal(result.output, 32);
  for (const key of ["api_base", "api_key", "fallbacks", "metadata"])
    assert.equal(result.upstream[key], undefined);
  assert.throws(() => validateRequest({ ...body, max_tokens: 5000 }, false));
  assert.throws(() =>
    validateRequest(
      {
        ...body,
        messages: [{ role: "user", content: [{ type: "image_url" }] }],
      },
      false,
    ),
  );
  assert.equal(
    validateRequest(
      { model: "mock-embedding", input: ["a"], dimensions: 768 },
      true,
    ).output,
    0,
  );
});
