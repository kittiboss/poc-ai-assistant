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

test("images reserve fixed tokens each, never their base64 size, and are forwarded as parts", () => {
  // A 1 MB PNG: far over the text cap in base64, but it counts as 1,120 tokens.
  const png = Buffer.alloc(1024 * 1024);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  const url = `data:image/png;base64,${png.toString("base64")}`;
  const text = { role: "user", content: "What is this?" };
  const withImage = {
    role: "user",
    content: [
      { type: "text", text: "What is this?" },
      { type: "image_url", image_url: { url, detail: "high" } },
    ],
  };
  const body = { model: "local-mock", stream: true, max_tokens: 32 };
  const plain = validateRequest({ ...body, messages: [text] }, false);
  const result = validateRequest({ ...body, messages: [withImage] }, false);
  assert.equal(plain.images, 0);
  assert.equal(result.images, 1);
  // The parts' framing adds a few bytes of text; the image adds its model's tokens.
  const framing =
    Buffer.byteLength(
      JSON.stringify([
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url" },
          ],
        },
      ]),
    ) - Buffer.byteLength(JSON.stringify([text]));
  assert.equal(result.input, plain.input + framing + 1120);
  // Each model reserves its own tokens per image.
  assert.equal(
    validateRequest(
      { ...body, model: "groq-vision", messages: [withImage] },
      false,
    ).input,
    plain.input + framing + 2048,
  );
  assert.deepEqual(result.upstream.messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url } },
      ],
    },
  ]);
  // Messages keep only their role and content.
  assert.deepEqual(
    validateRequest(
      { ...body, messages: [{ ...text, name: "x", tool_calls: [] }] },
      false,
    ).upstream.messages,
    [text],
  );
  // The text cap still applies to the text alone.
  assert.throws(
    () =>
      validateRequest(
        {
          ...body,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "x".repeat(250000) },
                withImage.content[1],
              ],
            },
          ],
        },
        false,
      ),
    /Input too large/,
  );
  for (const content of [[], [{ type: "text" }], {}, null])
    assert.throws(() =>
      validateRequest(
        { ...body, messages: [{ role: "user", content }] },
        false,
      ),
    );
});
