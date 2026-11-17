import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { buildOpenUiPayload } from "../lib/openui/attach";

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 3117;
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

test("390x844 iPhone Weather Card and Turkish multi-search verification", async () => {
  const scratchDir =
    process.env.VERIFY_SCREENSHOT_DIR ||
    join(process.cwd(), ".next/verify-screenshots");
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

    const token = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: origin },
    ]);

    const page = await context.newPage();

    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C = window.V_C || []; window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/vote*", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/models*", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          models: [
            {
              id: "gpt-6-luna",
              name: "Everyday chat",
              provider: "openai",
              description: "GPT-6 Luna",
            },
          ],
          capabilities: {},
        },
      })
    );
    await page.route("**/api/voice/transcribe*", (route) =>
      route.fulfill({ json: { serverSttReady: true, liveReady: true } })
    );

    // ---- CASE 1: London Weather Card + USD/TRY Generative Card at 390x844 ----
    const weatherChatId = "11111111-1111-4111-8111-111111111111";
    const londonWeather = {
      latitude: 51.5074,
      longitude: -0.1278,
      generationtime_ms: 0.4,
      utc_offset_seconds: 0,
      timezone: "Europe/London",
      timezone_abbreviation: "GMT",
      elevation: 24,
      cityName: "London",
      current_units: {
        time: "iso8601",
        interval: "seconds",
        temperature_2m: "°C",
      },
      current: {
        time: "2026-11-17T18:00",
        interval: 900,
        temperature_2m: 16.2,
        apparent_temperature: 14.8,
        weather_code: 2,
        wind_speed_10m: 18,
      },
      hourly_units: { time: "iso8601", temperature_2m: "°C" },
      hourly: { time: ["2026-11-17T18:00"], temperature_2m: [16.2] },
      daily_units: {
        time: "iso8601",
        sunrise: "iso8601",
        sunset: "iso8601",
      },
      daily: {
        time: ["2026-11-17", "2026-11-18", "2026-11-19"],
        sunrise: ["2026-11-17T07:22", "2026-11-18T07:24", "2026-11-19T07:25"],
        sunset: ["2026-11-17T16:08", "2026-11-18T16:07", "2026-11-19T16:06"],
        temperature_2m_max: [16.8, 15.1, 13.9],
        temperature_2m_min: [9.4, 8.2, 7.1],
        precipitation_probability_max: [10, 45, 70],
        weather_code: [2, 3, 61],
      },
    };
    const weatherVisual = buildOpenUiPayload(
      [
        {
          type: "tool-getWeather",
          state: "output-available",
          output: londonWeather,
        },
      ],
      "gpt-6-luna",
      "2026-11-17T18:00:00.000Z"
    );
    assert.ok(weatherVisual);

    const searchChatId = "22222222-2222-4222-8222-222222222222";
    await page.route("**/api/messages*", (route) => {
      const url = new URL(route.request().url());
      const chatId = url.searchParams.get("chatId");
      if (chatId === weatherChatId) {
        return route.fulfill({
          json: {
            visibility: "private",
            userId,
            isReadonly: false,
            messages: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                role: "user",
                parts: [
                  { type: "text", text: "What's the weather in London?" },
                ],
              },
              {
                id: "10000000-0000-4000-8000-000000000002",
                role: "assistant",
                parts: [
                  {
                    type: "tool-getWeather",
                    toolCallId: "w-1",
                    state: "output-available",
                    input: { city: "London" },
                    output: londonWeather,
                  },
                  {
                    type: "text",
                    text: "Right now in London it's 16.2°C and partly cloudy, cooling slightly by Thursday with rain likely.",
                  },
                  {
                    type: "data-openui",
                    data: weatherVisual,
                  },
                  {
                    type: "data-reply-status",
                    data: { status: "complete", retryable: false },
                  },
                ],
              },
            ],
          },
        });
      }

      // Case 2: Turkish 4-search top earners research turn
      return route.fulfill({
        json: {
          visibility: "private",
          userId,
          isReadonly: false,
          messages: [
            {
              id: "20000000-0000-4000-8000-000000000001",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "Dünyada en çok kazanan teknoloji CEO'ları kimler ve yıllık toplam kazançları ne kadar?",
                },
              ],
            },
            {
              id: "20000000-0000-4000-8000-000000000002",
              role: "assistant",
              parts: [
                ...[1, 2, 3, 4].map((idx) => ({
                  type: "tool-webSearch",
                  toolCallId: `ws-${idx}`,
                  state: "output-available",
                  providerExecuted: true,
                  input: { query: `top paid tech CEOs annual pay ${idx}` },
                  output: {
                    results: [1, 2, 3, 4, 5].map((s) => ({
                      title: `Kaynak Raporu ${idx}.${s}`,
                      url: `https://example.com/ceo-pay-${idx}-${s}`,
                      snippet: `Yıllık toplam hisse + maaş paketi verisi ${idx}.${s}.`,
                    })),
                  },
                })),
                {
                  type: "tool-webSearch",
                  toolCallId: "ws-skipped",
                  state: "output-available",
                  providerExecuted: true,
                  input: { query: "extra search" },
                  output: { results: [], skippedForSynthesis: true },
                },
                {
                  type: "text",
                  text: [
                    "Güncel S&P 500 ve Equilar üst düzey yönetici kazanç raporlarına göre en yüksek yıllık toplam pakete sahip teknoloji CEO'ları:",
                    "",
                    "1. **Hock Tan (Broadcom)** — **~161,8 milyon $ / yıl** (ağırlıklı performans bazlı hisse ödülleri) · [Equilar CEO Pay Study](https://example.com/ceo-pay-1-1)",
                    "2. **Nikesh Arora (Palo Alto Networks)** — **~151,4 milyon $ / yıl** · [Bloomberg Pay Index](https://example.com/ceo-pay-2-1)",
                    "3. **Tim Cook (Apple)** — **~74,6 milyon $ / yıl** (3 milyon $ baz maaş + hisse teşvikleri) · [Apple Proxy Filing](https://example.com/ceo-pay-3-1)",
                    "4. **Satya Nadella (Microsoft)** — **~79,1 milyon $ / yıl** · [Microsoft DEF 14A](https://example.com/ceo-pay-4-1)",
                  ].join("\n"),
                },
                {
                  type: "data-reply-status",
                  data: { status: "complete", retryable: false },
                },
              ],
            },
          ],
        },
      });
    });

    // Navigate to Case 1 (Weather Card at 390x844)
    await page.goto(`${origin}/chat/${weatherChatId}`, {
      waitUntil: "domcontentloaded",
    });
    const card = page.getByTestId("openui-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    const hero = page.getByTestId("openui-weather-hero");
    await expect(hero).toBeVisible();
    await expect(hero).toContainText("16.2°C");
    await expect(hero).toContainText("Partly cloudy");
    await expect(hero).toContainText("H 17° · L 9°");

    // Verify short dates & zero truncated ISO dates
    await expect(card).toContainText("Tue 17");
    await expect(card).toContainText("Wed 18");
    await expect(card).toContainText("Thu 19");
    const cardText = (await card.textContent()) ?? "";
    assert.ok(
      !cardText.includes("2026-1"),
      `Expected no truncated ISO dates, got: ${cardText}`
    );

    // Verify chart has polylines (High + Low) and °C labels
    const polylineCount = await page
      .getByTestId("openui-chart-svg")
      .locator("polyline")
      .count();
    assert.equal(polylineCount, 2, "Expected High and Low chart lines");
    await expect(card).toContainText("High");
    await expect(card).toContainText("Low");

    // Wait for eager map tiles to finish loading (all 9 tiles around London)
    await page.waitForTimeout(2500);
    const mapVisible = await page.getByTestId("openui-map").isVisible();
    if (mapVisible) {
      const loadedTiles = await page
        .getByTestId("openui-map")
        .locator("img")
        .evaluateAll(
          (imgs) =>
            imgs.filter(
              (img) =>
                (img as HTMLImageElement).complete &&
                (img as HTMLImageElement).naturalWidth >= 256
            ).length
        );
      assert.equal(
        loadedTiles,
        6,
        `Expected all 6 real map tiles (256px) loaded when map is visible, got ${loadedTiles}`
      );
    }

    // Verify 390px viewport has zero horizontal overflow and no truncated table cells
    const layoutMetrics = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll("table td"));
      const truncatedCells = tds
        .filter((td) => td.scrollWidth > td.clientWidth + 2)
        .map((td) => td.textContent);
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        truncatedCells,
      };
    });
    assert.equal(layoutMetrics.innerWidth, 390);
    assert.ok(
      layoutMetrics.docScrollWidth <= 390,
      `Horizontal overflow on 390px: scrollWidth=${layoutMetrics.docScrollWidth}`
    );
    assert.deepEqual(layoutMetrics.truncatedCells, []);

    await hero.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const weatherTopShot = join(scratchDir, "verify-weather-top-390.png");
    await hero.screenshot({ path: weatherTopShot });

    await page.getByTestId("openui-map").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const weatherShot = join(scratchDir, "verify-weather-390.png");
    await page.screenshot({ path: weatherShot, fullPage: false });

    // Navigate to Case 2 (Turkish 4-search top earners at 390x844)
    await page.goto(`${origin}/chat/${searchChatId}`, {
      waitUntil: "domcontentloaded",
    });
    const searchCards = page.getByTestId("web-search-card");
    await expect(searchCards).toHaveCount(4, { timeout: 15_000 });
    for (let i = 0; i < 4; i++) {
      await expect(searchCards.nth(i)).toContainText("5 kaynak");
    }
    await expect(page.getByText("Hock Tan (Broadcom)")).toBeVisible();
    await expect(page.getByText("161,8 milyon $")).toBeVisible();

    const bodyText = (await page.locator("body").textContent()) ?? "";
    assert.ok(
      !bodyText.includes("The reply could not be completed") &&
        !bodyText.includes("Yanıt tamamlanamadı") &&
        !bodyText.includes("Searching the web"),
      "Multi-search turn must not show error banner or dangling English spinner"
    );

    const searchOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(searchOverflow <= 390, `Overflow: ${searchOverflow}`);

    await searchCards.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const multiSearchTopShot = join(
      scratchDir,
      "verify-multisearch-top-390.png"
    );
    await page.screenshot({ path: multiSearchTopShot, fullPage: false });

    await page.getByText("Hock Tan (Broadcom)").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const multiSearchShot = join(scratchDir, "verify-multisearch-390.png");
    await page.screenshot({ path: multiSearchShot, fullPage: false });

    console.log(
      `PASS: 390x844 iPhone verification succeeded (weatherShot=${weatherShot}, multiSearchShot=${multiSearchShot}, mapVisible=${mapVisible})`
    );
  } finally {
    await browser.close().catch(() => undefined);
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        server.kill("SIGKILL");
      }
    }
  }
});
