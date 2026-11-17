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
          defaultModelId: "gemini-4-hydrogen",
          models: [
            {
              id: "gemini-4-hydrogen",
              name: "Gemini 4 Hydrogen",
              provider: "google",
              description:
                "Default · fast ~1s responses via Vertex AI on Ultra credit",
            },
            {
              id: "gemini-4-argon",
              name: "Gemini 4 Argon",
              provider: "google",
              description:
                "Deep research & hard questions · Vertex AI on Ultra credit",
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
    const comparisonChatId = "33333333-3333-4333-8333-333333333333";
    const timelineChatId = "44444444-4444-4444-8444-444444444444";

    const ceoChartAnswer = [
      "Güncel S&P 500 ve Equilar üst düzey yönetici kazanç raporlarına göre en yüksek yıllık toplam pakete sahip teknoloji CEO'ları aşağıda özetlenmiştir.",
      "```visual-json",
      JSON.stringify({
        kind: "chart",
        chartKind: "bar",
        title: "En Çok Kazanan Teknoloji CEO'ları (2026)",
        summary: "Yıllık toplam maaş + hisse paketi (Milyon $)",
        unit: "$M",
        points: [
          { label: "Hock Tan", value: 161.8 },
          { label: "Nikesh Arora", value: 151.4 },
          { label: "Satya Nadella", value: 79.1 },
          { label: "Tim Cook", value: 74.6 },
        ],
      }),
      "```",
    ].join("\n");
    const ceoVisual = buildOpenUiPayload(
      [{ type: "text", text: ceoChartAnswer }],
      "gemini-4-argon",
      "2026-11-17T18:05:00.000Z"
    );
    assert.ok(ceoVisual);

    const comparisonAnswer = [
      "MacBook Air M4 günlük taşınabilirlikte, MacBook Pro M4 ise uzun süreli yüksek yük ve 120Hz ekranda öne çıkar.",
      "```visual-json",
      JSON.stringify({
        kind: "comparison",
        title: "MacBook Air M4 vs MacBook Pro M4",
        summary: "Taşınabilirlik, ekran ve performans karşılaştırması",
        options: ["MacBook Air M4", "MacBook Pro M4"],
        rows: [
          {
            feature: "Ağırlık",
            values: ["1.24 kg (Ultra hafif)", "1.55 kg"],
            winnerIndex: 0,
          },
          {
            feature: "Ekran",
            values: ["60Hz Liquid Retina", "120Hz Mini-LED ProMotion"],
            winnerIndex: 1,
          },
          {
            feature: "Pil Ömrü",
            values: ["18 saate kadar", "24 saate kadar"],
            winnerIndex: 1,
          },
        ],
        verdict:
          "Seyahat ve günlük iş için Air; yoğun kodlama/render ve 120Hz için Pro.",
      }),
      "```",
    ].join("\n");
    const comparisonVisual = buildOpenUiPayload(
      [{ type: "text", text: comparisonAnswer }],
      "gemini-4-argon",
      "2026-11-17T18:06:00.000Z"
    );
    assert.ok(comparisonVisual);

    const timelineAnswer = [
      "SpaceX Starship programının temel uçuş kilometre taşları:",
      "```visual-json",
      JSON.stringify({
        kind: "timeline",
        title: "SpaceX Starship Kilometre Taşları",
        summary: "2023–2026 test uçuşu kronolojisi",
        events: [
          {
            when: "Nis 2023",
            title: "IFT-1 İlk Tam Entegre Kalkış",
            detail: "Starbase'den Super Heavy ile ilk birleşik uçuş.",
          },
          {
            when: "Eki 2024",
            title: "IFT-5 Mechazilla Yakalaması",
            detail: "71 metrelik itici kule kollarında havada yakalandı.",
            badge: "Tarihi İlk",
          },
          {
            when: "2026",
            title: "Yörüngede Yakıt Aktarımı Testi",
            detail:
              "Derin uzay görevleri için iki gemi arası kriyojenik transfer.",
          },
        ],
      }),
      "```",
    ].join("\n");
    const timelineVisual = buildOpenUiPayload(
      [{ type: "text", text: timelineAnswer }],
      "gemini-4-hydrogen",
      "2026-11-17T18:07:00.000Z"
    );
    assert.ok(timelineVisual);

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

      if (chatId === comparisonChatId) {
        return route.fulfill({
          json: {
            visibility: "private",
            userId,
            isReadonly: false,
            messages: [
              {
                id: "30000000-0000-4000-8000-000000000001",
                role: "user",
                parts: [
                  {
                    type: "text",
                    text: "MacBook Air M4 ile MacBook Pro M4'ü karşılaştır.",
                  },
                ],
              },
              {
                id: "30000000-0000-4000-8000-000000000002",
                role: "assistant",
                parts: [
                  { type: "text", text: comparisonAnswer },
                  { type: "data-openui", data: comparisonVisual },
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

      if (chatId === timelineChatId) {
        return route.fulfill({
          json: {
            visibility: "private",
            userId,
            isReadonly: false,
            messages: [
              {
                id: "40000000-0000-4000-8000-000000000001",
                role: "user",
                parts: [
                  {
                    type: "text",
                    text: "SpaceX Starship kilometre taşları kronolojisi nedir?",
                  },
                ],
              },
              {
                id: "40000000-0000-4000-8000-000000000002",
                role: "assistant",
                parts: [
                  { type: "text", text: timelineAnswer },
                  { type: "data-openui", data: timelineVisual },
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

      // Case 2: Turkish 4-search top earners research turn with Source Cards + Chart/Table card
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
                      title:
                        s === 1
                          ? `Equilar S&P 500 CEO Pay Study ${idx}`
                          : `Bloomberg Executive Pay Index ${idx}.${s}`,
                      url: `https://forbes.com/ceo-pay-${idx}-${s}`,
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
                  text: ceoChartAnswer,
                },
                {
                  type: "data-openui",
                  data: ceoVisual,
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

    // Verify picker chip shows real model name ("Gemini 4 Hydrogen") and menu lists ONLY Ultra models
    const pickerChip = page.getByTestId("model-selector");
    await expect(pickerChip).toBeVisible();
    await expect(pickerChip).toContainText("Gemini 4 Hydrogen");
    await pickerChip.click();
    await expect(page.getByText("Gemini 4 Argon")).toBeVisible();
    const fullMenuText = (await page.locator("body").textContent()) ?? "";
    assert.ok(
      !fullMenuText.includes("GPT-6.1 Terra") &&
        !fullMenuText.includes("GPT-6 Luna"),
      "Pay-per-use GPT models must not appear in the model picker"
    );
    await page.keyboard.press("Escape");

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

    // Navigate to Case 2 (Turkish 4-search Source Cards + Bar Chart/Table Tabs at 390x844)
    await page.goto(`${origin}/chat/${searchChatId}`, {
      waitUntil: "domcontentloaded",
    });
    const searchCards = page.getByTestId("web-search-card");
    await expect(searchCards).toHaveCount(4, { timeout: 15_000 });
    for (let i = 0; i < 4; i++) {
      await expect(searchCards.nth(i)).toContainText("5 kaynak");
    }
    await expect(
      page.getByTestId("web-search-source-cards").first()
    ).toBeVisible();
    await expect(page.getByTestId("openui-card")).toContainText(
      "En Çok Kazanan Teknoloji CEO'ları (2026)"
    );
    await expect(page.getByTestId("openui-card")).toContainText("161.8 $M");

    const bodyText = (await page.locator("body").textContent()) ?? "";
    assert.ok(
      !bodyText.includes("The reply could not be completed") &&
        !bodyText.includes("Yanıt tamamlanamadı") &&
        !bodyText.includes("Searching the web") &&
        !bodyText.includes("visual-json"),
      "Multi-search turn must not show error banner, raw visual-json, or dangling English spinner"
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

    await page.getByTestId("openui-card").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const multiSearchShot = join(scratchDir, "verify-multisearch-390.png");
    await page.screenshot({ path: multiSearchShot, fullPage: false });

    // Navigate to Case 3 (Comparison Card at 390x844)
    await page.goto(`${origin}/chat/${comparisonChatId}`, {
      waitUntil: "domcontentloaded",
    });
    const compCard = page.getByTestId("openui-comparison");
    await expect(compCard).toBeVisible({ timeout: 15_000 });
    await expect(compCard).toContainText("MacBook Air M4");
    await expect(compCard).toContainText("120Hz Mini-LED ProMotion");
    const compOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(compOverflow <= 390, `Comparison overflow: ${compOverflow}`);
    await compCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const compShot = join(scratchDir, "verify-comparison-390.png");
    await page.screenshot({ path: compShot, fullPage: false });

    // Navigate to Case 4 (Timeline Card at 390x844)
    await page.goto(`${origin}/chat/${timelineChatId}`, {
      waitUntil: "domcontentloaded",
    });
    const tlCard = page.getByTestId("openui-timeline");
    await expect(tlCard).toBeVisible({ timeout: 15_000 });
    await expect(tlCard).toContainText("IFT-5 Mechazilla Yakalaması");
    const tlOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(tlOverflow <= 390, `Timeline overflow: ${tlOverflow}`);
    await tlCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const tlShot = join(scratchDir, "verify-timeline-390.png");
    await page.screenshot({ path: tlShot, fullPage: false });

    // Navigate to Case 5 (Vertex failure -> plain-English error + Retry button at 390x844)
    let chatPostAttempts = 0;
    await page.route("**/api/chat", (route) => {
      chatPostAttempts += 1;
      if (chatPostAttempts === 1) {
        // Simulate SSE stream emitting data-turn-status at t=0ms then Vertex 503 error
        const sseError = [
          `data: ${JSON.stringify({ type: "start", messageId: "a-fail-1" })}\n\n`,
          `data: ${JSON.stringify({
            type: "data-turn-status",
            data: { phase: "thinking", model: "gemini-4-hydrogen" },
          })}\n\n`,
          `data: ${JSON.stringify({
            type: "error",
            errorText:
              "Couldn't finish this reply right now. Your message is saved — tap Retry response below to try again. No paid fallback was used.",
          })}\n\n`,
          "data: [DONE]\n\n",
        ].join("");
        return route.fulfill({
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "x-vercel-ai-ui-message-stream": "v1",
          },
          body: sseError,
        });
      }
      const sseSuccess = [
        `data: ${JSON.stringify({ type: "start", messageId: "a-ok-2" })}\n\n`,
        `data: ${JSON.stringify({ type: "text-start", id: "txt-1" })}\n\n`,
        `data: ${JSON.stringify({
          type: "text-delta",
          id: "txt-1",
          delta: "Retried cleanly on Gemini 4 Hydrogen via Vertex Ultra.",
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text-end", id: "txt-1" })}\n\n`,
        `data: ${JSON.stringify({ type: "finish" })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: sseSuccess,
      });
    });

    await page.goto(`${origin}/?query=${encodeURIComponent("Quick test")}`, {
      waitUntil: "domcontentloaded",
    });
    const errorNotice = page.getByTestId("reply-status-text");
    const retryBtn = page.getByTestId("retry-response");
    await expect(errorNotice).toBeVisible({ timeout: 15_000 });
    await expect(errorNotice).toContainText("No paid fallback was used");
    await expect(retryBtn).toBeVisible();
    const errorShot = join(scratchDir, "verify-vertex-error-retry-390.png");
    await page.screenshot({ path: errorShot, fullPage: false });

    await retryBtn.click();
    await expect(
      page.getByText("Retried cleanly on Gemini 4 Hydrogen via Vertex Ultra.")
    ).toBeVisible({ timeout: 15_000 });
    assert.equal(
      chatPostAttempts,
      2,
      "Expected Retry button to trigger 2nd attempt"
    );

    console.log(
      `PASS: 390x844 iPhone verification succeeded (weather=${weatherShot}, ceoChart=${multiSearchShot}, comparison=${compShot}, timeline=${tlShot}, retry=${errorShot}, mapVisible=${mapVisible})`
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
