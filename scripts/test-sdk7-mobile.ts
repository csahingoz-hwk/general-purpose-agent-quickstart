import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type BrowserContext, chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import postgres from "postgres";
import { acquireChatLock } from "../lib/db/chat-lock";
import type { ChatMessage } from "../lib/types";

const origin = "http://localhost:3101";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";
const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
const dbUrl =
  "postgres://postgres:synthetic-local-test-password@127.0.0.1:55432/sdk7_tests";

async function authenticate(context: BrowserContext) {
  const value = await encode({
    secret,
    salt: "authjs.session-token",
    token: { id: userId, email: "owner@example.test", type: "regular" },
  });
  await context.addCookies([
    { name: "authjs.session-token", value, url: origin },
  ]);
}

test("real local chat routes: both models, bilingual streaming, weather, interactive inbox and PostgreSQL History", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await authenticate(context);
    const page = await context.newPage();
    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    for (const name of ["Everyday chat", "Detailed chat"]) {
      await page.goto(origin);
      await page.getByTestId("model-selector").waitFor();
      if (name === "Detailed chat") {
        await page.getByTestId("model-selector").click();
        await page.getByPlaceholder("Search ready models…").fill("Detailed");
        await page.getByPlaceholder("Search ready models…").press("ArrowDown");
        await page.getByPlaceholder("Search ready models…").press("Enter");
        await expect(page.getByTestId("model-selector")).toHaveText(
          "Detailed chat"
        );
      }
      await page
        .getByTestId("multimodal-input")
        .last()
        .fill("Merhaba, Türkçe cevap ver.");
      await page.getByTestId("send-button").last().click();
      await expect(page.getByTestId("message-assistant")).toContainText(
        "Türkçe yanıt"
      );
      // Visible text is not stream completion. Keep a draft while the
      // provider emits its delayed finish frames; Enter must not send it.
      await expect(page.getByTestId("stop-button").last()).toBeVisible();
      await expect(page.getByTestId("send-button")).toHaveCount(0);
      await page
        .getByTestId("multimodal-input")
        .last()
        .fill("Please answer in English now.");
      await page.getByTestId("multimodal-input").last().press("Enter");
      await expect(page.getByTestId("message-user")).toHaveCount(1);
      await expect(page.getByTestId("multimodal-input").last()).toHaveValue(
        "Please answer in English now."
      );
      const followUp = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/chat") &&
          response.request().method() === "POST"
      );
      // This waits for the real ready state, not a timeout or text heuristic.
      await page.getByTestId("send-button").last().click();
      const accepted = await followUp;
      assert.equal(accepted.status(), 200);
      const submitted = accepted.request().postDataJSON();
      assert.equal(
        submitted.message.parts[0].text,
        "Please answer in English now."
      );
      assert.equal(
        submitted.selectedChatModel,
        name === "Everyday chat" ? "openai/gpt-oss-20b" : "openai/gpt-oss-120b"
      );
      await expect(page.getByTestId("message-assistant").last()).toContainText(
        "English reply"
      );
      await expect(page.getByTestId("stop-button")).toHaveCount(0);
      const chatUrl = page.url();
      await page.reload();
      await expect(page.getByTestId("message-user")).toHaveCount(2);
      await expect(page.getByTestId("message-assistant")).toHaveCount(2);
      const persisted = await context.request.get(
        `${origin}/api/messages?chatId=${chatUrl.split("/").at(-1)}`
      );
      const body = (await persisted.json()) as { messages: ChatMessage[] };
      assert.equal(body.messages.length, 4);
      assert.ok(
        body.messages
          .filter((m) => m.role === "assistant")
          .every((m) =>
            m.parts.some(
              (p) =>
                p.type === "data-reply-status" && p.data.status === "complete"
            )
          )
      );
      await page
        .getByTestId("multimodal-input")
        .last()
        .fill("What is the weather in London?");
      await page.getByTestId("send-button").last().click();
      await expect(page.getByTestId("message-assistant").last()).toContainText(
        "Here is the result"
      );
      await expect(page.getByTestId("stop-button")).toHaveCount(0);
      await page
        .getByTestId("multimodal-input")
        .last()
        .fill("Please show a fictional inbox demo chart.");
      await page.getByTestId("send-button").last().click();
      await expect(page.getByTestId("fictional-inbox-card")).toBeVisible();
      const callsBefore = readFileSync("/tmp/sdk7-provider-calls.jsonl", "utf8")
        .trim()
        .split("\n").length;
      await page.getByTestId("demo-inbox-slider").fill("5");
      await expect(page.getByTestId("demo-inbox-priority")).toHaveText("5 / 5");
      assert.equal(
        readFileSync("/tmp/sdk7-provider-calls.jsonl", "utf8")
          .trim()
          .split("\n").length,
        callsBefore
      );
      await expect(page.getByTestId("stop-button")).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId("fictional-inbox-card")).toBeVisible();
      const history = await context.request.get(
        `${origin}/api/history?limit=20`
      );
      assert.equal(history.status(), 200);
      assert.ok(
        (await history.json()).chats.some((c: { id: string }) =>
          chatUrl.endsWith(c.id)
        )
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      );
      await page.goto(origin);
      await page.locator("header button").first().click();
      const historyLink = page.locator(
        `a[href="/chat/${chatUrl.split("/").at(-1)}"]`
      );
      await historyLink.click();
      await page.waitForURL(chatUrl);
      await expect(page.getByTestId("fictional-inbox-card")).toBeVisible();
      const artifactId = crypto.randomUUID();
      const artifactResponse = await context.request.post(
        `${origin}/api/chat`,
        {
          data: {
            id: artifactId,
            message: {
              id: crypto.randomUUID(),
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "Create a document about a synthetic test.",
                },
              ],
            },
            selectedChatModel:
              name === "Everyday chat"
                ? "openai/gpt-oss-20b"
                : "openai/gpt-oss-120b",
            selectedVisibilityType: "private",
          },
        }
      );
      assert.equal(artifactResponse.status(), 200);
      const artifactStream = await artifactResponse.text();
      assert.match(artifactStream, /data-textDelta/);
      const streamedArtifact = artifactStream
        .split("\n")
        .filter((line) => line.startsWith("data: {"))
        .map((line) => JSON.parse(line.slice(6)))
        .filter((part) => part.type === "data-textDelta")
        .map((part) => part.data)
        .join("");
      assert.equal(streamedArtifact, "A complete synthetic artifact.");
      const sql = postgres(dbUrl);
      try {
        const docs =
          await sql`select content from "Document" where title='Synthetic artifact' and "userId"=${userId}`;
        assert.ok(docs.length > 0);
        assert.ok(
          docs.every((doc) => doc.content === "A complete synthetic artifact.")
        );
      } finally {
        await sql.end();
      }
      console.log(
        `PASS ${name}: actual SDK 7 stream, EN/TR, tool card, saved PostgreSQL turns and History; slider stays local`
      );
    }
    const rows = readFileSync("/tmp/sdk7-provider-calls.jsonl", "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      rows.some(
        (r) =>
          r.model === "openai/gpt-oss-20b" && r.prompt.includes("Please answer")
      )
    );
    assert.ok(
      rows.some(
        (r) =>
          r.model === "openai/gpt-oss-120b" &&
          r.prompt.includes("Please answer")
      )
    );
    assert.ok(
      rows.some((r) =>
        r.messages.some((m: { role: string }) => m.role === "tool")
      )
    );
    for (const row of rows.filter((r) =>
      r.messages.some((m: { role: string }) => m.role === "tool")
    )) {
      assert.doesNotMatch(
        JSON.stringify(row.messages),
        /mira@example.test|demo-12/
      );
    }
    await page.screenshot({
      path: "/tmp/sdk7-mobile-inbox.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
});

test("real local retry recovers one persisted turn; repeated and simultaneous requests cannot duplicate work", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await authenticate(context);
    const page = await context.newPage();
    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    await page.goto(origin);
    await page.getByTestId("model-selector").waitFor();
    await page
      .getByTestId("multimodal-input")
      .last()
      .fill(`Hello test-rate-once ${crypto.randomUUID()}`);
    await page.getByTestId("send-button").last().click();
    await expect(page.getByTestId("retry-response")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("org_private123");
    assert.equal(
      await page.getByTestId("multimodal-input").last().inputValue(),
      ""
    );
    await page.reload();
    await page.getByTestId("retry-response").click();
    await expect(page.getByTestId("message-assistant")).toContainText(
      "English reply"
    );
    await page.reload();
    await expect(page.getByTestId("message-user")).toHaveCount(1);
    await expect(page.getByTestId("message-assistant")).toHaveCount(1);
    // Interrupt a real provider stream, persist the partial reply, then replace
    // that same assistant ID on retry rather than appending duplicates.
    await page.goto(origin);
    await page.getByTestId("model-selector").waitFor();
    await page
      .getByTestId("multimodal-input")
      .last()
      .fill(`Hello test-partial-once ${crypto.randomUUID()}`);
    await page.getByTestId("send-button").last().click();
    await expect(page.getByTestId("retry-response")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("message-assistant")).toContainText(
      "Partial synthetic reply"
    );
    await page.getByTestId("retry-response").click();
    await expect(page.getByTestId("message-assistant")).toContainText(
      "English reply"
    );
    await page.reload();
    await expect(page.getByTestId("message-user")).toHaveCount(1);
    await expect(page.getByTestId("message-assistant")).toHaveCount(1);

    const chatId = crypto.randomUUID();
    const message = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "Hello test-concurrent" }],
    };
    const data = {
      id: chatId,
      message,
      selectedChatModel: "openai/gpt-oss-20b",
      selectedVisibilityType: "private",
    };
    const results = await Promise.all([
      context.request.post(`${origin}/api/chat`, { data }),
      context.request.post(`${origin}/api/chat`, {
        data: { ...data, retry: true },
      }),
    ]);
    assert.deepEqual(results.map((r) => r.status()).sort(), [200, 429]);
    const replay = await context.request.post(`${origin}/api/chat`, {
      data: { ...data, retry: true },
    });
    assert.equal(replay.status(), 400);
    const saved = await context.request.get(
      `${origin}/api/messages?chatId=${chatId}`
    );
    assert.equal((await saved.json()).messages.length, 2);
    console.log(
      "PASS: reload-safe Retry, no composer duplicate, canonical server input, cross-connection concurrency guard and replay rejection"
    );
  } finally {
    await browser.close();
  }
});

test("PostgreSQL coordination releases after success/error and fails closed without direct connection", async () => {
  const id = crypto.randomUUID();
  const release = await acquireChatLock(id, dbUrl);
  assert.ok(release);
  assert.equal(await acquireChatLock(id, dbUrl), null);
  await release();
  await release();
  const next = await acquireChatLock(id, dbUrl);
  assert.ok(next);
  await next();
  await assert.rejects(() => acquireChatLock(id, ""), /Direct database/);
  const sql = postgres(dbUrl);
  try {
    const rows =
      await sql`select count(*)::int as count from pg_locks where locktype='advisory' and granted`;
    assert.equal(rows[0].count, 0);
  } finally {
    await sql.end();
  }
});
