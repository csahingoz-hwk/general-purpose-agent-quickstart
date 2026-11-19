import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import type { Session } from "next-auth";
import { HYDROGEN, NEON } from "../../lib/ai/routing/catalog";
import { inferenceSession } from "../../lib/ai/routing/session";
import {
  executeSharedVoiceToolCall,
  runServerWebSearch,
} from "../../lib/ai/tools/shared-registry";
import { runFirecrawlSearch } from "../../lib/connectors/firecrawl";
import { createInMemoryMemoryStore } from "../../lib/memory/store";
import {
  createInMemoryApprovalPreferencesStore,
  createInMemoryExecutionJournalStore,
} from "../../lib/safety/approval-preferences";
import {
  CLIENT_FILLERS_EN,
  CLIENT_FILLERS_TR,
  isFillerOnlyUtterance,
  LIVE_VOICE_TOOL_DECLARATIONS,
} from "../../lib/voice/live-protocol";
import { buildVoiceSystemInstruction } from "../../lib/voice/live-session";
import { executeVoiceTextAgentHandoff } from "../../lib/voice/text-agent-handoff";
import { webSearchView } from "../../lib/web-search-sources";

const fakeSession: Session = {
  expires: new Date(Date.now() + 3_600_000).toISOString(),
  user: {
    id: "97a9a7c5-e220-425d-9589-7e63b607ca75",
    email: "owner@example.test",
    name: "Çağlar",
    type: "regular",
  },
};

const mockUsage: LanguageModelV4Usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 30, text: 30, reasoning: 0 },
};

test("runServerWebSearch tries Firecrawl first for Turkish Süper Lig query and stops once >=1 source is returned", async () => {
  const callOrder: string[] = [];
  const res = await runServerWebSearch({
    query: "Süper Lig bu haftaki maç programı",
    firecrawlSearch: (opts) => {
      callOrder.push(`firecrawl:${opts.limit}:${opts.query}`);
      return Promise.resolve({
        status: "ok",
        query: opts.query,
        fetchedAtIso: "2026-11-19",
        results: [
          {
            title: "TFF — Trendyol Süper Lig Haftanın Maç Programı",
            url: "https://www.tff.org/default.aspx?pageID=198",
            description:
              "Trendyol Süper Lig 13. hafta maçları Cuma, Cumartesi ve Pazar oynanacak.",
            publishedDate: "2026-11-19",
            fencedMarkdown: "<untrusted_content>TFF</untrusted_content>",
          },
          {
            title: "beIN SPORTS — Süper Lig Fikstür",
            url: "https://beinsports.com.tr/lig/super-lig/fikstur",
            description: "Bu haftanın canlı yayın programı ve maç saatleri.",
            publishedDate: "2026-11-19",
            fencedMarkdown: "<untrusted_content>beIN</untrusted_content>",
          },
        ],
      });
    },
    groundedSearch: () => {
      callOrder.push("vertex");
      return Promise.reject(new Error("should not be called"));
    },
    fetchImpl: (() => {
      callOrder.push("ddg");
      return Promise.reject(new Error("should not be called"));
    }) as typeof fetch,
  });

  assert.equal(res.status, "ok");
  assert.deepEqual(callOrder, [
    "firecrawl:5:Süper Lig bu haftaki maç programı",
  ]);
  assert.equal(res.sources.length, 2);
  assert.equal(
    res.sources[0]?.url,
    "https://www.tff.org/default.aspx?pageID=198"
  );
  assert.match(res.sources[0]?.snippet ?? "", /Trendyol Süper Lig/);
  assert.match(res.summary, /<untrusted_content source="webSearch"/);
  assert.match(res.summary, /TFF — Trendyol Süper Lig/);
});

test("runServerWebSearch falls back Firecrawl failure -> Vertex Hydrogen 429 -> Vertex Neon ok", async () => {
  const calls: string[] = [];
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const res = await runServerWebSearch({
      query: "Süper Lig bu haftaki maç programı",
      firecrawlSearch: () => {
        calls.push("firecrawl");
        return Promise.resolve({
          status: "error",
          message: "Firecrawl search returned HTTP 402.",
        });
      },
      groundedSearch: ({ modelId, prompt, timeoutMs }) => {
        calls.push(`vertex:${modelId}:${timeoutMs}`);
        assert.match(prompt, /Answer ONLY about the exact subject/i);
        assert.match(prompt, /Süper Lig bu haftaki maç programı/);
        if (modelId === HYDROGEN) {
          return Promise.reject(
            Object.assign(new Error("vertex_http_429"), { statusCode: 429 })
          );
        }
        assert.equal(modelId, NEON);
        return Promise.resolve({
          text: "Trendyol Süper Lig 13. hafta maçları Cuma 20:00'de başlıyor.",
          sources: [
            {
              title: "Sporx — Süper Lig Maç Programı",
              url: "https://www.sporx.com/super-lig-fikstur",
            },
          ],
        });
      },
      fetchImpl: (() => {
        calls.push("ddg");
        return Promise.reject(new Error("should not reach DDG"));
      }) as typeof fetch,
    });

    assert.equal(res.status, "ok");
    assert.deepEqual(calls, [
      "firecrawl",
      `vertex:${HYDROGEN}:12000`,
      `vertex:${NEON}:12000`,
    ]);
    assert.equal(res.sources.length, 1);
    assert.equal(
      res.sources[0]?.url,
      "https://www.sporx.com/super-lig-fikstur"
    );
    assert.match(res.summary, /<untrusted_content source="webSearch"/);
    assert.ok(
      warnings.some(
        (w) =>
          w.includes("[web-search] provider failed") &&
          w.includes("firecrawl") &&
          w.includes("HTTP 402")
      ),
      `Expected firecrawl warning, got: ${warnings.join(" | ")}`
    );
    assert.ok(
      warnings.some(
        (w) =>
          w.includes("[web-search] provider failed") &&
          w.includes("vertex hydrogen") &&
          w.includes("429")
      ),
      `Expected hydrogen 429 warning, got: ${warnings.join(" | ")}`
    );
  } finally {
    console.warn = origWarn;
  }
});

test("runServerWebSearch returns status 'error' with reason when all providers fail, and voice webSearch card maps to kind 'error'", async () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const failingDeps = {
      firecrawlSearch: () =>
        Promise.resolve({
          status: "error" as const,
          message: "Firecrawl search returned HTTP 402.",
        }),
      groundedSearch: ({
        modelId,
      }: {
        modelId: typeof HYDROGEN | typeof NEON;
      }) => {
        if (modelId === HYDROGEN) {
          return Promise.reject(
            Object.assign(new Error("Too Many Requests"), { statusCode: 429 })
          );
        }
        return Promise.reject(
          Object.assign(new Error("The operation timed out"), {
            name: "TimeoutError",
          })
        );
      },
      fetchImpl: (() =>
        Promise.resolve(
          new Response("Service Unavailable", { status: 503 })
        )) as typeof fetch,
    };

    const res = await runServerWebSearch({
      query: "Süper Lig bu haftaki maç programı",
      ...failingDeps,
    });
    assert.equal(res.status, "error");
    assert.ok(res.reason, "error status must include a non-secret reason");
    assert.match(res.reason, /firecrawl: HTTP 402/);
    assert.match(res.reason, /vertex hydrogen: 429/);
    assert.match(res.reason, /vertex neon: timeout/);
    assert.match(res.reason, /duckduckgo: HTTP 503/);

    // Production outage case: Firecrawl + Vertex Hydrogen + Vertex Neon all fail
    // while DuckDuckGo Instant Answer returns HTTP 200 empty JSON -> still "error".
    const prodLikeRes = await runServerWebSearch({
      query: "Süper Lig bu haftaki maç programı",
      firecrawlSearch: failingDeps.firecrawlSearch,
      groundedSearch: failingDeps.groundedSearch,
      fetchImpl: (() =>
        Promise.resolve(
          Response.json({ AbstractText: "", RelatedTopics: [] })
        )) as typeof fetch,
    });
    assert.equal(prodLikeRes.status, "error");
    assert.match(
      prodLikeRes.reason ?? "",
      /firecrawl: HTTP 402; vertex hydrogen: 429; vertex neon: timeout/
    );

    // Voice tool execution surfaces searchUnavailable: true -> webSearchView kind "error"
    const voiceOutcome = await executeSharedVoiceToolCall({
      session: fakeSession,
      userId: fakeSession.user.id,
      timeZone: "Europe/London",
      homeLocation: null,
      toolCallId: "tc-search-fail",
      toolName: "webSearch",
      args: { query: "Süper Lig bu haftaki maç programı" },
      ...failingDeps,
    });

    assert.equal(voiceOutcome.blocked, false);
    assert.equal(voiceOutcome.voiceResult.status, "error");
    assert.match(
      String(voiceOutcome.voiceResult.spokenInstruction ?? ""),
      /failed|retry/i
    );
    assert.match(
      String(voiceOutcome.voiceResult.spokenInstruction ?? ""),
      /never answer about a different/i
    );
    const out = voiceOutcome.toolPart.output as {
      results?: unknown[];
      searchUnavailable?: boolean;
      reason?: string;
    };
    assert.deepEqual(out.results, []);
    assert.equal(out.searchUnavailable, true);
    assert.ok(out.reason && out.reason.length > 0);
    assert.deepEqual(webSearchView(voiceOutcome.toolPart.output), {
      kind: "error",
    });

    assert.ok(
      warnings.some((w) => w.includes("[web-search] provider failed")),
      "Provider failures must emit [web-search] provider failed warnings"
    );
  } finally {
    console.warn = origWarn;
  }
});

test("runServerWebSearch returns status 'empty' (not 'error') when providers succeed cleanly with 0 results", async () => {
  const res = await runServerWebSearch({
    query: "xyzzy-nonexistent-query-20261119",
    firecrawlSearch: ({ query }) =>
      Promise.resolve({
        status: "ok",
        query,
        fetchedAtIso: "2026-11-19",
        results: [],
      }),
    groundedSearch: () => Promise.resolve({ text: "", sources: [] }),
    fetchImpl: (() =>
      Promise.resolve(
        Response.json({ AbstractText: "", RelatedTopics: [] })
      )) as typeof fetch,
  });

  assert.equal(res.status, "empty");
  assert.deepEqual(res.sources, []);
  assert.equal(res.reason, undefined);
});

test("runServerWebSearch blocks employer/Korn Ferry queries BEFORE calling any search provider", async () => {
  let providerCalls = 0;
  const res = await runServerWebSearch({
    query: "Korn Ferry MENA SA90 trial balance",
    firecrawlSearch: () => {
      providerCalls += 1;
      return Promise.reject(new Error("must not call firecrawl"));
    },
    groundedSearch: () => {
      providerCalls += 1;
      return Promise.reject(new Error("must not call vertex"));
    },
    fetchImpl: (() => {
      providerCalls += 1;
      return Promise.reject(new Error("must not call ddg"));
    }) as typeof fetch,
  });

  assert.equal(res.status, "blocked_data_boundary");
  assert.equal(providerCalls, 0);
  assert.deepEqual(res.sources, []);
});

test("runFirecrawlSearch parses both legacy array data:[...] and newer object data:{ web:[...], news:[...] }", async () => {
  const arrayRes = await runFirecrawlSearch({
    query: "Süper Lig bu haftaki maç programı",
    apiKey: "test-key",
    fetchImpl: ((input) => {
      assert.match(String(input), /https:\/\/api\.firecrawl\.dev\/v1\/search$/);
      return Promise.resolve(
        Response.json({
          success: true,
          data: [
            {
              title: "TFF Süper Lig",
              url: "https://www.tff.org/super-lig",
              description: "13. hafta programı",
            },
          ],
        })
      );
    }) as typeof fetch,
  });

  assert.equal(arrayRes.status, "ok");
  if (arrayRes.status === "ok") {
    assert.equal(arrayRes.results.length, 1);
    assert.equal(arrayRes.results[0]?.title, "TFF Süper Lig");
    assert.equal(arrayRes.results[0]?.url, "https://www.tff.org/super-lig");
    assert.equal(arrayRes.results[0]?.description, "13. hafta programı");
  }

  const objectRes = await runFirecrawlSearch({
    query: "Süper Lig bu haftaki maç programı",
    apiKey: "test-key",
    fetchImpl: (() =>
      Promise.resolve(
        Response.json({
          success: true,
          data: {
            web: [
              {
                title: "beIN SPORTS Süper Lig",
                url: "https://beinsports.com.tr/super-lig",
                description: "Haftanın maçları ve yayın saatleri",
              },
            ],
            news: [
              {
                title: "beIN SPORTS duplicate",
                url: "https://beinsports.com.tr/super-lig",
                snippet: "Duplicate URL should be deduped",
              },
              {
                title: "Sporx Haftalık Fikstür",
                url: "https://www.sporx.com/super-lig",
                snippet: "Süper Lig'de derbi heyecanı",
              },
            ],
          },
        })
      )) as typeof fetch,
  });

  assert.equal(objectRes.status, "ok");
  if (objectRes.status === "ok") {
    assert.equal(objectRes.results.length, 2);
    assert.equal(
      objectRes.results[0]?.url,
      "https://beinsports.com.tr/super-lig"
    );
    assert.equal(objectRes.results[1]?.url, "https://www.sporx.com/super-lig");
    assert.equal(
      objectRes.results[1]?.description,
      "Süper Lig'de derbi heyecanı"
    );
  }
});

test("text-agent-handoff resolves the language model inside inferenceSession.run (not outside) and preserves modelOverride", async () => {
  // 1) Source-level verification: getLanguageModel must be inside inferenceSession.run(...)
  const handoffSrc = readFileSync(
    resolve(process.cwd(), "lib/voice/text-agent-handoff.ts"),
    "utf8"
  );
  const runIdx = handoffSrc.indexOf("inferenceSession.run(execution");
  const getModelIdx = handoffSrc.indexOf("getLanguageModel(HYDROGEN)");
  assert.ok(runIdx > 0, "Expected inferenceSession.run(execution, ...) call");
  assert.ok(
    getModelIdx > runIdx,
    "getLanguageModel(HYDROGEN) must be invoked inside inferenceSession.run callback, not before it"
  );

  // 2) Runtime spy: verify inferenceSession.getStore() is populated when model resolver executes
  let sawActiveStore = false;
  let requestedModelId = "";
  const makeMockModel = () =>
    new MockLanguageModelV4({
      doGenerate: () =>
        Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: "Bu hafta Süper Lig maçlarını kontrol ettim.",
            },
          ],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: mockUsage,
          warnings: [],
        }),
    });

  const spyRes = await executeVoiceTextAgentHandoff({
    session: fakeSession,
    userId: fakeSession.user.id,
    chatId: crypto.randomUUID(),
    request: "Firecrawl ile Süper Lig maç programına bak",
    locale: "tr",
    memoryStore: createInMemoryMemoryStore(),
    approvalPrefsStore: createInMemoryApprovalPreferencesStore(),
    journalStore: createInMemoryExecutionJournalStore(),
    getLanguageModelImpl: (modelId) => {
      requestedModelId = modelId;
      const store = inferenceSession.getStore();
      sawActiveStore = Boolean(store?.available.includes(HYDROGEN));
      return makeMockModel();
    },
  });

  assert.equal(requestedModelId, HYDROGEN);
  assert.equal(
    sawActiveStore,
    true,
    "inferenceSession.getStore() must be active when resolving the model"
  );
  assert.equal(spyRes.blocked, false);
  assert.match(spyRes.spokenSummary, /Süper Lig/);

  // 3) modelOverride path still works cleanly
  const overrideRes = await executeVoiceTextAgentHandoff({
    session: fakeSession,
    userId: fakeSession.user.id,
    chatId: crypto.randomUUID(),
    request: "Check my status",
    locale: "en",
    memoryStore: createInMemoryMemoryStore(),
    approvalPrefsStore: createInMemoryApprovalPreferencesStore(),
    journalStore: createInMemoryExecutionJournalStore(),
    modelOverride: makeMockModel(),
  });
  assert.equal(overrideRes.blocked, false);
  assert.equal(overrideRes.voiceResult.status, "ok");
});

test("isFillerOnlyUtterance identifies short spoken fillers and preserves real answer sentences", () => {
  // True for spoken filler phrases and all CLIENT_FILLERS values
  for (const filler of [
    "Maç programını kontrol ediyorum...",
    "Maç programını kontrol ediyorum.",
    "Web'de arıyorum…",
    "Checking that now…",
    "Kontrol ediyorum…",
    "Hemen Süper Lig fikstürüne bakıyorum...",
    "Let me check that for you...",
    "Searching the web for that...",
    ...Object.values(CLIENT_FILLERS_EN),
    ...Object.values(CLIENT_FILLERS_TR),
  ]) {
    assert.equal(
      isFillerOnlyUtterance(filler),
      true,
      `Expected filler=true for: ${filler}`
    );
  }

  // False for real answers, questions, empty text, and long sentences
  for (const real of [
    "",
    "   ",
    "Bu hafta Süper Lig'de Galatasaray Pazar saat 19:00'da Fenerbahçe ile oynuyor.",
    "Galatasaray faces Fenerbahçe on Sunday at 19:00 in the Süper Lig.",
    "I finished checking your inbox and you have 3 unread messages from Ali.",
    "Checking accounts usually have lower interest rates than savings accounts.",
    "We are looking forward to seeing you on Friday evening...",
    "Web araması şu an başarısız oldu, tekrar denememi ister misin?",
    "I am checking the fixtures right now and I can already tell you that the weekend starts on Friday night with two matches in Istanbul and Ankara.",
  ]) {
    assert.equal(
      isFillerOnlyUtterance(real),
      false,
      `Expected filler=false for: ${real}`
    );
  }
});

test("live-protocol webSearch declaration and live-session instructions enforce keeping exact subject and never switching leagues", () => {
  const webSearchDecl = LIVE_VOICE_TOOL_DECLARATIONS.find(
    (t) => t.name === "webSearch"
  );
  assert.ok(
    webSearchDecl,
    "webSearch must be declared in LIVE_VOICE_TOOL_DECLARATIONS"
  );
  assert.match(webSearchDecl.description, /exact subject/i);
  assert.match(webSearchDecl.description, /Süper Lig/);
  assert.match(webSearchDecl.description, /user's language/i);

  const queryProp = webSearchDecl.parameters.properties.query as
    | { description?: string }
    | undefined;
  assert.match(queryProp?.description ?? "", /Süper Lig/);

  const instructions = buildVoiceSystemInstruction({
    ownerName: "Çağlar",
    timeZone: "Europe/London",
  });
  assert.match(instructions, /Süper Lig/);
  assert.match(instructions, /getFixtures is only for a single club/i);
  assert.match(instructions, /different league/i);
  assert.match(instructions, /offer to retry/i);
  assert.match(instructions, /never substitute another topic/i);
});
