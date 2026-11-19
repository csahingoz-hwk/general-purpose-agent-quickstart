import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { createUIMessageStream, streamText, toUIMessageStream } from "ai";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import {
  clearLiveCapabilityManifestCache,
  resolveLiveCapabilityManifest,
} from "../../lib/ai/capability-manifest";
import {
  classifyModelError,
  safeModelError,
} from "../../lib/ai/context/errors";
import { createCopilotHaikuVmAdapter } from "../../lib/ai/copilot-vm-model";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import {
  AUTO_ROUTING_MODEL_ID,
  getLatestRoutedModelFromMessages,
  resolveModelPickerOptions,
  resolveModelPickerTriggerState,
} from "../../lib/ai/model-picker";
import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  ESCALATED_RESEARCH_MODEL,
  SYNTHETIC_SDK7_FIXTURE_MODELS,
} from "../../lib/ai/models";
import { COPILOT_HAIKU, HYDROGEN, NEON } from "../../lib/ai/routing/catalog";
import { createUsageLedger } from "../../lib/ai/routing/ledger";
import { createRoutedModel } from "../../lib/ai/routing/model";
import {
  failureKind,
  isPermanentNonRetryableError,
  ModelFailure,
  safeErrorDiagnostic,
} from "../../lib/ai/routing/policy";
import type { InferenceSession } from "../../lib/ai/routing/session";
import { createVertexGeminiAdapter } from "../../lib/ai/vertex-model";
import {
  FIRECRAWL_KEY_CREATE_URL,
  isFirecrawlConfigured,
  VERCEL_ENV_VARS_URL,
} from "../../lib/connectors/firecrawl";
import { STREAMDOWN_SAFE_REHYPE_PLUGINS } from "../../lib/markdown-stream";
import {
  buildFirecrawlChecklistItem,
  clearSetupProbesCache,
  resolveSetupStatusWithLiveEnv,
  type SetupStatusProbes,
} from "../../lib/setup-status";
import type { ChatMessage } from "../../lib/types";
import {
  formatSetupChecklistItemCopy,
  uiCopy,
  validateBilingualDictionary,
} from "../../lib/ui-copy";
import { sanitizeText, stripStrayBlockedTokens } from "../../lib/utils";

const ROOT = process.cwd();

function makeVertexOkSseResponse(text: string): Response {
  const sse = `data: ${JSON.stringify({
    candidates: [
      {
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 18, candidatesTokenCount: 9 },
  })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function makeCopilotOkSseResponse(text: string): Response {
  const sse = [
    `data: ${JSON.stringify({ type: "text-delta", delta: text })}\n\n`,
    `data: ${JSON.stringify({ type: "finish", finishReason: "stop", model: COPILOT_HAIKU })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(sse, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function makeSession(available: InferenceSession["available"]) {
  const fallbacks: Array<{
    fromModel: string;
    toModel: string;
    reason: string;
  }> = [];
  const session: InferenceSession = {
    ledger: createUsageLedger("owner-hotfix-4", `req-${crypto.randomUUID()}`),
    available,
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    onFallback: (info) => {
      fallbacks.push(info);
    },
  };
  return { session, fallbacks };
}

async function readStreamText(model: LanguageModelV4, promptText: string) {
  const { stream } = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: promptText }] }],
  });
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value.type === "text-delta") {
      text += value.delta;
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Bug 1: /setup Firecrawl card reflects live FIRECRAWL_API_KEY env presence,
// hides 2-step connect CTAs when ready, and never serves stale cached "not ready"
// ---------------------------------------------------------------------------
test("Bug 1: Firecrawl setup item reflects live FIRECRAWL_API_KEY, hides 2-step setup buttons when ready, and never serves stale cached 'optional'", async () => {
  const prevFirecrawl = process.env.FIRECRAWL_API_KEY;
  clearSetupProbesCache();
  clearLiveCapabilityManifestCache();

  try {
    const userId = "owner-bug1-cache-test";
    const fakeKey = "fc-synthetic-unit-test-key-never-expose";
    let probeCalls = 0;

    const loadProbes = (): Promise<SetupStatusProbes> => {
      probeCalls += 1;
      return Promise.resolve({
        redisReady: false,
        storedSecretNames: [],
        googleHealth: null,
        gcpBilling: null,
      });
    };

    // (b) When FIRECRAWL_API_KEY is unset -> status "optional" + 2-step instructions & buttons
    Reflect.deleteProperty(process.env, "FIRECRAWL_API_KEY");
    const unsetPayload = await resolveSetupStatusWithLiveEnv({
      userId,
      loadProbes,
      assemble: () => ({
        firecrawl: buildFirecrawlChecklistItem(isFirecrawlConfigured()),
      }),
    });
    assert.equal(probeCalls, 1);
    assert.equal(unsetPayload.firecrawl.status, "optional");
    assert.equal(unsetPayload.firecrawl.externalUrl, FIRECRAWL_KEY_CREATE_URL);
    assert.equal(
      unsetPayload.firecrawl.secondaryExternalUrl,
      VERCEL_ENV_VARS_URL
    );

    const trUnset = formatSetupChecklistItemCopy(unsetPayload.firecrawl, "tr");
    assert.match(trUnset.summary, /API anahtarı giriş alanı yoktur/);
    assert.match(trUnset.summary, /2 adımda bağlayın/);
    assert.equal(trUnset.externalLabel, uiCopy.tr.firecrawlStep1Button);
    assert.equal(
      trUnset.secondaryExternalLabel,
      uiCopy.tr.firecrawlStep2VercelButton
    );

    // (c) Set FIRECRAWL_API_KEY WITHOUT clearing cache or passing forceRefresh:
    // slow probes stay cached (probeCalls remains 1), but Firecrawl MUST immediately
    // recompute live to status "ready" (never serve stale "optional") and never leak the key!
    process.env.FIRECRAWL_API_KEY = fakeKey;
    const readyPayload = await resolveSetupStatusWithLiveEnv({
      userId,
      loadProbes,
      assemble: () => ({
        firecrawl: buildFirecrawlChecklistItem(isFirecrawlConfigured()),
      }),
    });
    assert.equal(
      probeCalls,
      1,
      "Slow async probes should reuse cache while env flags recompute live"
    );
    assert.equal(readyPayload.firecrawl.status, "ready");
    assert.equal(readyPayload.firecrawl.secondaryExternalUrl, undefined);
    assert.equal(readyPayload.firecrawl.secondaryExternalLabel, undefined);
    assert.equal(
      JSON.stringify(readyPayload).includes(fakeKey),
      false,
      "Firecrawl API key value must never appear in setup-status payload"
    );

    // (a) Turkish ready copy shows ready summary, discreet manage link, and NO 2-step setup CTA
    const trReady = formatSetupChecklistItemCopy(readyPayload.firecrawl, "tr");
    assert.equal(trReady.summary, uiCopy.tr.setupItemFirecrawlReady);
    assert.doesNotMatch(trReady.summary, /API anahtarı giriş alanı yoktur/);
    assert.equal(trReady.externalLabel, uiCopy.tr.setupItemFirecrawlManageBtn);
    assert.equal(trReady.secondaryExternalLabel, undefined);

    // Capability manifest cache also reflects live FIRECRAWL_API_KEY transitions
    Reflect.deleteProperty(process.env, "FIRECRAWL_API_KEY");
    const manifestBefore = await resolveLiveCapabilityManifest({
      userId,
      isGuest: false,
      webSearchAvailable: true,
      skipLiveProbe: true,
    });
    assert.equal(
      manifestBefore.entries.find((e) => e.id === "firecrawl")?.state,
      "not_connected"
    );

    process.env.FIRECRAWL_API_KEY = fakeKey;
    const manifestAfter = await resolveLiveCapabilityManifest({
      userId,
      isGuest: false,
      webSearchAvailable: true,
      skipLiveProbe: true,
    });
    assert.equal(
      manifestAfter.entries.find((e) => e.id === "firecrawl")?.state,
      "connected_and_healthy"
    );

    // Verify route sets Cache-Control: no-store and page hides step-2 button when ready
    const setupRouteSrc = readFileSync(
      resolve(ROOT, "app/api/setup-status/route.ts"),
      "utf8"
    );
    assert.match(setupRouteSrc, /Cache-Control.*no-store/);
    assert.match(setupRouteSrc, /resolveSetupStatusWithLiveEnv/);

    const setupPageSrc = readFileSync(
      resolve(ROOT, "app/(chat)/setup/page.tsx"),
      "utf8"
    );
    assert.match(setupPageSrc, /cache:\s*"no-store"/);
    assert.match(
      setupPageSrc,
      /item\.secondaryExternalUrl\s*&&\s*item\.status\s*!==\s*"ready"/
    );
    assert.match(setupPageSrc, /setup-badge-\$\{item\.id\}/);
  } finally {
    if (prevFirecrawl === undefined) {
      Reflect.deleteProperty(process.env, "FIRECRAWL_API_KEY");
    } else {
      process.env.FIRECRAWL_API_KEY = prevFirecrawl;
    }
    clearSetupProbesCache();
    clearLiveCapabilityManifestCache();
  }
});

// ---------------------------------------------------------------------------
// Bug 2: Transient failures (Hydrogen 429, bare wrapped Errors, empty stream)
// preserve cause diagnostics, automatically retry/fallback, and never trigger
// bogus bare-Error logs or false "tamamlanamadı" cards when recovery succeeds
// ---------------------------------------------------------------------------
test("Bug 2: Hydrogen 429 RESOURCE_EXHAUSTED falls back to Neon (and Copilot Haiku if Neon also fails) without failing the turn", async () => {
  const question = "Hangi araçların şu an çalışıyor, hangisi çalışmıyor?";

  // 1) Hydrogen 429 with [HYDROGEN, NEON] (no Copilot) -> falls back to Neon and succeeds
  {
    const { session, fallbacks } = makeSession([HYDROGEN, NEON]);
    const attempted: string[] = [];
    const routed = createRoutedModel(
      HYDROGEN,
      session,
      (id) => {
        attempted.push(id);
        return createVertexGeminiAdapter(id as typeof HYDROGEN | typeof NEON, {
          projectId: "proj-hotfix-4",
          getAccessToken: () => Promise.resolve("ya29.test"),
          fetcher: () => {
            if (id === HYDROGEN) {
              return Promise.resolve(
                new Response(
                  JSON.stringify({
                    error: { code: 429, status: "RESOURCE_EXHAUSTED" },
                  }),
                  {
                    status: 429,
                    headers: { "content-type": "application/json" },
                  }
                )
              );
            }
            return Promise.resolve(
              makeVertexOkSseResponse(
                "Şu an Vertex AI, Web Araması ve Firecrawl aktif çalışıyor."
              )
            );
          },
        });
      },
      { gateway: false, vertexSearch: true, retryDelayMs: 5 }
    );

    const text = await readStreamText(routed, question);
    assert.deepEqual(attempted, [HYDROGEN, NEON]);
    assert.equal(session.activeModelId, NEON);
    assert.equal(session.fallbackUsed, true);
    assert.equal(fallbacks.length, 1);
    assert.equal(fallbacks[0]?.fromModel, HYDROGEN);
    assert.equal(fallbacks[0]?.toModel, NEON);
    assert.equal(fallbacks[0]?.reason, "rate");
    assert.match(text, /Firecrawl aktif/);
    assert.doesNotMatch(text, /tamamlanamadı/i);
  }

  // 2) Hydrogen 429 + Neon 429 with [HYDROGEN, NEON, COPILOT_HAIKU] -> chains to Copilot Haiku and succeeds
  {
    const { session, fallbacks } = makeSession([HYDROGEN, NEON, COPILOT_HAIKU]);
    const attempted: string[] = [];
    const routed = createRoutedModel(
      HYDROGEN,
      session,
      (id) => {
        attempted.push(id);
        if (id === HYDROGEN || id === NEON) {
          return createVertexGeminiAdapter(id, {
            projectId: "proj-hotfix-4",
            getAccessToken: () => Promise.resolve("ya29.test"),
            fetcher: () =>
              Promise.resolve(
                new Response(
                  JSON.stringify({
                    error: { code: 429, status: "RESOURCE_EXHAUSTED" },
                  }),
                  {
                    status: 429,
                    headers: { "content-type": "application/json" },
                  }
                )
              ),
          });
        }
        return createCopilotHaikuVmAdapter({
          relayUrl: "https://relay.example.run.app",
          hmacSecret: "0123456789abcdef0123456789abcdef",
          copilotToken: "synthetic-unit-test-copilot-token",
          fetcher: () =>
            Promise.resolve(
              makeCopilotOkSseResponse(
                "Copilot yedek üzerinden tüm durum hazır."
              )
            ),
        });
      },
      { gateway: false, vertexSearch: true, retryDelayMs: 5 }
    );

    const text = await readStreamText(routed, question);
    assert.deepEqual(attempted, [HYDROGEN, NEON, COPILOT_HAIKU]);
    assert.equal(session.activeModelId, COPILOT_HAIKU);
    assert.equal(fallbacks.length, 2);
    assert.match(text, /Copilot yedek/);
  }
});

test("Bug 2: Bare Error wrapping a 429/transient cause preserves diagnostics, retries once on transient/empty stream, and never retries permanent 400/auth errors in a loop", async () => {
  const question = "Hangi araçların şu an çalışıyor, hangisi çalışmıyor?";

  // 1) Bare Error wrapping VertexHttpError 429 preserves statusCode/code/name/kind
  const innerVertex429 = Object.assign(new Error("vertex_http_429"), {
    name: "VertexHttpError",
    statusCode: 429,
    code: "RESOURCE_EXHAUSTED",
  });
  const wrappedBare429 = new Error("Unexpected stream failure", {
    cause: innerVertex429,
  });
  assert.equal(failureKind(wrappedBare429), "rate");
  assert.equal(classifyModelError(wrappedBare429), "rate");
  assert.deepEqual(safeErrorDiagnostic(wrappedBare429), {
    kind: "rate",
    statusCode: 429,
    code: "RESOURCE_EXHAUSTED",
    name: "VertexHttpError",
  });
  assert.match(safeModelError(wrappedBare429, question), /429/);

  // 2) Bare Error wrapping a rate failure still triggers fallback to Neon and succeeds
  {
    const { session } = makeSession([HYDROGEN, NEON]);
    const routed = createRoutedModel(
      HYDROGEN,
      session,
      (id) => {
        if (id === HYDROGEN) {
          return {
            specificationVersion: "v4",
            provider: "vertex.mock",
            modelId: HYDROGEN,
            supportedUrls: {},
            doGenerate: () => Promise.reject(wrappedBare429),
            doStream: () => Promise.reject(wrappedBare429),
          } as unknown as LanguageModelV4;
        }
        return createVertexGeminiAdapter(NEON, {
          projectId: "proj-hotfix-4",
          getAccessToken: () => Promise.resolve("ya29.test"),
          fetcher: () =>
            Promise.resolve(
              makeVertexOkSseResponse("Neon üzerinden başarıyla tamamlandı.")
            ),
        });
      },
      { gateway: false, vertexSearch: true, retryDelayMs: 5 }
    );
    const text = await readStreamText(routed, question);
    assert.equal(text, "Neon üzerinden başarıyla tamamlandı.");
    assert.equal(session.activeModelId, NEON);
  }

  // 3) Empty/aborted stream on attempt 1 automatically retries once on Hydrogen and succeeds
  {
    const { session } = makeSession([HYDROGEN]);
    let streamCalls = 0;
    const routed = createRoutedModel(
      HYDROGEN,
      session,
      () =>
        ({
          specificationVersion: "v4",
          provider: "vertex.mock",
          modelId: HYDROGEN,
          supportedUrls: {},
          doGenerate: () => Promise.reject(new Error("unused")),
          doStream: () => {
            streamCalls += 1;
            if (streamCalls === 1) {
              return Promise.resolve({
                stream: new ReadableStream<LanguageModelV4StreamPart>({
                  start(c) {
                    c.enqueue({ type: "stream-start", warnings: [] });
                    c.close();
                  },
                }),
              });
            }
            return Promise.resolve({
              stream: new ReadableStream<LanguageModelV4StreamPart>({
                start(c) {
                  c.enqueue({ type: "stream-start", warnings: [] });
                  c.enqueue({ type: "text-start", id: "t1" });
                  c.enqueue({
                    type: "text-delta",
                    id: "t1",
                    delta: "Tekrar denemede başarıyla yanıtlandı.",
                  });
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
                      outputTokens: { total: 8, text: 8, reasoning: 0 },
                    },
                  });
                  c.close();
                },
              }),
            });
          },
        }) as unknown as LanguageModelV4,
      { gateway: false, vertexSearch: true, retryDelayMs: 5 }
    );

    const text = await readStreamText(routed, question);
    assert.equal(streamCalls, 2);
    assert.equal(text, "Tekrar denemede başarıyla yanıtlandı.");
  }

  // 4) Permanent 400 INVALID_ARGUMENT / 401 auth errors NEVER retry in a loop and surface honestly
  for (const permError of [
    Object.assign(new Error("vertex_http_400"), {
      name: "VertexHttpError",
      statusCode: 400,
      code: "INVALID_ARGUMENT",
    }),
    Object.assign(new Error("vertex_http_401"), {
      name: "VertexHttpError",
      statusCode: 401,
      code: "UNAUTHENTICATED",
    }),
  ]) {
    assert.equal(isPermanentNonRetryableError(permError), true);
    const { session } = makeSession([HYDROGEN]);
    let calls = 0;
    const routed = createRoutedModel(
      HYDROGEN,
      session,
      () =>
        ({
          specificationVersion: "v4",
          provider: "vertex.mock",
          modelId: HYDROGEN,
          supportedUrls: {},
          doGenerate: () => Promise.reject(permError),
          doStream: () => {
            calls += 1;
            return Promise.reject(permError);
          },
        }) as unknown as LanguageModelV4,
      { gateway: false, vertexSearch: true, retryDelayMs: 5 }
    );

    let caught: unknown = null;
    try {
      await readStreamText(routed, question);
    } catch (err) {
      caught = err;
    }
    assert.equal(
      calls,
      1,
      `Permanent error (${permError.code}) must never retry in a loop`
    );
    assert.ok(caught instanceof ModelFailure);
    assert.equal(caught.statusCode, permError.statusCode);
    assert.equal(caught.upstreamCode, permError.code);
    const userMessage = safeModelError(caught, question);
    if (permError.statusCode === 401) {
      assert.match(userMessage, /hesap ayarları/i);
    } else {
      assert.match(userMessage, /tamamlanamadı/i);
    }
  }

  // 5) AI SDK 7 stream pipeline deduplication: never logs synthetic bare-Error echo
  const loggedPayloads: Record<string, unknown>[] = [];
  let lastLocalizedStreamError: string | null = null;
  const handleUiStreamError = (error: unknown): string => {
    if (
      error instanceof Error &&
      !(error instanceof ModelFailure) &&
      lastLocalizedStreamError !== null &&
      error.message === lastLocalizedStreamError
    ) {
      return lastLocalizedStreamError;
    }
    loggedPayloads.push({
      ...safeErrorDiagnostic(error),
      kind: failureKind(error),
    });
    const safeText = safeModelError(error, question);
    lastLocalizedStreamError = safeText;
    return safeText;
  };

  const { session: permSession } = makeSession([HYDROGEN]);
  const permRouted = createRoutedModel(
    HYDROGEN,
    permSession,
    () =>
      createVertexGeminiAdapter(HYDROGEN, {
        projectId: "proj-hotfix-4",
        getAccessToken: () => Promise.resolve("ya29.test"),
        fetcher: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: 400, status: "INVALID_ARGUMENT" },
              }),
              { status: 400, headers: { "content-type": "application/json" } }
            )
          ),
      }),
    { gateway: false, vertexSearch: true, retryDelayMs: 5 }
  );

  const uiStream = createUIMessageStream<ChatMessage>({
    execute: ({ writer }) => {
      const result = streamText({
        model: permRouted,
        prompt: question,
        maxRetries: 0,
      });
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          onEnd: () => undefined,
          onError: handleUiStreamError,
        })
      );
    },
    onEnd: () => undefined,
    onError: handleUiStreamError,
  });

  const reader = uiStream.getReader();
  const errorChunks: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value.type === "error") {
      errorChunks.push(value.errorText);
    }
  }
  assert.equal(errorChunks.length, 1);
  assert.equal(
    loggedPayloads.length,
    1,
    "Synthetic processUIMessageStream bare-Error echo must be deduplicated"
  );
  assert.equal(loggedPayloads[0]?.statusCode, 400);
  assert.equal(loggedPayloads[0]?.code, "INVALID_ARGUMENT");
  assert.equal(loggedPayloads[0]?.name, "VertexHttpError");
});

// ---------------------------------------------------------------------------
// Bug 3: Never render literal "[blocked]" while streaming or finishing sources
// ---------------------------------------------------------------------------
test("Bug 3: Streaming and completed source links never render literal '[blocked]' and still render source names and valid https links", () => {
  const fullMarkdown =
    "(Kaynak: [Anadolu Ajansı](https://www.aa.com.tr/tr/foo))";
  const streamingPrefixes = [
    "(Kaynak: [Anadolu Ajansı](",
    "(Kaynak: [Anadolu Ajansı](https://",
    "(Kaynak: [Anadolu Ajansı](https://www.aa.com.tr/tr/foo",
    fullMarkdown,
  ];

  for (const prefix of streamingPrefixes) {
    for (const linkSafetyEnabled of [true, false]) {
      const html = renderToStaticMarkup(
        React.createElement(
          Streamdown,
          {
            rehypePlugins: STREAMDOWN_SAFE_REHYPE_PLUGINS,
            linkSafety: { enabled: linkSafetyEnabled },
          },
          prefix
        )
      );
      assert.equal(
        html.includes("[blocked]"),
        false,
        `Streaming prefix must never render '[blocked]': ${prefix} -> ${html}`
      );
      assert.equal(
        html.includes("Anadolu Ajansı"),
        true,
        `Source name must remain visible during streaming: ${prefix} -> ${html}`
      );
    }
  }

  // Once complete, renders a real https link (href when linkSafety is off; non-incomplete link button when linkSafety is on)
  const completedAnchorHtml = renderToStaticMarkup(
    React.createElement(
      Streamdown,
      {
        rehypePlugins: STREAMDOWN_SAFE_REHYPE_PLUGINS,
        linkSafety: { enabled: false },
      },
      fullMarkdown
    )
  );
  assert.match(
    completedAnchorHtml,
    /href="https:\/\/www\.aa\.com\.tr\/tr\/foo"/
  );
  assert.equal(completedAnchorHtml.includes("[blocked]"), false);

  const completedSafetyHtml = renderToStaticMarkup(
    React.createElement(
      Streamdown,
      {
        rehypePlugins: STREAMDOWN_SAFE_REHYPE_PLUGINS,
        linkSafety: { enabled: true },
      },
      fullMarkdown
    )
  );
  assert.match(completedSafetyHtml, /data-incomplete="false"/);
  assert.match(completedSafetyHtml, /Anadolu Ajansı/);
  assert.equal(completedSafetyHtml.includes("[blocked]"), false);

  // Dangerous javascript: links remain neutralized as plain text without injecting "[blocked]"
  const dangerousHtml = renderToStaticMarkup(
    React.createElement(
      Streamdown,
      {
        rehypePlugins: STREAMDOWN_SAFE_REHYPE_PLUGINS,
        linkSafety: { enabled: false },
      },
      "(Kaynak: [Anadolu Ajansı](javascript:alert(1)))"
    )
  );
  assert.equal(dangerousHtml.includes("javascript:"), false);
  assert.equal(dangerousHtml.includes("[blocked]"), false);
  assert.equal(dangerousHtml.includes("Anadolu Ajansı"), true);

  // Defense-in-depth: stray literal "[blocked]" outside code blocks is stripped cleanly
  assert.equal(
    sanitizeText("(Kaynak: Anadolu Ajansı [blocked])"),
    "(Kaynak: Anadolu Ajansı)"
  );
  assert.equal(
    stripStrayBlockedTokens("Anadolu Ajansı [blocked], Reuters"),
    "Anadolu Ajansı, Reuters"
  );
  const codeBlockSample = '```ts\nconst marker = "[blocked]";\n```';
  assert.equal(stripStrayBlockedTokens(codeBlockSample), codeBlockSample);
});

// ---------------------------------------------------------------------------
// Bug 4: Composer model picker defaults to "Otomatik" (TR) / "Auto" (EN),
// reflects the routed model (Hydrogen vs Neon), and preserves Neon auto-routing
// ---------------------------------------------------------------------------
test("Bug 4: Composer model picker displays Otomatik / Auto by default, reflects routed Neon/Hydrogen after turns, and keeps Neon auto-routing intact", () => {
  // Bilingual dictionary parity
  const parity = validateBilingualDictionary(
    uiCopy.en as unknown as Record<string, unknown>,
    uiCopy.tr as unknown as Record<string, unknown>
  );
  assert.deepEqual(parity, {
    missingInTr: [],
    missingInEn: [],
    emptyInEn: [],
    emptyInTr: [],
    lengthMismatchKeys: [],
  });

  // 1) Turkish default picker options and resting trigger label
  const trOptions = resolveModelPickerOptions(chatModels, "tr");
  assert.equal(trOptions.length, 2);
  assert.equal(trOptions[0]?.id, DEFAULT_CHAT_MODEL);
  assert.equal(trOptions[0]?.name, "Otomatik");
  assert.equal(trOptions[0]?.isAuto, true);
  assert.match(trOptions[0]?.description ?? "", /Hydrogen.*Neon/i);
  assert.equal(trOptions[1]?.id, ESCALATED_RESEARCH_MODEL);
  assert.equal(trOptions[1]?.name, "Gemini 4 Neon");

  const trInitialTrigger = resolveModelPickerTriggerState({
    selectedModelId: DEFAULT_CHAT_MODEL,
    models: chatModels,
    messages: [],
    locale: "tr",
  });
  assert.equal(trInitialTrigger?.label, "Otomatik");
  assert.equal(trInitialTrigger?.isAuto, true);

  // English default picker options
  const enInitialTrigger = resolveModelPickerTriggerState({
    selectedModelId: DEFAULT_CHAT_MODEL,
    models: chatModels,
    messages: [],
    locale: "en",
  });
  assert.equal(enInitialTrigger?.label, "Auto");

  // 2) After a turn routed to Neon, picker reflects "Otomatik · Neon" (never contradicts reply badge)
  const neonTurnMessages: ChatMessage[] = [
    {
      id: "u1",
      role: "user",
      parts: [
        { type: "text", text: "Türkiye enflasyonunu araştır ve karşılaştır" },
      ],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "data-model-used",
          data: {
            modelId: NEON,
            modelName: "Gemini 4 Neon",
            isFallback: false,
            escalated: true,
          },
        },
        { type: "text", text: "Araştırma özeti..." },
      ],
    },
  ];
  assert.equal(
    getLatestRoutedModelFromMessages(neonTurnMessages)?.shortName,
    "Neon"
  );
  const trAfterNeon = resolveModelPickerTriggerState({
    selectedModelId: DEFAULT_CHAT_MODEL,
    models: chatModels,
    messages: neonTurnMessages,
    locale: "tr",
  });
  assert.equal(trAfterNeon?.label, "Otomatik · Neon");
  assert.equal(trAfterNeon?.isAuto, true);

  // After a Hydrogen turn, picker reflects "Otomatik · Hydrogen"
  const hydrogenTurnMessages: ChatMessage[] = [
    { id: "u2", role: "user", parts: [{ type: "text", text: "Merhaba" }] },
    {
      id: "a2",
      role: "assistant",
      parts: [
        {
          type: "data-model-used",
          data: {
            modelId: HYDROGEN,
            modelName: "Gemini 4 Hydrogen",
            isFallback: false,
            escalated: false,
          },
        },
        { type: "text", text: "Merhaba!" },
      ],
    },
  ];
  const trAfterHydrogen = resolveModelPickerTriggerState({
    selectedModelId: DEFAULT_CHAT_MODEL,
    models: chatModels,
    messages: hydrogenTurnMessages,
    locale: "tr",
  });
  assert.equal(trAfterHydrogen?.label, "Otomatik · Hydrogen");

  // Manual override to Neon stays "Gemini 4 Neon"
  const manualNeon = resolveModelPickerTriggerState({
    selectedModelId: ESCALATED_RESEARCH_MODEL,
    models: chatModels,
    messages: hydrogenTurnMessages,
    locale: "tr",
  });
  assert.equal(manualNeon?.label, "Gemini 4 Neon");
  assert.equal(manualNeon?.isAuto, false);

  // Non-Vertex CI fixture models preserve their exact names ("Everyday chat" / "Detailed chat")
  const fixtureModels = SYNTHETIC_SDK7_FIXTURE_MODELS.slice(2);
  const fixtureTrigger = resolveModelPickerTriggerState({
    selectedModelId: "openai/gpt-oss-120b",
    models: fixtureModels,
    messages: [],
    locale: "en",
  });
  assert.equal(fixtureTrigger?.label, "Detailed chat");

  // 3) Auto routing still selects Neon for research/hard turns on both DEFAULT_CHAT_MODEL and "auto"
  for (const selectedModelId of [DEFAULT_CHAT_MODEL, AUTO_ROUTING_MODEL_ID]) {
    const research = resolveTurnModelAndEffort({
      selectedModelId,
      availableModelIds: [HYDROGEN, NEON],
      userText:
        "Türkiye 2026 enflasyon verilerini kaynaklı araştır ve karşılaştır",
      requestedTools: ["webSearch"],
      baseEffort: "low",
    });
    assert.equal(research.modelId, NEON);
    assert.equal(research.escalated, true);

    const everyday = resolveTurnModelAndEffort({
      selectedModelId,
      availableModelIds: [HYDROGEN, NEON],
      userText: "Merhaba, bugün nasılsın?",
      requestedTools: [],
      baseEffort: "low",
    });
    assert.equal(everyday.modelId, HYDROGEN);
    assert.equal(everyday.escalated, false);
  }
});
