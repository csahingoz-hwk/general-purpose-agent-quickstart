import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import {
  deterministicFallbackMerge,
  mergeMemoryExports,
  type RawMemoryExportSource,
} from "../lib/memory/multi-source-merge";
import type { ProfileFact } from "../lib/memory/store";
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

    // ---- CASE 6: 390x844 iPhone Memory Screen (Settings + Sidebar + 50-line paste, de-dupe preview, search, edit, delete, export, and "Saved to memory" chat card) ----
    // Verify Sidebar Memory link opens from mobile sidebar toggle
    const sidebarToggle = page.getByTestId("sidebar-toggle-button");
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
      await expect(page.getByTestId("sidebar-memory-link")).toBeVisible({
        timeout: 8000,
      });
      await page.keyboard.press("Escape");
    }

    // Stateful in-memory mock backing /api/memory for deterministic 50-line E2E test
    const memoryState: Array<{
      id: string;
      userId: string;
      category: string;
      key: string;
      value: string;
      source: string;
      pinned: boolean;
      learnedAt: string;
      sharedAcrossBots: boolean;
      updatedAt: string;
    }> = [
      {
        id: "50000000-0000-4000-8000-000000000001",
        userId,
        category: "about_me",
        key: "i_live_in_london",
        value: "I live in London (Europe/London).",
        source: "chat",
        pinned: true,
        learnedAt: "2026-11-17T20:00:00.000Z",
        sharedAcrossBots: true,
        updatedAt: "2026-11-17T20:00:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        userId,
        category: "family",
        key: "daughter_ece",
        value: "Daughter's name is Ece.",
        source: "voice",
        pinned: false,
        learnedAt: "2026-11-17T20:01:00.000Z",
        sharedAcrossBots: true,
        updatedAt: "2026-11-17T20:01:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000003",
        userId,
        category: "preferences",
        key: "coffee_black",
        value: "Kahvemi sade ve şekersiz içerim.",
        source: "chat",
        pinned: true,
        learnedAt: "2026-11-17T20:02:00.000Z",
        sharedAcrossBots: true,
        updatedAt: "2026-11-17T20:02:00.000Z",
      },
    ];
    let nextMemSeq = 10;

    await page.route("**/api/usage*", (route) =>
      route.fulfill({
        json: {
          dailyEstimatedUsd: 0,
          monthlyEstimatedUsd: 0,
          allowanceUsd: 10,
          requests: 4,
          invocations: 4,
          fallbackInvocations: 0,
          fallbackEstimatedUsd: 0,
          unreportedInvocations: 0,
          calls: [],
        },
      })
    );
    await page.route("**/api/connectors*", (route) =>
      route.fulfill({
        json: {
          mediaReady: true,
          gmailReady: true,
          googleSignInReady: true,
          vaultConfigured: true,
        },
      })
    );
    await page.route("**/api/location*", (route) =>
      route.fulfill({
        json: {
          homeLocation: {
            label: "London",
            latitude: 51.5074,
            longitude: -0.1278,
            timeZone: "Europe/London",
            source: "city",
          },
        },
      })
    );

    await page.route("**/api/memory*", (route) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET") {
        return route.fulfill({
          json: {
            status: "ready",
            toolsEnabled: true,
            profileFacts: [...memoryState],
            journalEntries: [],
          },
        });
      }
      if (method === "POST") {
        const body = JSON.parse(req.postData() ?? "{}") as {
          type?: string;
          source?: string;
          items?: Array<{
            category?: string;
            key?: string;
            value?: string;
            source?: string;
            pinned?: boolean;
            learnedAt?: string;
            replaceFactId?: string;
          }>;
        };
        if (body.type === "profile_batch" && Array.isArray(body.items)) {
          const created = body.items.map((item) => {
            const nowIso = item.learnedAt || "2026-11-17T22:15:00.000Z";
            if (item.replaceFactId) {
              const existingTarget = memoryState.find(
                (m) => m.id === item.replaceFactId
              );
              if (existingTarget) {
                existingTarget.category =
                  item.category ?? existingTarget.category;
                existingTarget.value = item.value ?? existingTarget.value;
                existingTarget.source =
                  item.source ?? body.source ?? existingTarget.source;
                existingTarget.pinned = Boolean(item.pinned);
                existingTarget.learnedAt = nowIso;
                existingTarget.updatedAt = nowIso;
                return existingTarget;
              }
            }
            nextMemSeq += 1;
            const row = {
              id: `50000000-0000-4000-8000-${String(nextMemSeq).padStart(12, "0")}`,
              userId,
              category: item.category ?? "about_me",
              key: item.key ?? `fact_${nextMemSeq}`,
              value: item.value ?? "",
              source: item.source ?? body.source ?? "pasted",
              pinned: Boolean(item.pinned),
              learnedAt: nowIso,
              sharedAcrossBots: true,
              updatedAt: nowIso,
            };
            memoryState.unshift(row);
            return row;
          });
          return route.fulfill({
            status: 201,
            json: {
              savedCount: created.length,
              skippedDuplicates: 0,
              skippedSensitive: 0,
              facts: created,
            },
          });
        }
      }
      if (method === "PATCH") {
        const body = JSON.parse(req.postData() ?? "{}") as {
          id?: string;
          value?: string;
          category?: string;
          pinned?: boolean;
        };
        const target = memoryState.find((m) => m.id === body.id);
        if (target) {
          if (body.value !== undefined) {
            target.value = body.value;
          }
          if (body.category) {
            target.category = body.category;
          }
          if (typeof body.pinned === "boolean") {
            target.pinned = body.pinned;
          }
          return route.fulfill({ status: 200, json: { fact: target } });
        }
        return route.fulfill({ status: 404, json: { error: "Not found" } });
      }
      if (method === "DELETE") {
        const url = new URL(req.url());
        const id = url.searchParams.get("id");
        const idx = memoryState.findIndex((m) => m.id === id);
        if (idx !== -1) {
          memoryState.splice(idx, 1);
        }
        return route.fulfill({ status: 200, json: { deleted: true, id } });
      }
      return route.fulfill({ status: 400, json: { error: "Unsupported" } });
    });

    await page.route("**/api/memory/merge", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        sources?: RawMemoryExportSource[];
      };
      const sources = body.sources ?? [];
      const merged = await mergeMemoryExports({
        sources,
        existingFacts: memoryState as unknown as ProfileFact[],
        runner: ({ candidates, existingFacts, preferredModel }) => {
          // For multi-source 4-export test, exercise realistic Vertex Argon cross-lingual merge + conflict resolution
          const proIdx = candidates.findIndex((c) =>
            /google ai pro/i.test(c.text)
          );
          const ultraIdx = candidates.findIndex((c) =>
            /google ai ultra/i.test(c.text)
          );
          const enFlightIdx = candidates.findIndex((c) =>
            /aisle seats/i.test(c.text)
          );
          const trFlightIdx = candidates.findIndex((c) =>
            /koridor koltuğu/i.test(c.text)
          );
          if (proIdx !== -1 && ultraIdx !== -1) {
            const items: ReturnType<
              typeof deterministicFallbackMerge
            >["items"] = [
              {
                status: "conflict",
                fact: "Subscribes to the Google AI Ultra tier ($40/mo Cloud credit).",
                category: "projects",
                candidateIndices: [ultraIdx, proIdx],
                conflictTopic: "Google AI subscription tier",
                conflictOptions: [
                  {
                    fact: "Subscribes to the Google AI Ultra tier ($40/mo Cloud credit).",
                    candidateIndex: ultraIdx,
                    isNewest: true,
                  },
                  {
                    fact: "Subscribes to the Google AI Pro tier.",
                    candidateIndex: proIdx,
                    isNewest: false,
                  },
                ],
              },
            ];
            if (enFlightIdx !== -1 && trFlightIdx !== -1) {
              items.push({
                status: "merged",
                fact: "Prefers aisle seats on flights longer than 3 hours.",
                category: "preferences",
                candidateIndices: [enFlightIdx, trFlightIdx],
              });
            }
            const used = new Set([proIdx, ultraIdx, enFlightIdx, trFlightIdx]);
            const remaining = candidates.filter((c) => !used.has(c.idx));
            const rest = deterministicFallbackMerge(remaining, existingFacts);
            items.push(...rest.items);
            return Promise.resolve({
              modelUsed: preferredModel,
              payload: { items },
            });
          }
          return Promise.resolve({
            modelUsed: "gemini-4-hydrogen",
            payload: deterministicFallbackMerge(candidates, existingFacts),
          });
        },
      });
      return route.fulfill({ status: 200, json: merged });
    });

    // Navigate to Settings (/usage) first and tap "Open" on Memory card
    await page.goto(`${origin}/usage`, { waitUntil: "domcontentloaded" });
    const settingsMemoryLink = page.getByTestId("settings-open-memory");
    await expect(settingsMemoryLink).toBeVisible({ timeout: 15_000 });
    await expect(settingsMemoryLink).toContainText("3 saved memories");
    const settingsShot = join(scratchDir, "verify-settings-memory-390.png");
    await settingsMemoryLink.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: settingsShot, fullPage: false });

    await settingsMemoryLink.click();
    await expect(page.getByTestId("memory-bulk-textarea")).toBeVisible({
      timeout: 15_000,
    });

    // Paste a 53-line list: 3 sensitive lines (password, card, street address) + 3 existing duplicates + 47 brand-new facts
    const fiftyLines: string[] = [
      "- Never use pay-per-use API models without asking first",
      "- My WiFi password is SuperSecretPassword123!",
      "- Visa card 4532 0151 1283 0366",
      "- My home address is 221B Baker Street, London NW1 6XE",
      "- I live in London (Europe/London)",
      "• Daughter's name is Ece",
      "1. Kahvemi sade ve şekersiz içerim",
    ];
    for (let i = 1; i <= 46; i++) {
      fiftyLines.push(
        `${i + 1}. Project fact #${i}: concise bilingual EN/TR note (${i})`
      );
    }
    await page.getByTestId("memory-bulk-textarea").fill(fiftyLines.join("\n"));
    await page.getByTestId("memory-preview-button").click();

    const previewBox = page.getByTestId("memory-import-preview");
    await expect(previewBox).toBeVisible({ timeout: 10_000 });
    const sensitiveWarning = page.getByTestId("memory-sensitive-warning");
    await expect(sensitiveWarning).toBeVisible();
    await expect(sensitiveWarning).toContainText("(3)");
    await expect(sensitiveWarning).toContainText("Password / secret");
    await expect(sensitiveWarning).toContainText("Card number");
    await expect(sensitiveWarning).toContainText("Street / postal address");
    await expect(page.getByTestId("memory-preview-summary")).toContainText(
      "47 ready to save · 3 already saved"
    );
    await expect(page.getByTestId("memory-duplicate-badge")).toHaveCount(3);

    // Edit category in preview dropdown
    await page
      .getByTestId("memory-preview-category")
      .nth(4)
      .selectOption("projects");

    const previewOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(
      previewOverflow <= 390,
      `Memory preview horizontal overflow at 390px: ${previewOverflow}`
    );

    await previewBox.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const memoryPreviewShot = join(scratchDir, "verify-memory-preview-390.png");
    await page.screenshot({ path: memoryPreviewShot, fullPage: false });

    // Confirm saving the 47 new facts -> total saved memories becomes 50!
    await page.getByTestId("memory-confirm-save").click();
    await expect(page.getByTestId("memory-fact-row")).toHaveCount(50, {
      timeout: 10_000,
    });

    // Verify Rules & Preferences appear first, with Pinned/Searchable, Source, and Learned date visible
    const firstRow = page.getByTestId("memory-fact-row").first();
    await expect(firstRow).toContainText("Rules");
    await expect(firstRow).toContainText("Pinned");
    await expect(firstRow).toContainText("Pasted");
    await expect(firstRow).toContainText("Learned");

    // Test Search, Inline Edit, Delete, and Export buttons
    await page.getByTestId("memory-search-input").fill("Project fact #46:");
    await expect(page.getByTestId("memory-fact-row")).toHaveCount(1);
    await page.getByTestId("memory-edit-button").first().click();
    await page
      .getByTestId("memory-edit-textarea")
      .fill("Project fact #46: edited cleanly on iPhone 390px.");
    await page.getByTestId("memory-edit-save").click();
    await expect(
      page.getByText("Project fact #46: edited cleanly on iPhone 390px.")
    ).toBeVisible();

    // Clear search -> all 50 rows visible, delete 1 row -> 49 rows, verify Download trigger
    await page.getByTestId("memory-search-input").fill("");
    await expect(page.getByTestId("memory-fact-row")).toHaveCount(50);
    await page.getByTestId("memory-delete-button").first().click();
    await expect(page.getByTestId("memory-fact-row")).toHaveCount(49);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("memory-export-download").click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^assistant-memories-.*\.md$/);

    await page.getByTestId("memory-saved-list").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const savedOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(
      savedOverflow <= 390,
      `Memory saved list horizontal overflow at 390px: ${savedOverflow}`
    );
    const memorySavedShot = join(scratchDir, "verify-memory-saved-390.png");
    await page.screenshot({ path: memorySavedShot, fullPage: false });

    // 4-Source Multi-Export Merge Test (ChatGPT JSON + Claude MD + Gemini TR + Grok Bot MD) at 390px!
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("memory-add-source-chatgpt").click();
    await expect(page.getByTestId("memory-source-select-0")).toHaveValue(
      "chatgpt"
    );
    await page.getByTestId("memory-bulk-textarea").fill(
      JSON.stringify([
        {
          memory: "Subscribes to Google AI Pro tier",
          updated_at: "2025-09-12T10:00:00Z",
        },
        {
          memory: "Prefers aisle seats on flights over 3 hours",
          updated_at: "2025-10-01T10:00:00Z",
        },
        {
          memory:
            "Works as MENA Finance Controller at Korn Ferry covering UAE, Saudi Arabia, and Turkey",
          updated_at: "2025-10-05T10:00:00Z",
        },
        { memory: "WiFi password is SuperSecretPassword99!" },
      ])
    );

    await page.getByTestId("memory-add-source-claude").click();
    await page
      .getByTestId("memory-source-textarea-1")
      .fill(
        [
          "## Work",
          "- Korn Ferry'de MENA Finans Kontrolörü olarak çalışıyor.",
          "- Korn Ferry SA90 EOSB GL 239300 accrual balance is SAR 1,240,000.",
          "## Subscriptions",
          "- [2026-11-01] Subscribes to Google AI Ultra tier ($40/mo Cloud credit)",
        ].join("\n")
      );

    await page.getByTestId("memory-add-source-gemini").click();
    await page
      .getByTestId("memory-source-textarea-2")
      .fill(
        [
          "- 3 saatten uzun uçuşlarda koridor koltuğu tercih eder",
          "- StreamVault TV projesini Samsung Tizen TV için geliştiriyor",
        ].join("\n")
      );

    await page.getByTestId("memory-add-source-grok_bot").click();
    await page
      .getByTestId("memory-source-textarea-3")
      .fill(
        [
          "### Projects",
          "- Uses Tailscale private mesh for Cloud VM assistant-computer-01. _(source: chat, learned: 2026-11-14, searchable)_",
        ].join("\n")
      );

    const slotsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(
      slotsOverflow <= 390,
      `Multi-source slots horizontal overflow at 390px: ${slotsOverflow}`
    );
    const multiSlotsShot = join(
      scratchDir,
      "verify-memory-multisource-slots-390.png"
    );
    await page.screenshot({ path: multiSlotsShot, fullPage: false });

    await page.getByTestId("memory-preview-button").click();
    await expect(page.getByTestId("memory-merge-stats")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("memory-merge-model")).toContainText(
      "Gemini 4 Argon · Vertex"
    );
    await expect(page.getByTestId("memory-stat-new")).toContainText("2");
    await expect(page.getByTestId("memory-stat-merged")).toContainText("2");
    await expect(page.getByTestId("memory-stat-conflicts")).toContainText("1");
    await expect(page.getByTestId("memory-stat-sensitive")).toContainText("2");
    await expect(page.getByTestId("memory-sensitive-warning")).toContainText(
      "Korn Ferry data skipped (role/regions only)"
    );
    await expect(page.getByTestId("memory-conflict-item")).toHaveCount(1);
    await expect(page.getByTestId("memory-conflict-option")).toHaveCount(2);

    // Toggle conflict option to older and back to newest to verify 1-tap choice
    await page.getByTestId("memory-conflict-option").nth(1).click();
    await page.getByTestId("memory-conflict-option").nth(0).click();

    const multiPreviewOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(
      multiPreviewOverflow <= 390,
      `Multi-source preview horizontal overflow at 390px: ${multiPreviewOverflow}`
    );
    await page.getByTestId("memory-import-preview").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const multiPreviewShot = join(
      scratchDir,
      "verify-memory-multisource-preview-390.png"
    );
    await page.screenshot({ path: multiPreviewShot, fullPage: false });

    // One-tap approval saves all 5 merged/new/conflict items (49 + 5 = 54)!
    await page.getByTestId("memory-confirm-save").click();
    await expect(page.getByTestId("memory-fact-row")).toHaveCount(54, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("memory-saved-list")).toContainText(
      "ChatGPT + Claude"
    );
    await expect(page.getByTestId("memory-saved-list")).toContainText(
      "Subscribes to the Google AI Ultra tier ($40/mo Cloud credit)."
    );

    // Also verify "Remember this: …" renders the compact "Saved to memory" card in chat at 390x844
    await page.unroute("**/api/chat");
    await page.route("**/api/chat", (route) => {
      const sseRemember = [
        `data: ${JSON.stringify({ type: "start", messageId: "a-mem-1" })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-input-available",
          toolCallId: "mem-card-1",
          toolName: "saveProfileFact",
          input: {
            category: "preference",
            key: "aisle_seat",
            value: "I prefer aisle seats on flights over 3 hours.",
          },
          providerExecuted: true,
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-output-available",
          toolCallId: "mem-card-1",
          output: {
            saved: true,
            fact: {
              id: "50000000-0000-4000-8000-000000000999",
              category: "preference",
              key: "aisle_seat",
              value: "I prefer aisle seats on flights over 3 hours.",
            },
          },
          providerExecuted: true,
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text-start", id: "txt-m1" })}\n\n`,
        `data: ${JSON.stringify({
          type: "text-delta",
          id: "txt-m1",
          delta:
            "Got it — saved to your durable memory for future flight bookings.",
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text-end", id: "txt-m1" })}\n\n`,
        `data: ${JSON.stringify({ type: "finish" })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: sseRemember,
      });
    });

    await page.goto(
      `${origin}/?query=${encodeURIComponent("Remember this: I prefer aisle seats on flights over 3 hours.")}`,
      { waitUntil: "domcontentloaded" }
    );
    const savedMemoryCard = page.getByTestId("saved-memory-card");
    await expect(savedMemoryCard).toBeVisible({ timeout: 15_000 });
    await expect(savedMemoryCard).toContainText("Saved to memory");
    await expect(savedMemoryCard).toContainText(
      "I prefer aisle seats on flights over 3 hours."
    );
    const rememberCardShot = join(
      scratchDir,
      "verify-saved-memory-card-390.png"
    );
    await page.screenshot({ path: rememberCardShot, fullPage: false });

    console.log(
      `PASS: 390x844 iPhone verification succeeded (weather=${weatherShot}, ceoChart=${multiSearchShot}, comparison=${compShot}, timeline=${tlShot}, retry=${errorShot}, memoryPreview=${memoryPreviewShot}, memorySaved=${memorySavedShot}, rememberCard=${rememberCardShot}, mapVisible=${mapVisible})`
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
