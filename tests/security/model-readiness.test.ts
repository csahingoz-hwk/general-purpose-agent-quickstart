import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GROQ_BASE_URL,
  parseVerification,
  verifyGroqModels,
} from "../../lib/ai/groq-verification";

const model = "openai/gpt-oss-20b";
const secret = "synthetic-test-key";

test("no configured key means no model discovery or inference", async () => {
  const result = await verifyGroqModels(undefined, () => {
    throw new Error("must not call network");
  });
  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.modelIds, []);
});

test("catalogue entries alone never establish usability; only allowed models are probed", async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = String(input);
    urls.push(url);
    assert.ok(url.startsWith(GROQ_BASE_URL));
    if (url.endsWith("/models")) {
      return Promise.resolve(
        Response.json({ data: [{ id: model }, { id: "premium/not-approved" }] })
      );
    }
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, model);
    assert.notEqual(body.stream, true);
    assert.equal(body.max_tokens, 128);
    assert.deepEqual(body.messages, [
      {
        role: "user",
        content: "Return only these two greetings: Merhaba Hello",
      },
    ]);
    return Promise.resolve(
      Response.json({
        choices: [{ index: 0, message: { content: "Merhaba Hello" } }],
      })
    );
  };
  const result = await verifyGroqModels(secret, fetcher);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.modelIds, [model]);
  assert.equal(urls.length, 2);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("invalid credentials stop before any inference", async () => {
  let calls = 0;
  const result = await verifyGroqModels(secret, () => {
    calls += 1;
    return Promise.resolve(new Response(null, { status: 401 }));
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "verification_failed");
  assert.deepEqual(result.modelIds, []);
});

test("free quota exhaustion stops probes and never falls back to another provider", async () => {
  const urls: string[] = [];
  const result = await verifyGroqModels(secret, (input) => {
    const url = String(input);
    urls.push(url);
    return Promise.resolve(
      url.endsWith("/models")
        ? Response.json({
            data: [{ id: model }, { id: "openai/gpt-oss-120b" }],
          })
        : new Response(null, { status: 429 })
    );
  });
  assert.equal(result.status, "verification_failed");
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.startsWith(GROQ_BASE_URL)));
});

test("empty responses and network errors cannot become ready or leak error details", async () => {
  const empty = await verifyGroqModels(secret, (input) =>
    Promise.resolve(
      String(input).endsWith("/models")
        ? Response.json({ data: [{ id: model }] })
        : Response.json({ choices: [{ index: 0, message: { content: "" } }] })
    )
  );
  assert.deepEqual(empty.modelIds, []);
  const failed = await verifyGroqModels(secret, () => {
    throw new Error(`private ${secret}`);
  });
  assert.equal(failed.status, "verification_failed");
  assert.equal(JSON.stringify(failed).includes(secret), false);
});

test("verification metadata cannot authorize a foreign or premium model", () => {
  for (const value of [
    undefined,
    "not JSON",
    "{}",
    JSON.stringify({
      status: "ready",
      modelIds: ["anthropic/claude-sonnet-4.6"],
      checkedAt: "test",
    }),
  ]) {
    assert.deepEqual(parseVerification(value).modelIds, []);
  }
  const verified = parseVerification(
    JSON.stringify({
      status: "ready",
      modelIds: [model, "premium/other"],
      checkedAt: "2026-11-08T15:00:00Z",
    })
  );
  assert.deepEqual(verified.modelIds, [model]);
});
