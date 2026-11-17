import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { InferUIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { safeModelError } from "../../lib/ai/context/errors";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  ESCALATED_RESEARCH_MODEL,
  FALLBACK_GATEWAY_MODEL,
} from "../../lib/ai/models";
import {
  buildPartialAnswerFromSources,
  createMultiSearchRecoveryStream,
} from "../../lib/ai/multi-search-fallback";
import {
  ARGON,
  HYDROGEN,
  LUNA,
  TERRA,
  WEB_SEARCH_COST_USD,
  WEB_SEARCH_TOOL_ID,
} from "../../lib/ai/routing/catalog";
import { createRoutedModel } from "../../lib/ai/routing/model";
import type { InferenceSession } from "../../lib/ai/routing/session";
import {
  clearVertexTokenCacheForTests,
  getVertexWifAccessToken,
} from "../../lib/ai/vertex-auth";
import { createVertexGeminiAdapter } from "../../lib/ai/vertex-model";
import { buildOpenUiPayload } from "../../lib/openui/attach";
import {
  describeWeatherCode,
  formatShortDate,
} from "../../lib/openui/snapshot";
import { validateOpenUiSpec } from "../../lib/openui/validate";
import type { ChatMessage } from "../../lib/types";
import { DEFAULT_LIVE_MODEL } from "../../lib/voice/live-protocol";

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

test("Vertex AI Ultra routing: Hydrogen default, Argon research escalation, Hydrogen -> Terra fallback, never Luna/3.8-flash, live voice stays gemini-3.8-live, and Korn Ferry firewall blocks before network", async () => {
  assert.equal(DEFAULT_CHAT_MODEL, HYDROGEN);
  assert.equal(ESCALATED_RESEARCH_MODEL, ARGON);
  assert.equal(FALLBACK_GATEWAY_MODEL, TERRA);
  assert.equal(DEFAULT_LIVE_MODEL, "gemini-3.8-live");

  const ids = chatModels.map((m) => m.id);
  assert.ok(!ids.includes("gpt-6-luna"), "Luna must not appear in chatModels");
  assert.ok(
    !ids.some((id) => id.includes("3.8-flash")),
    "Gemini 3.8 Flash must never appear in chatModels"
  );
  for (const model of chatModels) {
    assert.notEqual(model.name, "Everyday chat");
    assert.notEqual(model.name, "Detailed chat");
  }
  assert.equal(
    chatModels.find((m) => m.id === HYDROGEN)?.name,
    "Gemini 4 Hydrogen"
  );
  assert.equal(chatModels.find((m) => m.id === ARGON)?.name, "Gemini 4 Argon");
  assert.equal(chatModels.find((m) => m.id === TERRA)?.name, "GPT-6.1 Terra");

  // Everyday trivial turn stays on Gemini 4 Hydrogen
  const trivial = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, ARGON, TERRA],
    userText: "Merhaba, nasılsın?",
    requestedTools: [],
    baseEffort: "medium",
  });
  assert.equal(trivial.modelId, HYDROGEN);
  assert.equal(trivial.escalated, false);

  // Research / multi-search / hard questions auto-escalate Hydrogen -> Argon
  const escalatedSearch = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, ARGON, TERRA],
    userText: "En çok kazanan CEO'lar ve yıllık kazançları nelerdir?",
    requestedTools: ["webSearch"],
    baseEffort: "medium",
  });
  assert.equal(escalatedSearch.modelId, ARGON);
  assert.equal(escalatedSearch.reasoningEffort, "high");
  assert.equal(escalatedSearch.escalated, true);

  // Zero-key Vertex WIF token exchange uses STS + x-vercel-oidc-token, NEVER GEMINI_API_KEY
  const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
  const priorEnv = { ...process.env };
  try {
    process.env.GOOGLE_VERTEX_PROJECT_ID = "project-cd0bc64c-0025-446c-b41";
    process.env.GOOGLE_VERTEX_WORKLOAD_AUDIENCE =
      "//iam.googleapis.com/projects/439781161791/locations/global/workloadIdentityPools/vercel-pool/providers/vercel-oidc";
    process.env.GEMINI_API_KEY = "poison-ai-studio-key-must-not-be-used";
    clearVertexTokenCacheForTests();

    const headerPart = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
      "base64url"
    );
    const payloadPart = Buffer.from(
      JSON.stringify({ iss: "https://oidc.vercel.com/csahingoz-3779" })
    ).toString("base64url");
    const fakeOidc = `${headerPart}.${payloadPart}.sig`;
    (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
      get: () => ({ headers: { "x-vercel-oidc-token": fakeOidc } }),
    };

    const seenUrls: string[] = [];
    const seenAuthHeaders: string[] = [];
    const wifToken = await getVertexWifAccessToken((input, init) => {
      seenUrls.push(String(input));
      const bodyText = String(init?.body ?? "");
      assert.ok(
        !bodyText.includes("poison-ai-studio-key-must-not-be-used"),
        "STS must never send GEMINI_API_KEY"
      );
      assert.match(bodyText, /vercel-pool%2Fproviders%2Fvercel-oidc/);
      return Promise.resolve(
        Response.json({
          access_token: "ya29.wif-ultra-token",
          expires_in: 3600,
        })
      );
    });
    assert.equal(wifToken, "ya29.wif-ultra-token");
    assert.deepEqual(seenUrls, ["https://sts.googleapis.com/v1/token"]);

    const vertexAdapter = createVertexGeminiAdapter(HYDROGEN, {
      fetcher: (input, init) => {
        seenUrls.push(String(input));
        seenAuthHeaders.push(
          new Headers(init?.headers).get("authorization") ?? ""
        );
        return Promise.resolve(
          Response.json({
            candidates: [
              {
                content: { parts: [{ text: "Hello from Vertex Ultra" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 },
          })
        );
      },
      getAccessToken: () => Promise.resolve(wifToken),
    });

    const gen = await vertexAdapter.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    assert.equal(gen.content[0]?.type, "text");
    assert.equal(
      seenUrls[1],
      "https://aiplatform.googleapis.com/v1/projects/project-cd0bc64c-0025-446c-b41/locations/global/publishers/google/models/gemini-4-hydrogen:generateContent"
    );
    assert.equal(seenAuthHeaders[0], "Bearer ya29.wif-ultra-token");

    // Korn Ferry firewall blocks BEFORE any network call AND never falls back
    let kfNetworkCalls = 0;
    const kfSession: InferenceSession = {
      available: [HYDROGEN, ARGON, TERRA],
      exposed: false,
      toolBoundary: false,
      fallbackUsed: false,
      ledger: {
        reserve: () => Promise.resolve("inv-kf"),
        settle: () => Promise.resolve(),
      },
    };
    const kfRouted = createRoutedModel(
      HYDROGEN,
      kfSession,
      (id) =>
        id === HYDROGEN || id === ARGON
          ? createVertexGeminiAdapter(id, {
              fetcher: () => {
                kfNetworkCalls++;
                return Promise.reject(new Error("must_not_call_network"));
              },
              getAccessToken: () => Promise.resolve(wifToken),
            })
          : new MockLanguageModelV4({
              doGenerate: () => {
                kfNetworkCalls++;
                return Promise.reject(new Error("must_not_fallback_on_kf"));
              },
            }),
      { gateway: true, vertexSearch: true }
    );

    await assert.rejects(async () => {
      await kfRouted.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Review Korn Ferry SA90 EOSB accrual GL 239300",
              },
            ],
          },
        ],
      });
    }, /model_work_boundary/);
    assert.equal(
      kfNetworkCalls,
      0,
      "Zero network calls or fallbacks allowed when Korn Ferry material is detected"
    );
    assert.match(
      safeModelError(new Error("model_work_boundary"), "Korn Ferry SA90"),
      /Blocked: Korn Ferry/
    );
    assert.match(
      safeModelError(
        new Error("model_work_boundary"),
        "Korn Ferry SA90 nedir?"
      ),
      /Engellendi: Korn Ferry/
    );
  } finally {
    process.env = priorEnv;
    (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = undefined;
    clearVertexTokenCacheForTests();
  }

  // Fallback chain: Argon -> Hydrogen -> Terra (Gateway); NEVER Luna or 3.8 Flash
  const hopOrder: string[] = [];
  const fallbackSession: InferenceSession = {
    available: [HYDROGEN, ARGON, TERRA, LUNA],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    ledger: {
      reserve: () => Promise.resolve("inv-fallback"),
      settle: () => Promise.resolve(),
    },
  };
  const chainModel = createRoutedModel(
    ARGON,
    fallbackSession,
    (id) => {
      hopOrder.push(id);
      if (id === ARGON || id === HYDROGEN) {
        return new MockLanguageModelV4({
          doStream: () =>
            Promise.reject(
              Object.assign(new Error("503"), { statusCode: 503 })
            ),
        });
      }
      return new MockLanguageModelV4({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(c) {
                c.enqueue({ type: "stream-start", warnings: [] });
                c.enqueue({ type: "text-start", id: "t1" });
                c.enqueue({ type: "text-delta", id: "t1", delta: "Terra OK" });
                c.enqueue({ type: "text-end", id: "t1" });
                c.enqueue({
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: {
                    inputTokens: {
                      total: 10,
                      noCache: 10,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    outputTokens: { total: 4, text: 4, reasoning: undefined },
                  },
                });
                c.close();
              },
            }),
          }),
      });
    },
    { gateway: true, vertexSearch: true }
  );
  const chainRes = await chainModel.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  });
  const chainReader = chainRes.stream.getReader();
  let chainText = "";
  for (;;) {
    const part = await chainReader.read();
    if (part.done) {
      break;
    }
    if (part.value.type === "text-delta") {
      chainText += part.value.delta;
    }
  }
  assert.equal(chainText, "Terra OK");
  assert.deepEqual(hopOrder, [ARGON, HYDROGEN, TERRA]);

  // And if Terra also fails transiently, it NEVER hops to Luna
  const triedAfterTerra: string[] = [];
  const terraFailSession: InferenceSession = {
    available: [HYDROGEN, TERRA, LUNA],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    ledger: {
      reserve: () => Promise.resolve("inv-no-luna"),
      settle: () => Promise.resolve(),
    },
  };
  const noLunaFallback = createRoutedModel(
    HYDROGEN,
    terraFailSession,
    (id) => {
      triedAfterTerra.push(id);
      return new MockLanguageModelV4({
        doStream: () =>
          Promise.reject(Object.assign(new Error("503"), { statusCode: 503 })),
      });
    },
    { gateway: true, vertexSearch: true }
  );
  await assert.rejects(async () => {
    const res = await noLunaFallback.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    await res.stream.getReader().read();
  }, /model_transient/);
  assert.deepEqual(
    triedAfterTerra,
    [HYDROGEN, TERRA],
    "Fallback order must be Hydrogen -> Terra and never Luna"
  );
});
