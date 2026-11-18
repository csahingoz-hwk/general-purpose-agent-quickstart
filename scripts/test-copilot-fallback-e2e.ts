import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import {
  COPILOT_CLAUDE_HAIKU_ID,
  COPILOT_CLAUDE_HAIKU_NAME,
  createCopilotHaikuVmAdapter,
} from "../lib/ai/copilot-vm-model";
import { ARGON, COPILOT_HAIKU, HYDROGEN } from "../lib/ai/routing/catalog";
import { createRoutedModel } from "../lib/ai/routing/model";
import type { InferenceSession } from "../lib/ai/routing/session";
import { createVertexGeminiAdapter } from "../lib/ai/vertex-model";

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 3124;
const origin = `http://127.0.0.1:${port}`;
const owner = "owner@example.test";
const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";

async function waitForServer(url: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/login`, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) {
        return;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function buildSseBody(chunks: Record<string, unknown>[]): string {
  return `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
}

test("Copilot Claude Haiku 5.5 Fallback E2E (Live Cloud VM + 390x844 iPhone UI: real model badge, double-fail Retry button, Setup checklist)", async () => {
  const scratchDir =
    process.env.VERIFY_SCREENSHOT_DIR ||
    join(process.cwd(), ".next/verify-screenshots");
  mkdirSync(scratchDir, { recursive: true });

  // 1) Real live Cloud VM bridge fallback check (Hydrogen 503 -> LIVE Copilot Claude Haiku 5.5 on assistant-computer-01)
  let liveFallbackAnswer =
    "The Uber Boat by Thames Clippers ride from Westminster to Greenwich takes about 35 to 40 minutes.";
  let liveTtftMs = 0;
  let liveTotalMs = 0;

  if (
    process.env.CLOUD_COMPUTER_RELAY_URL?.trim() &&
    process.env.CLOUD_COMPUTER_HMAC_SECRET?.trim() &&
    process.env.COPILOT_GITHUB_TOKEN?.trim()
  ) {
    const fallbacks: { fromModel: string; toModel: string; reason: string }[] =
      [];
    const session: InferenceSession = {
      available: [HYDROGEN, ARGON, COPILOT_HAIKU],
      exposed: false,
      toolBoundary: false,
      fallbackUsed: false,
      onFallback: (info) => fallbacks.push(info),
      ledger: {
        reserve: () => Promise.resolve("live-res-1"),
        settle: () => Promise.resolve(),
      },
    };
    const routed = createRoutedModel(
      HYDROGEN,
      session,
      (id) => {
        if (id === HYDROGEN) {
          return createVertexGeminiAdapter(HYDROGEN, {
            projectId: "project-cd0bc64c-0025-446c-b41",
            getAccessToken: () => Promise.resolve("ya29.simulated-outage"),
            fetcher: () =>
              Promise.resolve(
                new Response("Simulated Vertex 503", { status: 503 })
              ),
          });
        }
        return createCopilotHaikuVmAdapter();
      },
      { gateway: false, vertexSearch: true }
    );

    const t0 = Date.now();
    const { stream } = await routed.doStream({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "In one short sentence, how long is the Thames boat ride from Westminster to Greenwich?",
            },
          ],
        },
      ],
    });
    const reader = stream.getReader();
    const deltas: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.type === "text-delta") {
        if (liveTtftMs === 0) {
          liveTtftMs = Date.now() - t0;
        }
        deltas.push(value.delta);
      }
    }
    liveTotalMs = Date.now() - t0;
    liveFallbackAnswer = deltas.join("").trim();
    assert.ok(
      liveFallbackAnswer.length > 10,
      "Expected non-empty live Copilot Claude Haiku 5.5 answer"
    );
    assert.equal(fallbacks.length, 1);
    assert.equal(fallbacks[0]?.fromModel, HYDROGEN);
    assert.equal(fallbacks[0]?.toModel, COPILOT_HAIKU);
    console.log(
      `LIVE_COPILOT_FALLBACK: PASS model=${COPILOT_CLAUDE_HAIKU_ID} ttft=${liveTtftMs}ms total=${liveTotalMs}ms chars=${liveFallbackAnswer.length}`
    );
  }

  // 2) 390x844 iPhone Playwright E2E
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync(MAC_CHROME) ? MAC_CHROME : undefined);
  const browser = await chromium.launch({ headless: true, executablePath });

  const server = spawn(
    "npx",
    ["next", "dev", "--turbo", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        AUTH_SECRET: secret,
        APP_OWNER_EMAIL: owner,
        PLAYWRIGHT: "True",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    }
  );
  server.unref();

  try {
    await waitForServer(origin);

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      reducedMotion: "reduce",
    });

    const authCookie = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: authCookie, url: origin },
    ]);

    const page = await context.newPage();
    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C = window.V_C || []; window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/models*", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: HYDROGEN,
          models: [
            {
              id: HYDROGEN,
              name: "Gemini 4 Hydrogen",
              provider: "google",
              description: "Default · fast ~1s responses via Vertex AI",
            },
            {
              id: ARGON,
              name: "Gemini 4 Argon",
              provider: "google",
              description: "Deep research & hard questions · Vertex AI",
            },
          ],
        },
      })
    );
    await page.route("**/api/voice/readiness*", (route) =>
      route.fulfill({ json: { liveReady: true, sttReady: true } })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/vote*", (route) => route.fulfill({ json: [] }));

    // A) Verify /setup checklist shows Copilot Claude Haiku 5.5 fallback + direct GitHub token link + zero secret leak
    await page.goto(`${origin}/setup`, { waitUntil: "networkidle" });
    await expect(
      page.getByText("Copilot Claude Haiku 5.5 fallback (Cloud VM)")
    ).toBeVisible();
    const ghTokenLink = page.getByRole("link", {
      name: "Copilot token",
      exact: true,
    });
    await expect(ghTokenLink).toBeVisible();
    assert.equal(
      await ghTokenLink.getAttribute("href"),
      "https://github.com/settings/personal-access-tokens/new"
    );
    const linkBox = await ghTokenLink.boundingBox();
    assert.ok(linkBox && linkBox.height >= 44, "GitHub token link >=44px");
    const setupScrollW = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(setupScrollW <= 390, `Setup scrollWidth ${setupScrollW} <= 390`);
    const setupHtml = await page.content();
    const secretVal = process.env.COPILOT_GITHUB_TOKEN?.trim();
    if (secretVal && secretVal.length > 8) {
      assert.equal(
        setupHtml.includes(secretVal),
        false,
        "Token value must NEVER appear in DOM"
      );
    }
    await page.screenshot({
      path: join(scratchDir, "verify-copilot-setup-checklist-390.png"),
      fullPage: false,
    });

    // B) Verify Chat UI: Scenario 1 = Double failure shows error + Retry (>=44px); Scenario 2 = Retry succeeds on Copilot Claude Haiku 5.5 and renders real model name badge!
    let chatTurnAttempt = 0;
    await page.route("**/api/chat", async (route) => {
      chatTurnAttempt += 1;
      if (chatTurnAttempt === 1) {
        // Both Vertex and Copilot failed -> emit turn-status + error chunk
        const sse = buildSseBody([
          { type: "start", messageId: "msg-fail-1" },
          {
            type: "data-turn-status",
            data: { phase: "thinking", model: COPILOT_HAIKU },
          },
          {
            type: "data-model-used",
            data: {
              modelId: COPILOT_HAIKU,
              modelName: COPILOT_CLAUDE_HAIKU_NAME,
              isFallback: true,
              fallbackFrom: HYDROGEN,
            },
          },
          {
            type: "error",
            errorText:
              "Couldn't finish this reply right now. Your message is saved — tap Retry response below to try again. No paid fallback was used.",
          },
        ]);
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          body: sse,
        });
        return;
      }

      // Attempt 2 (after tapping Retry response): Copilot Claude Haiku 5.5 fallback succeeds!
      const sse = buildSseBody([
        { type: "start", messageId: "msg-ok-2" },
        {
          type: "data-turn-status",
          data: { phase: "thinking", model: COPILOT_HAIKU },
        },
        {
          type: "data-model-used",
          data: {
            modelId: COPILOT_HAIKU,
            modelName: COPILOT_CLAUDE_HAIKU_NAME,
            isFallback: true,
            fallbackFrom: HYDROGEN,
          },
        },
        { type: "text-start", id: "txt-ok-2" },
        {
          type: "text-delta",
          id: "txt-ok-2",
          delta: liveFallbackAnswer,
        },
        { type: "text-end", id: "txt-ok-2" },
        { type: "finish", finishReason: "stop" },
      ]);
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: sse,
      });
    });

    await page.goto(origin, { waitUntil: "networkidle" });
    await expect(page.getByTestId("model-selector")).toContainText(
      "Gemini 4 Hydrogen"
    );

    const composer = page.getByTestId("multimodal-input");
    await composer.fill(
      "How long is the Thames boat ride from Westminster to Greenwich?"
    );
    await page.getByTestId("send-button").click();

    // Verify double-failure error card + Retry response button (>=44px)
    const retryBtn = page.getByTestId("retry-response");
    await expect(retryBtn).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("reply-status-text")).toContainText(
      "Retry response"
    );
    const retryBox = await retryBtn.boundingBox();
    assert.ok(retryBox && retryBox.height >= 44, "Retry button >= 44px");
    const errScrollW = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(errScrollW <= 390, `Error scrollWidth ${errScrollW} <= 390`);
    await page.screenshot({
      path: join(scratchDir, "verify-copilot-double-fail-retry-390.png"),
      fullPage: false,
    });

    // Tap Retry response -> fallback answers and shows real model badge ("Claude Haiku 5.5 · Copilot fallback")
    await retryBtn.click();
    const badge = page.getByTestId("message-model-badge");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toContainText("Claude Haiku 5.5 · Copilot fallback");
    await expect(
      page.getByTestId("message-assistant").getByTestId("message-content")
    ).toContainText(liveFallbackAnswer.slice(0, 24));
    // Wait briefly for the previous error toast to auto-dismiss so user + assistant bubbles are unobstructed
    await page.waitForTimeout(4500);
    const chatScrollW = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(chatScrollW <= 390, `Chat scrollWidth ${chatScrollW} <= 390`);
    await page.screenshot({
      path: join(scratchDir, "verify-copilot-fallback-chat-390.png"),
      fullPage: false,
    });
  } finally {
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
    await browser.close();
  }
});
