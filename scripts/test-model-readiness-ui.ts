import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { createFictionalInbox } from "../lib/ai/tools/demo-inbox";

const origin = "http://localhost:3100";
const owner = "owner@example.test";
const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";

test("phone-sized readiness, selection and failed-send preservation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const token = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: origin },
    ]);
    const page = await context.newPage();
    // Local-only BotID fixture; production protection is not changed or tested.
    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/messages*", (route) =>
      route.fulfill({
        json: {
          messages: [],
          visibility: "private",
          userId,
          isReadonly: false,
        },
      })
    );
    await page.goto(origin);
    await page.getByTestId("model-readiness-status").waitFor();
    const response = await context.request.get(`${origin}/api/models`);
    assert.equal(response.status(), 200);
    const unavailable = await response.json();
    assert.deepEqual(unavailable.models, []);
    assert.equal(unavailable.status, "setup_required");
    const input = page.getByTestId("multimodal-input").last();
    await input.fill("Merhaba, hello — keep this draft");
    assert.equal(
      await page.getByTestId("send-button").last().isDisabled(),
      true
    );
    assert.equal(await page.getByTestId("model-selector").count(), 0);
    assert.equal(
      await page.getByText("Activate AI Gateway", { exact: true }).count(),
      0
    );
    console.log(
      "PASS: unconfigured backend has no selectable models or payment dialog; draft is preserved"
    );

    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: "openai/gpt-oss-20b",
          checkedAt: "2026-11-08T15:00:00Z",
          models: [
            {
              id: "openai/gpt-oss-20b",
              name: "Everyday chat",
              provider: "groq",
              description: "GPT OSS 20B · free-account quota applies",
            },
            {
              id: "openai/gpt-oss-120b",
              name: "Detailed chat",
              provider: "groq",
              description: "GPT OSS 120B · free-account quota applies",
            },
          ],
          capabilities: {},
        },
      })
    );
    await page.reload();
    await page.getByTestId("model-selector").waitFor();
    assert.equal(await input.inputValue(), "Merhaba, hello — keep this draft");
    assert.equal(
      await page.getByTestId("send-button").last().isEnabled(),
      true
    );
    await page.getByTestId("model-selector").click();
    // Exercise model selection without depending on popover animation stability.
    await page
      .getByRole("option", { name: /Detailed chat/ })
      .dispatchEvent("click");
    await expect(page.getByTestId("model-selector")).toHaveText(
      "Detailed chat"
    );
    assert.equal(
      await page.getByText("Claude Sonnet 4.6", { exact: true }).count(),
      0
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    console.log(
      "PASS: ready fixture shows only approved choices, preserves draft across reload, and fits phone width"
    );

    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 503,
        json: {
          code: "offline:model_setup",
          message: "Chat setup is incomplete.",
        },
      })
    );
    const failedResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/chat") && r.status() === 503
    );
    await page.getByTestId("send-button").last().click();
    await failedResponse;
    await page
      .getByText(/Chat is not ready yet/)
      .first()
      .waitFor();
    await page.getByTestId("retry-response").waitFor();
    assert.equal(await page.getByTestId("message-user").count(), 1);
    assert.equal(await input.inputValue(), "");
    assert.equal(
      await page.getByText("Activate AI Gateway", { exact: true }).count(),
      0
    );
    console.log(
      "PASS: failed send exposes one Retry action, no duplicate user turn, no billing activation"
    );
  } finally {
    await browser.close();
  }
});

test("mobile History reliably reopens persisted messages after full navigation and reload", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const token = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: origin },
    ]);
    const chatId = "c29f203a-5732-4c57-988a-ae3e3a856e81";
    const createdAt = new Date().toISOString();
    const page = await context.newPage();
    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({
        json: {
          chats: [
            {
              id: chatId,
              userId,
              title: "Saved synthetic chat",
              visibility: "private",
              createdAt,
            },
          ],
          hasMore: false,
        },
      })
    );
    await page.route("**/api/messages?*", (route) => {
      assert.equal(
        new URL(route.request().url()).searchParams.get("chatId"),
        chatId
      );
      return route.fulfill({
        json: {
          messages: [
            {
              id: "62d44e61-82f7-4e5a-9c28-43bcfb760360",
              role: "user",
              parts: [{ type: "text", text: "Synthetic Turkish question" }],
              metadata: { createdAt },
            },
            {
              id: "b9927664-4831-414c-97e1-e2eb021cf4c1",
              role: "assistant",
              parts: [{ type: "text", text: "Synthetic Turkish answer" }],
              metadata: { createdAt },
            },
          ],
          visibility: "private",
          userId,
          isReadonly: false,
        },
      });
    });
    await page.goto(origin);
    await page.locator("header button").first().click();
    const historyLink = page.getByRole("link", {
      name: "Saved synthetic chat",
    });
    await historyLink.waitFor();
    assert.equal(await historyLink.getAttribute("href"), `/chat/${chatId}`);
    await historyLink.click();
    await page.waitForURL(`**/chat/${chatId}`);
    await page.getByText("Synthetic Turkish question").waitFor();
    await page.getByText("Synthetic Turkish answer").waitFor();
    await page.reload();
    await page.getByText("Synthetic Turkish question").waitFor();
    await page.getByText("Synthetic Turkish answer").waitFor();
    console.log(
      "PASS: mobile History opens and reloads a saved conversation with both turns"
    );
  } finally {
    await browser.close();
  }
});

test("fictional inbox stays visible in a saved chat and responds locally", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const token = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: origin },
    ]);

    const chatId = "5de66f3f-104e-43d6-a7bb-6bfbf61060d8";
    const now = new Date().toISOString();
    const page = await context.newPage();
    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/messages?*", (route) =>
      route.fulfill({
        json: {
          messages: [
            {
              id: "af60c3ae-21d3-493d-a871-14caebd31234",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "Hayalî gelen kutusu demosunu göster.",
                },
              ],
              metadata: { createdAt: now },
            },
            {
              id: "9acbbff2-6063-4b4f-994a-2135eafda917",
              role: "assistant",
              parts: [
                {
                  type: "tool-demoInbox",
                  toolCallId: "synthetic-demo",
                  state: "output-available",
                  input: { language: "tr" },
                  output: createFictionalInbox("tr"),
                },
              ],
              metadata: { createdAt: now },
            },
          ],
          visibility: "private",
          userId,
          isReadonly: false,
        },
      })
    );

    await page.goto(`${origin}/chat/${chatId}`);
    const card = page.getByTestId("fictional-inbox-card");
    await card.waitFor();
    await expect(card).toContainText("Gmail hesabına erişilmedi.");
    await expect(page.getByTestId("demo-inbox-count")).toHaveText("7");

    const slider = page.getByTestId("demo-inbox-slider");
    await slider.focus();
    // The composer's delayed autofocus used to steal focus from this card.
    await page.waitForTimeout(200);
    await expect(slider).toBeFocused();
    await slider.press("End");
    await expect(page.getByTestId("demo-inbox-priority")).toHaveText("5 / 5");
    await expect(page.getByTestId("demo-inbox-count")).toHaveText("2");

    await page
      .getByRole("button", {
        name: "Gönderilmeyen örnek yanıtı göster",
      })
      .click();
    await expect(page.getByTestId("demo-inbox-draft")).toContainText(
      "gönderilmedi"
    );

    await page.reload();
    await card.waitFor();
    await expect(page.getByTestId("demo-inbox-count")).toHaveText("7");
    console.log(
      "PASS: fictional inbox chart renders, filters locally, never sends, and survives chat reload"
    );
  } finally {
    await browser.close();
  }
});
