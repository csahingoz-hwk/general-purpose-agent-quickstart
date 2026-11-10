import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { createFictionalInbox } from "../lib/ai/tools/demo-inbox";

// Optional local override for environments with a preinstalled Chromium.
const launchBrowser = () =>
  chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });

const origin = "http://localhost:3100";
const owner = "owner@example.test";
const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";

test("phone-sized readiness, selection and failed-send preservation", async () => {
  const browser = await launchBrowser();
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
    // iOS Safari zooms into any focused field below 16px and stays shifted after
    // the keyboard closes; the shadcn textarea default must survive on phones.
    const fontSize = await input.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize)
    );
    assert.ok(
      fontSize >= 16,
      `composer font-size is ${fontSize}px; phones need at least 16px`
    );
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
  const browser = await launchBrowser();
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
  const browser = await launchBrowser();
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

const shellViewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "desktop-1440", width: 1440, height: 1000 },
] as const;

test("personal shell: no vendor CTA, private status, usage replaces chat, no overflow", async () => {
  const screenshotDir = process.env.UI_SCREENSHOT_DIR;
  const browser = await launchBrowser();
  try {
    for (const viewport of shellViewports) {
      const savedChatId = "0b6f0f3e-5a2d-4d8e-9a53-6d1f1c4a7e10";
      const publicChatId = "7d1c2a5b-3e44-4f0b-8f6e-2a9b5c0d1e22";
      const longTitle =
        "A deliberately long synthetic conversation title that must truncate with an ellipsis instead of overflowing the header";
      const createdAt = new Date().toISOString();
      const token = await encode({
        secret,
        salt: "authjs.session-token",
        token: { id: userId, email: owner, type: "regular" },
      });

      const open = async (colorScheme: "light" | "dark") => {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: screenshotDir ? 2 : 1,
          reducedMotion: "reduce",
          colorScheme,
        });
        await context.addCookies([
          { name: "authjs.session-token", value: token, url: origin },
        ]);
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
                  id: savedChatId,
                  userId,
                  title: longTitle,
                  visibility: "private",
                  createdAt,
                },
                {
                  id: publicChatId,
                  userId,
                  title: "Shared synthetic chat",
                  visibility: "public",
                  createdAt,
                },
              ],
              hasMore: false,
            },
          })
        );
        await page.route("**/api/messages?*", (route) => {
          const requested = new URL(route.request().url()).searchParams.get(
            "chatId"
          );
          return route.fulfill({
            json: {
              messages: [
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  parts: [{ type: "text", text: "Synthetic question" }],
                  metadata: { createdAt },
                },
              ],
              visibility: requested === publicChatId ? "public" : "private",
              userId,
              isReadonly: false,
            },
          });
        });
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
              ],
              capabilities: {},
            },
          })
        );
        await page.route("**/api/usage", (route) =>
          route.fulfill({
            json: {
              dailyEstimatedUsd: 0.0123,
              monthlyEstimatedUsd: 0.4567,
              allowanceUsd: 5,
              requests: 3,
              invocations: 4,
              fallbackInvocations: 0,
              fallbackEstimatedUsd: 0,
              unreportedInvocations: 0,
              calls: [
                {
                  model: "synthetic/model-with-a-fairly-long-identifier",
                  createdAt,
                  requestId: "synthetic-request",
                  inputTokens: 1200,
                  cachedInputTokens: 0,
                  cacheWriteTokens: 0,
                  outputTokens: 300,
                  reasoningTokens: 0,
                  estimatedUsd: "0.0123",
                  reservedUsd: "0.0200",
                  outcome: "completed",
                },
              ],
            },
          })
        );
        return { context, page };
      };
      const noPageOverflow = (page: import("@playwright/test").Page) =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        );
      const shot = async (
        page: import("@playwright/test").Page,
        name: string
      ) => {
        if (screenshotDir) {
          await page.screenshot({
            path: `${screenshotDir}/${viewport.name}-${name}.png`,
          });
        }
      };
      const openHistoryIfMobile = async (
        page: import("@playwright/test").Page
      ) => {
        if (viewport.width < 768) {
          await page.locator("header button").first().click();
        }
      };

      for (const colorScheme of ["light", "dark"] as const) {
        const { context, page } = await open(colorScheme);
        try {
          await page.goto(origin);
          await page.getByTestId("multimodal-input").first().waitFor();
          const header = page.locator("header");
          await expect(
            header.getByText("Assistant", { exact: true })
          ).toBeVisible();
          await expect(header.getByTestId("chat-status")).toHaveText("Private");
          assert.equal(await page.getByText("Deploy with Vercel").count(), 0);
          assert.equal(
            await page
              .locator('a[href*="vercel.com"], a[href*="composio.dev"]')
              .count(),
            0
          );
          await page.getByTestId("model-selector").waitFor();
          const suggestionTexts = await page
            .getByTestId("suggested-actions")
            .locator("button")
            .allTextContents();
          assert.deepEqual(
            suggestionTexts.map((text) => text.trim()),
            [
              "Help me plan my day",
              "Explain this clearly",
              "Check the weather",
              "Explore a fictional inbox",
            ]
          );
          assert.equal(await noPageOverflow(page), true);
          // Let the greeting finish its entrance before capturing.
          await page.waitForTimeout(1200);
          await shot(page, `empty-chat-${colorScheme}`);

          if (colorScheme === "light") {
            // Saved chat: title is truncated in the header, never overflows.
            await page.goto(`${origin}/chat/${savedChatId}`);
            await page.getByText("Synthetic question").waitFor();
            await expect(page.getByTestId("chat-header-title")).toBeVisible();
            assert.equal(await noPageOverflow(page), true);
            await shot(page, "saved-chat-long-title");

            // An actually public chat is labelled truthfully, never "Private".
            await page.goto(`${origin}/chat/${publicChatId}`);
            await page.getByText("Synthetic question").waitFor();
            await expect(page.getByTestId("chat-status")).toHaveText(
              "Shared link"
            );

            // New chat from a saved conversation.
            await openHistoryIfMobile(page);
            await page.getByRole("button", { name: "New chat" }).click();
            await page.waitForURL(`${origin}/`);
            await page.getByTestId("multimodal-input").first().waitFor();
            await expect(page.getByTestId("chat-status")).toHaveText("Private");

            // Delete all lives in the account menu, behind a confirmation;
            // it is never in primary navigation and is not executed here.
            await openHistoryIfMobile(page);
            assert.equal(
              await page.getByRole("button", { name: "Delete all" }).count(),
              0
            );
            await page.getByTestId("user-nav-button").click();
            await expect(
              page.getByTestId("user-nav-item-delete-all")
            ).toHaveText("Delete all chats…");
            await expect(
              page.getByRole("menuitem", { name: "Usage & settings" })
            ).toBeVisible();
            await page.keyboard.press("Escape");
            if (viewport.width < 768) {
              await page.keyboard.press("Escape");
            }

            // /usage replaces the chat surface and Back returns to it.
            await page.goto(`${origin}/usage`);
            await expect(
              page.getByRole("heading", { name: "Conversation usage" })
            ).toBeVisible();
            assert.equal(await page.getByTestId("multimodal-input").count(), 0);
            assert.equal(await noPageOverflow(page), true);
            const back = page.getByRole("link", { name: "Back to chat" });
            const box = await back.boundingBox();
            assert.ok(box && box.height >= 44, "Back to chat is >= 44px tall");
            await shot(page, "usage");
            await back.click();
            await page.waitForURL(`${origin}/`);
            await page.getByTestId("multimodal-input").first().waitFor();
          }
        } finally {
          await context.close();
        }
      }
      console.log(
        `PASS: personal shell at ${viewport.width}x${viewport.height} (no vendor CTA, private status, usage route, no overflow)`
      );
    }
  } finally {
    await browser.close();
  }
});
