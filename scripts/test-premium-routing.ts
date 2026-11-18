import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { encode } from "next-auth/jwt";
import postgres from "postgres";
import { LUNA } from "../lib/ai/routing/catalog";
import { createUsageLedger } from "../lib/ai/routing/ledger";

const origin = "http://localhost:3101";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";
const dbUrl =
  "postgres://postgres:synthetic-local-test-password@127.0.0.1:55432/sdk7_tests";
async function request(path: string, data?: unknown) {
  const token = await encode({
    secret: "synthetic-readiness-ui-secret-with-at-least-32-characters",
    salt: "authjs.session-token",
    token: { id: userId, email: "owner@example.test", type: "regular" },
  });
  return fetch(`${origin}${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      cookie: `authjs.session-token=${token}`,
      "content-type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
const payload = (prompt: string) => ({
  id: crypto.randomUUID(),
  message: {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text: prompt }],
  },
  selectedChatModel: LUNA,
  selectedVisibilityType: "private",
});

test("actual OpenAI route: transient fallback, measured usage, billing stop, safe persistence and owner usage", async () => {
  const body = payload("test-transient bilingual follow-up");
  const response = await request("/api/chat", body);
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /English reply/);
  const history = await (
    await request(`/api/messages?chatId=${body.id}`)
  ).json();
  assert.equal(history.messages.length, 2);
  const sql = postgres(dbUrl);
  try {
    const calls =
      await sql`SELECT * FROM "ModelUsage" WHERE "requestId"=${body.message.id} ORDER BY "createdAt"`;
    assert.deepEqual(
      calls.map((c) => c.model),
      [LUNA, "gpt-6.1-terra"]
    );
    assert.equal(calls[1].fallbackReason, "transient");
    assert.equal(calls[1].inputTokens, 100);
    assert.equal(calls[1].cachedInputTokens, 20);
    assert.equal(calls[1].cacheWriteTokens, 40);
    assert.equal(calls[1].outputTokens, 30);
    assert.equal(calls[1].reasoningTokens, 5);
    assert.ok(Number(calls[1].estimatedUsd) > 0);
    assert.equal(calls[0].usageReported, false);
    assert.equal(calls[0].estimatedUsd, null);
    const exhausted = payload("test-billing preserve this conversation");
    const stopped = await request("/api/chat", exhausted);
    const text = await stopped.text();
    assert.match(text, /spending allowance|credit limit/);
    assert.doesNotMatch(text, /private billing|credit_balance_exhausted/);
    const billing =
      await sql`SELECT * FROM "ModelUsage" WHERE "requestId"=${exhausted.message.id}`;
    assert.equal(billing.length, 1);
    assert.equal(billing[0].model, LUNA);
    assert.equal(billing[0].outcome, "billing");
    const saved = await (
      await request(`/api/messages?chatId=${exhausted.id}`)
    ).json();
    assert.equal(
      saved.messages.filter((m: { role: string }) => m.role === "user").length,
      1
    );
    const usage = await request("/api/usage");
    assert.equal(usage.status, 200);
    const summary = await usage.json();
    assert.ok(summary.invocations > 2);
    assert.ok(summary.fallbackInvocations >= 1);
    assert.ok(summary.dailyEstimatedUsd > 0);
    assert.ok(summary.monthlyEstimatedUsd >= summary.dailyEstimatedUsd);
    assert.equal((await fetch(`${origin}/api/usage`)).status, 401);
    const holdId = crypto.randomUUID();
    await sql`INSERT INTO "ModelUsage" ("id","userId","requestId","model","reservedUsd") VALUES (${holdId},${userId},${crypto.randomUUID()},${LUNA},10)`;
    try {
      const before = readFileSync("/tmp/sdk7-provider-calls.jsonl", "utf8")
        .trim()
        .split("\n").length;
      const paused = payload("Allowance reached keep my message");
      const pausedText = await (await request("/api/chat", paused)).text();
      assert.match(pausedText, /spending allowance/);
      assert.equal(
        readFileSync("/tmp/sdk7-provider-calls.jsonl", "utf8")
          .trim()
          .split("\n").length,
        before
      );
      const retained = await (
        await request(`/api/messages?chatId=${paused.id}`)
      ).json();
      assert.equal(retained.messages.length, 1);
    } finally {
      await sql`DELETE FROM "ModelUsage" WHERE "id"=${holdId}`;
    }
  } finally {
    await sql.end();
  }
});

test("PostgreSQL spend reservations serialize across different requests and fail closed", async () => {
  const sql = postgres(dbUrl);
  const owner = crypto.randomUUID();
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  try {
    await sql`INSERT INTO "User" ("id","email") VALUES (${owner},'spend-test@example.test')`;
    await sql`INSERT INTO "ModelUsage" ("id","userId","requestId","model","reservedUsd") VALUES (${crypto.randomUUID()},${owner},${crypto.randomUUID()},${LUNA},9.99)`;
    const outcomes = await Promise.allSettled([
      createUsageLedger(owner, a).reserve({ model: LUNA, reserveUsd: 0.006 }),
      createUsageLedger(owner, b).reserve({ model: LUNA, reserveUsd: 0.006 }),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
    const [total] =
      await sql`SELECT SUM(COALESCE("estimatedUsd","reservedUsd")) AS usd FROM "ModelUsage" WHERE "userId"=${owner}`;
    assert.ok(Number(total.usd) <= 10);
  } finally {
    await sql`DELETE FROM "ModelUsage" WHERE "userId"=${owner}`;
    await sql`DELETE FROM "User" WHERE "id"=${owner}`;
    await sql.end();
  }
});
