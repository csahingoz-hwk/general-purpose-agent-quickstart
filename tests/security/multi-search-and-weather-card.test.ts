import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { InferUIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import { chatModels, DEFAULT_CHAT_MODEL } from "../../lib/ai/models";
import {
  buildPartialAnswerFromSources,
  createMultiSearchRecoveryStream,
} from "../../lib/ai/multi-search-fallback";
import {
  HYDROGEN,
  LUNA,
  TERRA,
  WEB_SEARCH_COST_USD,
  WEB_SEARCH_TOOL_ID,
} from "../../lib/ai/routing/catalog";
import { createRoutedModel } from "../../lib/ai/routing/model";
import type { InferenceSession } from "../../lib/ai/routing/session";
import { buildOpenUiPayload } from "../../lib/openui/attach";
import {
  describeWeatherCode,
  formatShortDate,
} from "../../lib/openui/snapshot";
import { validateOpenUiSpec } from "../../lib/openui/validate";
import type { ChatMessage } from "../../lib/types";

test("Weather card formats short dates (Wed 18), current conditions icon/description, and High/Low series", () => {
  assert.equal(formatShortDate("2026-11-18"), "Wed 18");
  assert.equal(formatShortDate("2026-11-19"), "Thu 19");
  assert.deepEqual(describeWeatherCode(2), {
    icon: "partly-cloudy",
    description: "Partly cloudy",
  });
  assert.deepEqual(describeWeatherCode(61), {
    icon: "rain",
    description: "Rain showers",
  });

  const londonWeather = {
    latitude: 51.5074,
    longitude: -0.1278,
    cityName: "London",
    current: {
      temperature_2m: 16.2,
      apparent_temperature: 14.8,
      weather_code: 2,
      wind_speed_10m: 18,
    },
    current_units: { temperature_2m: "°C" },
    daily: {
      time: ["2026-11-17", "2026-11-18", "2026-11-19"],
      temperature_2m_max: [16.8, 15.1, 13.9],
      temperature_2m_min: [9.4, 8.2, 7.1],
      precipitation_probability_max: [10, 45, 70],
      weather_code: [2, 3, 61],
    },
  };

  const payload = buildOpenUiPayload(
    [
      {
        type: "tool-getWeather",
        state: "output-available",
        output: londonWeather,
      },
    ],
    LUNA,
    "2026-11-17T18:00:00.000Z"
  );

  assert.ok(payload);
  assert.equal(validateOpenUiSpec(payload.spec, payload.data).ok, true);

  const hero = payload.data.stats.current;
  assert.ok(hero);
  assert.equal(hero.value, "16.2°C");
  assert.equal(hero.icon, "partly-cloudy");
  assert.equal(hero.description, "Partly cloudy");
  assert.match(hero.subtext ?? "", /H 17° · L 9°/);

  const chart = payload.data.series.dailyHigh;
  assert.ok(chart);
  assert.equal(chart.unit, "°C");
  assert.deepEqual(
    chart.points.map((p) => p.label),
    ["Tue 17", "Wed 18", "Thu 19"]
  );
  assert.deepEqual(
    chart.secondaryPoints?.map((p) => p.value),
    [9.4, 8.2, 7.1]
  );

  const dailyTable = payload.data.tables.daily;
  assert.ok(dailyTable);
  assert.deepEqual(dailyTable.columns, ["Day", "High", "Low", "Rain"]);
  assert.deepEqual(dailyTable.rows[1], ["Wed 18", "15°", "8°", "45%"]);
});

test("4-search Turkish top-earners question completes natively with cited answer and settles 4 searches", async () => {
  const settled: { outcome: string; extraUsd?: number }[] = [];
  const session: InferenceSession = {
    available: [LUNA, TERRA],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    ledger: {
      reserve: () => Promise.resolve("inv-4-searches"),
      settle(_id, _model, outcome, _usage, extraUsd) {
        settled.push({ outcome, extraUsd });
        return Promise.resolve();
      },
    },
  };

  const parts: LanguageModelV4StreamPart[] = [];
  for (let i = 0; i < 4; i++) {
    parts.push(
      {
        type: "tool-call",
        toolCallId: `tr-s-${i}`,
        toolName: "webSearch",
        input: JSON.stringify({ query: `en çok kazanan CEO maaşları ${i}` }),
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: `tr-s-${i}`,
        toolName: "webSearch",
        result: {
          results: [
            {
              title: `Yıllık Kazanç Raporu #${i + 1}`,
              url: `https://example.com/rapor-${i + 1}`,
              snippet: `Üst düzey yönetici paketi yıllık ${(i + 1) * 45} milyon ABD doları olarak açıklandı.`,
            },
          ],
        },
        providerExecuted: true,
      } as LanguageModelV4StreamPart
    );
  }
  parts.push(
    { type: "text-start", id: "ans" },
    {
      type: "text-delta",
      id: "ans",
      delta:
        "En yüksek yıllık kazanca sahip yöneticiler ve toplam paketleri [Yıllık Kazanç Raporu #1](https://example.com/rapor-1) verilerine göre listelenmiştir.",
    },
    { type: "text-end", id: "ans" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 800,
          noCache: 800,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 180, text: 180, reasoning: undefined },
      },
    }
  );

  const model = createRoutedModel(
    LUNA,
    session,
    () =>
      new MockLanguageModelV4({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(controller) {
                for (const part of parts) {
                  controller.enqueue(part);
                }
                controller.close();
              },
            }),
          }),
      }),
    { gateway: true }
  );

  const { stream } = await model.doStream({
    prompt: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Dünyada en çok kazanan yöneticiler kimler ve yıllık maaşları ne kadar?",
          },
        ],
      },
    ],
    tools: [
      {
        type: "provider",
        id: WEB_SEARCH_TOOL_ID,
        name: "webSearch",
        args: { count: 5 },
      },
    ],
  });

  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    if (next.value.type === "text-delta") {
      text += next.value.delta;
    }
  }

  assert.match(text, /En yüksek yıllık kazanca sahip yöneticiler/);
  assert.equal(settled.length, 1);
  assert.equal(settled[0]?.outcome, "completed");
  assert.ok(
    Math.abs((settled[0]?.extraUsd ?? 0) - 4 * WEB_SEARCH_COST_USD) < 1e-12
  );
});

test("Multi-search recovery stream synthesizes answer with sources and closes dangling search when stream drops", async () => {
  const userQuestion =
    "Dünyada en çok kazanan CEO'lar kimler ve yıllık kazançları ne kadar?";

  const incoming: InferUIMessageChunk<ChatMessage>[] = [
    {
      type: "tool-input-available",
      toolCallId: "s1",
      toolName: "webSearch",
      input: { query: "top paid CEOs annual compensation" },
      providerExecuted: true,
    },
    {
      type: "tool-output-available",
      toolCallId: "s1",
      output: {
        results: [
          {
            title: "Equilar Top Paid CEOs",
            url: "https://example.com/equilar-ceos",
            snippet:
              "Hock Tan led S&P 500 CEO pay at $161.8M total annual compensation.",
          },
          {
            title: "Bloomberg Pay Index",
            url: "https://example.com/bloomberg-pay",
            snippet:
              "Nikesh Arora received $151.4M in total yearly equity and salary.",
          },
        ],
      },
      providerExecuted: true,
    },
    // Dangling 4th/9th search ("Searching the web…") followed by mid-stream drop/cap
    {
      type: "tool-input-available",
      toolCallId: "s-dangling",
      toolName: "webSearch",
      input: { query: "more executive pay" },
      providerExecuted: true,
    },
    {
      type: "error",
      errorText: "model_tool",
    },
  ];

  let finalizedRecovered = false;
  const recovery = createMultiSearchRecoveryStream({
    userText: userQuestion,
    async *synthesize({ hits }) {
      await Promise.resolve();
      assert.equal(hits.length, 2);
      yield "Toplanan kaynaklara göre en yüksek yıllık paketler:\n";
      yield "- **Hock Tan**: 161,8 milyon $ ([Equilar Top Paid CEOs](https://example.com/equilar-ceos))\n";
      yield "- **Nikesh Arora**: 151,4 milyon $ ([Bloomberg Pay Index](https://example.com/bloomberg-pay))";
    },
    onFinalize: (recovered) => {
      finalizedRecovered = recovered;
    },
  });

  const source = new ReadableStream<InferUIMessageChunk<ChatMessage>>({
    start(controller) {
      for (const chunk of incoming) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const out: InferUIMessageChunk<ChatMessage>[] = [];
  const reader = source.pipeThrough(recovery).getReader();
  for (;;) {
    const item = await reader.read();
    if (item.done) {
      break;
    }
    out.push(item.value);
  }

  assert.equal(finalizedRecovered, true);
  assert.equal(
    out.some((c) => c.type === "error"),
    false,
    "error chunk must be replaced by synthesized answer"
  );
  const danglingClosed = out.find(
    (c) => c.type === "tool-output-available" && c.toolCallId === "s-dangling"
  );
  assert.ok(danglingClosed, "dangling search spinner must be closed cleanly");

  const fullText = out
    .filter(
      (
        c
      ): c is Extract<
        InferUIMessageChunk<ChatMessage>,
        { type: "text-delta" }
      > => c.type === "text-delta"
    )
    .map((c) => c.delta)
    .join("");
  assert.match(fullText, /Hock Tan/);
  assert.match(fullText, /https:\/\/example\.com\/equilar-ceos/);

  // Also verify deterministic fallback if the synthesis model call itself throws
  const fallbackMarkdown = buildPartialAnswerFromSources(userQuestion, [
    {
      title: "Equilar Top Paid CEOs",
      url: "https://example.com/equilar-ceos",
      hostname: "example.com",
      snippet: "Hock Tan led S&P 500 CEO pay at $161.8M.",
    },
  ]);
  assert.match(fallbackMarkdown, /Toplanan kaynaklardan öne çıkan bulgular/);
  assert.match(
    fallbackMarkdown,
    /\[Equilar Top Paid CEOs\]\(https:\/\/example\.com\/equilar-ceos\)/
  );
});

test("Owner model floor: default is GPT-6.1 Terra, real model names shown, Luna excluded from fallback, and research auto-escalates", async () => {
  assert.equal(DEFAULT_CHAT_MODEL, TERRA);
  for (const model of chatModels) {
    assert.notEqual(model.name, "Everyday chat");
    assert.notEqual(model.name, "Detailed chat");
  }
  assert.equal(chatModels.find((m) => m.id === TERRA)?.name, "GPT-6.1 Terra");
  assert.equal(
    chatModels.find((m) => m.id === HYDROGEN)?.name,
    "Gemini 4 Hydrogen"
  );
  assert.equal(chatModels.find((m) => m.id === LUNA)?.name, "GPT-6 Luna");

  // Manual Luna selection stays on Luna ONLY for trivial chat turns
  const trivial = resolveTurnModelAndEffort({
    selectedModelId: LUNA,
    availableModelIds: [TERRA, HYDROGEN, LUNA],
    userText: "Merhaba, nasılsın?",
    requestedTools: [],
    baseEffort: "low",
  });
  assert.equal(trivial.modelId, LUNA);
  assert.equal(trivial.reasoningEffort, "low");
  assert.equal(trivial.escalated, false);

  // Manual Luna selection auto-escalates on multi-search / research questions to Terra with >= medium effort
  const escalatedSearch = resolveTurnModelAndEffort({
    selectedModelId: LUNA,
    availableModelIds: [TERRA, HYDROGEN, LUNA],
    userText: "En çok kazanan CEO'lar ve yıllık kazançları nelerdir?",
    requestedTools: ["webSearch"],
    baseEffort: "low",
  });
  assert.equal(escalatedSearch.modelId, TERRA);
  assert.ok(
    escalatedSearch.reasoningEffort === "medium" ||
      escalatedSearch.reasoningEffort === "high"
  );
  assert.equal(escalatedSearch.escalated, true);

  // If Terra isn't on the Gateway, research escalates to Gemini 4 Hydrogen
  const escalatedHydrogen = resolveTurnModelAndEffort({
    selectedModelId: LUNA,
    availableModelIds: [HYDROGEN, LUNA],
    userText: "Compare cloud database benchmarks in depth",
    requestedTools: [],
    baseEffort: "low",
  });
  assert.equal(escalatedHydrogen.modelId, HYDROGEN);
  assert.equal(escalatedHydrogen.reasoningEffort, "high");

  // Terra transient failure NEVER falls back down to Luna
  const tried: string[] = [];
  const session: InferenceSession = {
    available: [TERRA, LUNA],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    ledger: {
      reserve: () => Promise.resolve("inv-no-luna"),
      settle: () => Promise.resolve(),
    },
  };
  const noLunaFallback = createRoutedModel(
    TERRA,
    session,
    (id) => {
      tried.push(id);
      return new MockLanguageModelV4({
        doStream: () =>
          Promise.reject(Object.assign(new Error("503"), { statusCode: 503 })),
      });
    },
    { gateway: true }
  );
  await assert.rejects(async () => {
    const res = await noLunaFallback.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    await res.stream.getReader().read();
  }, /model_transient/);
  assert.deepEqual(tried, [TERRA], "Terra must never fall back down to Luna");
});
