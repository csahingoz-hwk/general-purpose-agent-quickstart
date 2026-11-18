import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { HYDROGEN } from "../lib/ai/routing/catalog";

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 3132;
const origin = `http://127.0.0.1:${port}`;
const owner = "csahingoz@gmail.com";
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

test("Gmail 390x844 iPhone E2E: top-level Safari /connect/google/start redirect (gmail.readonly + offline + consent), Try again recovery, single clear API-disabled card (no 'not connected' text), and 10-message inbox retry", async () => {
  const scratchDir =
    process.env.VERIFY_SCREENSHOT_DIR ||
    "/Users/caglar/.gemini/antigravity-cli/brain/dd9cadeb-6946-44ae-87cb-364a999ae07b/scratch";
  mkdirSync(scratchDir, { recursive: true });

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
        AUTH_GOOGLE_ID:
          "297951472081-syntheticclientidforplaywright.apps.googleusercontent.com",
        AUTH_GOOGLE_SECRET: "test-only-playwright-oauth-secret",
        PLAYWRIGHT: "True",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    }
  );
  server.unref();

  try {
    await waitForServer(origin);

    const authCookie = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });

    // 1) Verify GET /connect/google/start issues a real 302 top-level redirect to Google OAuth with gmail.readonly, access_type=offline, prompt=consent, and PKCE Set-Cookie!
    const oauthRes = await fetch(
      `${origin}/connect/google/start?returnTo=%2Fchat%2Ftest-1`,
      {
        headers: { cookie: `authjs.session-token=${authCookie}` },
        redirect: "manual",
      }
    );
    assert.equal(oauthRes.status, 302);
    const location = oauthRes.headers.get("location") ?? "";
    assert.ok(
      location.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"),
      `Expected Google OAuth redirect, got ${location.slice(0, 80)}`
    );
    const oauthUrl = new URL(location);
    assert.match(oauthUrl.searchParams.get("scope") ?? "", /gmail\.readonly/);
    assert.equal(oauthUrl.searchParams.get("access_type"), "offline");
    assert.equal(oauthUrl.searchParams.get("prompt"), "consent");
    assert.equal(oauthUrl.searchParams.get("include_granted_scopes"), "true");
    assert.equal(oauthUrl.searchParams.get("login_hint"), owner);
    const setCookies = oauthRes.headers.getSetCookie().join("; ");
    assert.match(setCookies, /pkce\.code_verifier/);

    // 2) Open 390x844 iPhone viewport and verify /connect/google?error=OAuthCallback recovery screen ("Try again · Tekrar dene")
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      reducedMotion: "reduce",
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

    await page.goto(
      `${origin}/connect/google?error=OAuthCallback&returnTo=%2F`,
      { waitUntil: "networkidle" }
    );
    await expect(page.getByTestId("google-connect-retry-card")).toBeVisible();
    const retryOauthBtn = page.getByTestId("google-connect-try-again-button");
    await expect(retryOauthBtn).toBeVisible();
    const retryOauthBox = await retryOauthBtn.boundingBox();
    assert.ok(retryOauthBox && retryOauthBox.height >= 44);
    assert.match(
      (await retryOauthBtn.getAttribute("href")) ?? "",
      /\/connect\/google\/start\?.*selectAccount=1/
    );

    // 3) Verify Chat 403 SERVICE_DISABLED shows ONE clear message ("Google bağlı — Google Cloud üzerinde Gmail API'yi açın" + Enable APIs + Tekrar dene) and suppresses contradictory "Google hesabınız henüz bağlanmamış" text!
    let turnCount = 0;
    await page.route("**/api/chat", async (route) => {
      turnCount += 1;
      if (turnCount === 1) {
        const sse = buildSseBody([
          { type: "start", messageId: "msg-disabled-1" },
          {
            type: "tool-input-start",
            toolCallId: "tc-gm-403",
            toolName: "gmailReadMessages",
          },
          {
            type: "tool-input-available",
            toolCallId: "tc-gm-403",
            toolName: "gmailReadMessages",
            input: {},
          },
          {
            type: "tool-output-available",
            toolCallId: "tc-gm-403",
            output: {
              status: "connector_error",
              code: "service_disabled",
              connectProvider: "google",
              accountConnected: true,
              projectNumber: "297951472081",
              enableApiUrl:
                "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com&project=297951472081",
              message:
                "Your Google account is connected, and Gmail API needs to be enabled on Google Cloud project #297951472081. Tap Enable APIs, then Try again.",
              messages: [],
            },
          },
          // Simulate model trying to emit contradictory "not connected" text: UI MUST suppress it so ONLY one clear message appears!
          { type: "text-start", id: "txt-contradict" },
          {
            type: "text-delta",
            id: "txt-contradict",
            delta: "Google hesabınız henüz bağlanmamış.",
          },
          { type: "text-end", id: "txt-contradict" },
          { type: "finish", finishReason: "stop" },
        ]);
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          body: sse,
        });
        return;
      }

      // Turn 2 (triggered by tapping "Tekrar dene" / "Try again" on the card!): returns latest 10 inbox messages!
      const tenMessages = Array.from({ length: 10 }, (_, idx) => ({
        id: `m_${idx + 1}`,
        threadId: `t_${idx + 1}`,
        subject: `Gelen kutusu mesajı #${idx + 1} — Londra uçuş ve toplantı özeti`,
        from: `Sender ${idx + 1} <sender${idx + 1}@example.com>`,
        date: "18 Nov 2026 08:50",
        fencedContent: `<untrusted_content source="connector:gmail:m_${idx + 1}">Summary ${idx + 1}</untrusted_content>`,
        suspicious: false,
      }));
      const sse = buildSseBody([
        { type: "start", messageId: "msg-inbox-10" },
        {
          type: "tool-input-start",
          toolCallId: "tc-gm-ok",
          toolName: "gmailReadMessages",
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-gm-ok",
          toolName: "gmailReadMessages",
          input: {},
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-gm-ok",
          output: {
            status: "ok",
            count: 10,
            messages: tenMessages,
          },
        },
        { type: "text-start", id: "txt-inbox-ok" },
        {
          type: "text-delta",
          id: "txt-inbox-ok",
          delta: "Gelen kutunuzdaki son 10 e-posta yukarıda listelendi.",
        },
        { type: "text-end", id: "txt-inbox-ok" },
        { type: "finish", finishReason: "stop" },
      ]);
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: sse,
      });
    });

    await page.goto(origin, { waitUntil: "networkidle" });
    await page
      .getByTestId("multimodal-input")
      .fill("Gmail kutumdaki son e-postaları getirir misin?");
    await page.getByTestId("send-button").click();

    const card = page.getByTestId("connector-connect-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    assert.equal(await card.getAttribute("data-mode"), "api_disabled");
    await expect(card).toContainText("297951472081");

    const enableBtn = page.getByTestId("enable-google-apis-button");
    await expect(enableBtn).toBeVisible();
    assert.equal(await enableBtn.getAttribute("target"), "_blank");
    assert.equal(
      await enableBtn.getAttribute("href"),
      "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com&project=297951472081"
    );
    const enableBox = await enableBtn.boundingBox();
    assert.ok(enableBox && enableBox.height >= 44);

    // Crucial: "Google hesabınız henüz bağlanmamış" MUST NOT appear anywhere!
    const chatText = await page.locator("main").innerText();
    assert.equal(
      chatText.includes("henüz bağlanmamış"),
      false,
      "Must NEVER show 'not connected' text when account IS connected and API is off"
    );
    const scrollW1 = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(scrollW1 <= 390, `scrollWidth ${scrollW1} <= 390`);

    await page.screenshot({
      path: join(scratchDir, "verify-gmail-api-disabled-one-message-390.png"),
      fullPage: false,
    });

    // 4) Tap "Tekrar dene" right on the card -> regenerates turn and renders all 10 inbox messages!
    const tryAgainBtn = page.getByTestId("connector-try-again-button");
    await expect(tryAgainBtn).toBeVisible();
    const tryBox = await tryAgainBtn.boundingBox();
    assert.ok(tryBox && tryBox.height >= 44);
    await tryAgainBtn.click();

    const summaryCard = page.getByTestId("connector-summary-gmail");
    await expect(summaryCard).toBeVisible({ timeout: 10_000 });
    await expect(summaryCard).toContainText("Gelen kutusu mesajı #1");
    await expect(summaryCard).toContainText("Gelen kutusu mesajı #10");

    const scrollW2 = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(scrollW2 <= 390, `scrollWidth ${scrollW2} <= 390`);

    await summaryCard.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: join(scratchDir, "verify-gmail-10-inbox-390.png"),
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
