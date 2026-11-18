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

test("Gmail 390x844 iPhone E2E: neutral chat message on SERVICE_DISABLED (never Cloud Console in chat), single owner Setup checklist link when disabled, and 10-message inbox render when enabled", async () => {
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

    // 1) Verify GET /connect/google/start issues a real 302 top-level redirect to Google OAuth
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

    // 2) Owner /setup checklist shows ONE Enable Google APIs link when SERVICE_DISABLED is detected
    await page.route("**/api/setup-status*", (route) =>
      route.fulfill({
        json: {
          googleConnected: true,
          githubConnected: false,
          googleSignInReady: true,
          githubOAuthReady: false,
          vaultReady: true,
          items: [
            {
              id: "google_workspace",
              label: "Google Gmail, Calendar & Drive",
              summary:
                "Google account connected — enable Gmail, Google Calendar, Google Drive API on project #297951472081 once.",
              status: "action_needed",
              actionKind: "external_link",
              externalUrl:
                "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com&project=297951472081",
              externalLabel: "Enable Google APIs",
            },
          ],
        },
      })
    );
    await page.goto(`${origin}/setup`, { waitUntil: "networkidle" });
    const setupEnableLink = page.getByTestId(
      "setup-external-link-google_workspace"
    );
    await expect(setupEnableLink).toBeVisible();
    assert.equal(await setupEnableLink.count(), 1);
    assert.equal(
      await setupEnableLink.getAttribute("href"),
      "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com&project=297951472081"
    );

    // 3) In chat, SERVICE_DISABLED renders NO ConnectorConnectCard and NO Cloud Console link — ONLY "Gmail şu an kullanılamıyor, kurulum kontrol ediliyor"
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
              message: "Gmail şu an kullanılamıyor, kurulum kontrol ediliyor",
              messages: [],
            },
          },
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

      const tenMessages = Array.from({ length: 10 }, (_, idx) => ({
        id: `m_${idx + 1}`,
        threadId: `t_${idx + 1}`,
        subject: `Gelen kutusu mesajı #${idx + 1} — Londra uçuş ve toplantı özeti`,
        from: `Sender ${idx + 1} <sender${idx + 1}@example.com>`,
        date: "18 Nov 2026 10:05",
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
      .fill("Can you fetch my Gmail?");
    await page.getByTestId("send-button").click();

    const neutralBubble = page.getByTestId("connector-disabled-message");
    await expect(neutralBubble).toBeVisible({ timeout: 10_000 });
    await expect(neutralBubble).toHaveText(
      "Gmail şu an kullanılamıyor, kurulum kontrol ediliyor"
    );

    // Crucial: ZERO ConnectorConnectCard and ZERO Google Cloud Console links in chat!
    assert.equal(await page.getByTestId("connector-connect-card").count(), 0);
    assert.equal(
      await page.locator('a[href*="console.cloud.google.com"]').count(),
      0,
      "Chat UI must NEVER link end users to Google Cloud Console"
    );
    const chatText = await page.locator("main").innerText();
    assert.doesNotMatch(
      chatText,
      /Google Cloud|297951472081|Enable APIs|API'leri Etkinleştir|henüz bağlanmamış/i
    );
    const scrollW1 = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(scrollW1 <= 390, `scrollWidth ${scrollW1} <= 390`);

    await page.screenshot({
      path: join(scratchDir, "verify-gmail-neutral-disabled-chat-390.png"),
      fullPage: false,
    });

    // 4) Next message once APIs are enabled renders all 10 inbox messages cleanly!
    await page
      .getByTestId("multimodal-input")
      .fill("Şimdi tekrar kontrol eder misin?");
    await page.getByTestId("send-button").click();

    const summaryCard = page.getByTestId("connector-summary-gmail");
    await expect(summaryCard).toBeVisible({ timeout: 10_000 });
    await expect(summaryCard).toContainText("Gelen kutusu mesajı #1");
    await expect(summaryCard).toContainText("Gelen kutusu mesajı #10");
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
