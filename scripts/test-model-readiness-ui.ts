import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";

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
    assert.equal(await page.getByTestId("send-button").isDisabled(), true);
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
    assert.equal(await page.getByTestId("send-button").isEnabled(), true);
    await page.getByTestId("model-selector").click();
    await page.getByPlaceholder("Search ready models…").fill("Detailed");
    await page.getByText("Detailed chat", { exact: true }).last().click();
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
    await page.getByTestId("send-button").click();
    await failedResponse;
    await page
      .getByText(/Chat is not ready yet/)
      .first()
      .waitFor();
    assert.equal(await input.inputValue(), "Merhaba, hello — keep this draft");
    assert.equal(
      await page.getByText("Activate AI Gateway", { exact: true }).count(),
      0
    );
    console.log(
      "PASS: a failed send restores input and does not offer billing activation"
    );
  } finally {
    await browser.close();
  }
});
