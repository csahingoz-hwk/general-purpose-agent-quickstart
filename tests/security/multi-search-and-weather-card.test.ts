import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { InferUIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { safeModelError } from "../../lib/ai/context/errors";
import { canRetryReply, prepareRetry } from "../../lib/ai/conversation-state";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  ESCALATED_RESEARCH_MODEL,
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
import { createUsageLedger } from "../../lib/ai/routing/ledger";
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
import { isVisualCandidateTurn } from "../../lib/openui/structured-answer";
import { validateOpenUiSpec } from "../../lib/openui/validate";
import type { ChatMessage } from "../../lib/types";
import { sanitizeText } from "../../lib/utils";
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

test("Vertex AI Ultra zero pay-per-use routing: ONLY Hydrogen & Argon in chatModels, zero silent fallback to Terra/Luna, plain-English error + retry on failure, live voice on Vertex gemini-3.8-live, and Korn Ferry firewall", async () => {
  assert.equal(DEFAULT_CHAT_MODEL, HYDROGEN);
  assert.equal(ESCALATED_RESEARCH_MODEL, ARGON);
  assert.equal(DEFAULT_LIVE_MODEL, "gemini-3.8-live");

  const ids: string[] = chatModels.map((m) => m.id);
  assert.ok(!ids.includes("gpt-6-luna"));
  assert.ok(!ids.includes("gpt-6.1-terra"));
  assert.ok(
    !ids.some((id) => id.includes("3.8-flash")),
    "Gemini 3.8 Flash must never appear in chatModels"
  );
  assert.deepEqual(
    ids,
    [HYDROGEN, ARGON],
    "Only Google AI Ultra Vertex models may appear in chatModels (zero pay-per-use models)"
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

  // Everyday trivial turn stays on Gemini 4 Hydrogen with fast `low` effort (~1s TTFT)
  const trivial = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, ARGON, TERRA],
    userText: "Merhaba, nasılsın?",
    requestedTools: [],
    baseEffort: "low",
  });
  assert.equal(trivial.modelId, HYDROGEN);
  assert.equal(trivial.reasoningEffort, "low");
  assert.equal(trivial.escalated, false);

  // Research / multi-search / hard questions auto-escalate Hydrogen -> Argon with medium+ effort
  const escalatedSearch = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, ARGON, TERRA],
    userText: "En çok kazanan CEO'lar ve yıllık kazançları nelerdir?",
    requestedTools: ["webSearch"],
    baseEffort: "low",
  });
  assert.equal(escalatedSearch.modelId, ARGON);
  assert.equal(escalatedSearch.reasoningEffort, "medium");
  assert.equal(escalatedSearch.escalated, true);

  const deepProof = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, ARGON, TERRA],
    userText: "Prove this theorem and find the root cause of the deadlock",
    requestedTools: [],
    baseEffort: "low",
  });
  assert.equal(deepProof.modelId, ARGON);
  assert.equal(deepProof.reasoningEffort, "high");

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

  // Zero automatic fallback on Vertex AI models: neither Argon nor Hydrogen
  // silently switches to Terra, Luna, or any paid Gateway model on failure.
  for (const primary of [ARGON, HYDROGEN] as const) {
    const hopOrder: string[] = [];
    const noFallbackSession: InferenceSession = {
      available: [HYDROGEN, ARGON, TERRA, LUNA],
      exposed: false,
      toolBoundary: false,
      fallbackUsed: false,
      ledger: {
        reserve: () => Promise.resolve(`inv-no-fallback-${primary}`),
        settle: () => Promise.resolve(),
      },
    };
    const noFallbackModel = createRoutedModel(
      primary,
      noFallbackSession,
      (id) => {
        hopOrder.push(id);
        return new MockLanguageModelV4({
          doStream: () =>
            Promise.reject(
              Object.assign(new Error("503"), { statusCode: 503 })
            ),
        });
      },
      { gateway: false, vertexSearch: true }
    );
    await assert.rejects(async () => {
      const res = await noFallbackModel.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });
      await res.stream.getReader().read();
    }, /model_transient/);
    assert.deepEqual(
      hopOrder,
      [primary],
      `${primary} must fail cleanly without silent fallback to Terra or Luna`
    );
  }

  // Plain-English error + Retry readiness even when data-turn-status arrived before Vertex failed
  const savedUserMsg: ChatMessage = {
    id: "u-retry-1",
    role: "user",
    parts: [{ type: "text", text: "What is the weather in London?" }],
  };
  const emptyTurnStatusStub: ChatMessage = {
    id: "a-stub-1",
    role: "assistant",
    parts: [
      {
        type: "data-turn-status",
        data: { phase: "thinking", model: HYDROGEN },
      },
    ],
  };
  assert.equal(canRetryReply([savedUserMsg, emptyTurnStatusStub]), true);
  const preparedRetry = prepareRetry(
    [savedUserMsg, emptyTurnStatusStub],
    savedUserMsg.id
  );
  assert.equal(preparedRetry.messages.length, 1);
  assert.equal(preparedRetry.messages[0]?.id, savedUserMsg.id);
  assert.equal(preparedRetry.replaceId, emptyTurnStatusStub.id);
  assert.match(
    safeModelError(new Error("model_transient"), "Hello"),
    /Retry response.*No paid fallback was used/
  );
});

test("Zero-wait Vertex ledger, immediate search progress, and all 6 generative UI cards (comparison, timeline, chart, table, map, source cards) validate cleanly", async () => {
  // 1) Zero-wait Vertex ledger reservation (0 DB queries, no internal spend cap)
  const ledger = createUsageLedger("owner-u1", "req-fast");
  const vertexResId = await ledger.reserve({ model: HYDROGEN, reserveUsd: 0 });
  assert.match(vertexResId, /^vertex:/);
  const statResId = await ledger.reserve({ model: TERRA, reserveUsd: 25 });
  assert.match(statResId, /^stat:/);

  // 2) Immediate webSearch tool-call emitted BEFORE first text-delta in Vertex doStream
  const sseBody = [
    `data: ${JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: "Grounded answer text." }] },
          finishReason: "STOP",
          groundingMetadata: {
            webSearchQueries: ["gold price today"],
            groundingChunks: [
              {
                web: { uri: "https://reuters.com/gold", title: "Reuters Gold" },
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 6 },
    })}`,
    "",
    "",
  ].join("\n");

  const searchStreamAdapter = createVertexGeminiAdapter(ARGON, {
    projectId: "project-cd0bc64c-0025-446c-b41",
    getAccessToken: () => Promise.resolve("tok"),
    fetcher: () =>
      Promise.resolve(
        new Response(sseBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      ),
  });
  const { stream } = await searchStreamAdapter.doStream({
    prompt: [
      { role: "user", content: [{ type: "text", text: "Gold price today?" }] },
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
  const events: LanguageModelV4StreamPart[] = [];
  const sr = stream.getReader();
  for (;;) {
    const next = await sr.read();
    if (next.done) {
      break;
    }
    events.push(next.value);
  }
  const toolCallIdx = events.findIndex(
    (e) => e.type === "tool-call" && e.toolName === "webSearch"
  );
  const firstTextIdx = events.findIndex((e) => e.type === "text-delta");
  const toolResultIdx = events.findIndex(
    (e) => e.type === "tool-result" && e.toolName === "webSearch"
  );
  assert.ok(
    toolCallIdx > 0 && toolCallIdx < firstTextIdx,
    "Search progress tool-call must precede text-delta"
  );
  assert.ok(toolResultIdx > firstTextIdx);

  // 3) Visual candidate classifier keeps casual chat lean and activates for structured intents
  assert.equal(isVisualCandidateTurn("Merhaba, nasılsın?", []), false);
  assert.equal(
    isVisualCandidateTurn("Compare MacBook Air M4 vs MacBook Pro M4", []),
    true
  );
  assert.equal(
    isVisualCandidateTurn("SpaceX Starship milestones timeline", []),
    true
  );

  // 4) Comparison, Timeline, Chart+Table (with digits in title!), Map, and Markdown table fallback
  const comparisonAnswer = [
    "MacBook Air M4 taşınabilirlikte, MacBook Pro M4 ise sürdürülebilir yükte öne çıkıyor.",
    "```visual-json",
    JSON.stringify({
      kind: "comparison",
      title: "MacBook Air M4 vs MacBook Pro M4 (2026)",
      summary: "Apple Silicon laptop comparison",
      options: ["MacBook Air M4", "MacBook Pro M4"],
      rows: [
        {
          feature: "Weight",
          values: ["1.24 kg", "1.55 kg"],
          winnerIndex: 0,
        },
        {
          feature: "Display",
          values: ["60Hz Liquid Retina", "120Hz Mini-LED ProMotion"],
          winnerIndex: 1,
        },
        {
          feature: "Cooling",
          values: ["Fanless silent", "Active fan sustained"],
          winnerIndex: 1,
        },
      ],
      verdict: "Pick Air for travel, Pro for sustained compiles & 120Hz.",
    }),
    "```",
  ].join("\n");

  assert.equal(
    sanitizeText(comparisonAnswer),
    "MacBook Air M4 taşınabilirlikte, MacBook Pro M4 ise sürdürülebilir yükte öne çıkıyor."
  );

  const compPayload = buildOpenUiPayload(
    [{ type: "text", text: comparisonAnswer }],
    ARGON
  );
  assert.ok(compPayload);
  assert.equal(validateOpenUiSpec(compPayload.spec, compPayload.data).ok, true);
  assert.equal(/\d/.test(compPayload.spec), false);
  assert.match(compPayload.spec, /Comparison\(/);
  assert.equal(
    compPayload.data.header?.title,
    "MacBook Air M4 vs MacBook Pro M4 (2026)"
  );

  const timelineAnswer = [
    "Here are the key Starship milestones:",
    "```visual-json",
    JSON.stringify({
      kind: "timeline",
      title: "Starship Flight Milestones (2023–2026)",
      events: [
        {
          when: "Apr 2023",
          title: "Integrated Flight Test 1",
          detail: "First full-stack liftoff from Starbase.",
        },
        {
          when: "Oct 2024",
          title: "Mechazilla Booster Catch",
          detail: "Super Heavy caught on launch tower arms.",
          badge: "Breakthrough",
        },
      ],
    }),
    "```",
  ].join("\n");
  const tlPayload = buildOpenUiPayload(
    [{ type: "text", text: timelineAnswer }],
    HYDROGEN
  );
  assert.ok(tlPayload);
  assert.equal(validateOpenUiSpec(tlPayload.spec, tlPayload.data).ok, true);
  assert.match(tlPayload.spec, /Timeline\(/);

  const chartAnswer = [
    "Top 4 tech CEOs by 2026 annual compensation:",
    "```visual-json",
    JSON.stringify({
      kind: "chart",
      chartKind: "bar",
      title: "Top 4 Tech CEO Pay (2026)",
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
  const chartPayload = buildOpenUiPayload(
    [{ type: "text", text: chartAnswer }],
    ARGON
  );
  assert.ok(chartPayload);
  assert.equal(
    validateOpenUiSpec(chartPayload.spec, chartPayload.data).ok,
    true
  );
  assert.match(chartPayload.spec, /Tabs\(\["Chart", "Table"\]/);

  const mapAnswer = [
    "Big Ben sits at the north end of the Palace of Westminster.",
    "```visual-json",
    JSON.stringify({
      kind: "map",
      title: "Big Ben · Westminster",
      label: "Big Ben",
      latitude: 51.5007,
      longitude: -0.1246,
    }),
    "```",
  ].join("\n");
  const mapPayload = buildOpenUiPayload(
    [{ type: "text", text: mapAnswer }],
    HYDROGEN
  );
  assert.ok(mapPayload);
  assert.equal(validateOpenUiSpec(mapPayload.spec, mapPayload.data).ok, true);
  assert.match(mapPayload.spec, /Map\(/);

  // Markdown table automatic promotion + unclosed/malformed visual-json safety
  const mdTable = [
    "### UK Income Tax Bands",
    "| Band | Rate |",
    "| --- | --- |",
    "| Basic | 20% |",
    "| Higher | 40% |",
    "| Additional | 45% |",
  ].join("\n");
  const mdPayload = buildOpenUiPayload(
    [{ type: "text", text: mdTable }],
    HYDROGEN
  );
  assert.ok(mdPayload);
  assert.equal(validateOpenUiSpec(mdPayload.spec, mdPayload.data).ok, true);

  // Unclosed / broken visual-json mid-stream returns null (NEVER a broken card!)
  assert.equal(
    buildOpenUiPayload(
      [{ type: "text", text: 'Streaming...\n```visual-json\n{"kind":"chart"' }],
      HYDROGEN
    ),
    null
  );
  assert.equal(
    buildOpenUiPayload(
      [{ type: "text", text: "```visual-json\n{bad json}\n```" }],
      HYDROGEN
    ),
    null
  );
});
