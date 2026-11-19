import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { isStepCount, streamText, toUIMessageStream } from "ai";
import { selectToolsWithRanking } from "../../lib/ai/context/select-tools";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  ESCALATED_RESEARCH_MODEL,
  FALLBACK_CHAT_MODEL,
  getModelDisplayName,
} from "../../lib/ai/models";
import { createMultiSearchRecoveryStream } from "../../lib/ai/multi-search-fallback";
import {
  COPILOT_HAIKU,
  HYDROGEN,
  NEON,
  premiumModels,
} from "../../lib/ai/routing/catalog";
import { createUsageLedger } from "../../lib/ai/routing/ledger";
import { createRoutedModel } from "../../lib/ai/routing/model";
import {
  type InferenceSession,
  inferenceSession,
} from "../../lib/ai/routing/session";
import { createExcalidrawDiagramTool } from "../../lib/ai/tools/excalidraw-diagram";
import { createFirecrawlTools } from "../../lib/ai/tools/firecrawl";
import {
  createMemoryTools,
  createMemoryTurnState,
  dedupeAssistantMemoryParts,
  dedupeTurnMemoryCardsAcrossMessages,
} from "../../lib/ai/tools/memory-tools";
import { createVisualStudioTools } from "../../lib/ai/tools/visual-studio";
import {
  buildVertexRequestBody,
  createVertexGeminiAdapter,
  resolveVertexLocation,
} from "../../lib/ai/vertex-model";
import { resetParitySchemaStateForTests } from "../../lib/db/ensure-parity-schema";
import { createInMemoryPrivateFileStore } from "../../lib/files/store";
import {
  areMemoryFactsSemanticallyEquivalent,
  buildGroupedMemoryPromptBlock,
  extractExplicitRememberFact,
} from "../../lib/memory/bulk-import";
import {
  createInMemoryMemoryStore,
  createPostgresMemoryStore,
} from "../../lib/memory/store";
import type { ChatMessage } from "../../lib/types";
import { uiCopy, validateBilingualDictionary } from "../../lib/ui-copy";

const ROOT = resolve(import.meta.dirname, "../..");

function assertStrictVertexV1RequestBody(body: Record<string, unknown>): void {
  const fail = (msg: string): never => {
    throw Object.assign(new Error(msg), {
      name: "VertexHttpError",
      statusCode: 400,
      code: "INVALID_ARGUMENT",
    });
  };

  // 1. Validate functionDeclarations schemas are strictly Vertex `/v1/` safe
  const tools = (body.tools as Record<string, unknown>[] | undefined) ?? [];
  for (const toolEntry of tools) {
    const decls =
      (toolEntry.functionDeclarations as
        | Record<string, unknown>[]
        | undefined) ?? [];
    for (const decl of decls) {
      const schemaStr = JSON.stringify(decl.parametersJsonSchema ?? {});
      for (const forbidden of [
        '"anyOf"',
        '"oneOf"',
        '"allOf"',
        '"$schema"',
        '"default"',
        '"additionalProperties":true',
        '"additionalProperties":{}',
      ]) {
        if (schemaStr.includes(forbidden)) {
          fail(
            `Tool ${String(decl.name)} parametersJsonSchema contains forbidden Vertex keyword ${forbidden}: ${schemaStr}`
          );
        }
      }
    }
  }

  // 2. Validate contents: strict alternating roles, NO `id` in functionCall / functionResponse,
  //    every functionCall step answered by matching functionResponse count, and thoughtSignature
  //    present whenever thinkingConfig is active.
  const contents =
    (body.contents as {
      role: string;
      parts: Record<string, unknown>[];
    }[]) ?? [];
  const genCfg = (body.generationConfig as Record<string, unknown>) ?? {};
  const thinkingActive = Boolean(genCfg.thinkingConfig);

  let prevRole = "";
  for (let i = 0; i < contents.length; i += 1) {
    const entry = contents[i];
    if (!entry) {
      fail(`contents[${i}] missing`);
    }
    if (entry.role === prevRole) {
      fail(
        `Vertex /v1/ requires alternating roles, saw consecutive "${entry.role}" at contents[${i}]`
      );
    }
    prevRole = entry.role;

    let fnCallsInTurn = 0;
    for (const part of entry.parts) {
      if (part.functionCall) {
        fnCallsInTurn += 1;
        const fc = part.functionCall as Record<string, unknown>;
        if ("id" in fc) {
          fail(
            `Vertex /v1/ rejects functionCall.id with 400 INVALID_ARGUMENT: ${JSON.stringify(fc)}`
          );
        }
        if (
          thinkingActive &&
          !(
            typeof part.thoughtSignature === "string" &&
            part.thoughtSignature.length > 0
          )
        ) {
          fail(
            `Vertex /v1/ with thinkingConfig requires thoughtSignature on functionCall: ${JSON.stringify(part)}`
          );
        }
      }
      if (part.functionResponse) {
        const fr = part.functionResponse as Record<string, unknown>;
        if ("id" in fr) {
          fail(
            `Vertex /v1/ rejects functionResponse.id with 400 INVALID_ARGUMENT: ${JSON.stringify(fr)}`
          );
        }
      }
    }

    if (fnCallsInTurn > 0) {
      const nextEntry = contents[i + 1];
      if (!nextEntry || nextEntry.role !== "user") {
        fail(
          `Vertex /v1/ requires user functionResponse turn immediately after model functionCall at contents[${i}]`
        );
      }
      const fnResponses = nextEntry.parts.filter((p) =>
        Boolean(p.functionResponse)
      ).length;
      if (fnResponses !== fnCallsInTurn) {
        fail(
          `Vertex /v1/ requires functionResponse count (${fnResponses}) === functionCall count (${fnCallsInTurn})`
        );
      }
    }
  }
}

function makeSseResponse(frames: unknown[]): Promise<Response> {
  const sseText = `${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("")}data: [DONE]\n\n`;
  return Promise.resolve(
    new Response(sseText, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  );
}

async function drainUiChunks<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    out.push(value);
  }
  return out;
}

test("Fix 1a: buildHtmlPageOrDashboard completes full tool call + Step-2 follow-up turn on first attempt (no functionCall.id 400, split SSE thoughtSignature preserved, duplicate visual call deduped)", async () => {
  const capturedBodies: Record<string, unknown>[] = [];
  let vertexCalls = 0;

  const vertexAdapter = createVertexGeminiAdapter(HYDROGEN, {
    projectId: "proj-test",
    getAccessToken: () => Promise.resolve("tok-test"),
    fetcher: ((_url, init) => {
      vertexCalls += 1;
      const parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      assertStrictVertexV1RequestBody(parsedBody);
      capturedBodies.push(parsedBody);

      if (vertexCalls === 1) {
        // Chunk 1 emits functionCall (even with raw object optionJson + a duplicate 2nd call),
        // Chunk 2 emits trailing thoughtSignature + finishReason STOP.
        return makeSseResponse([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "buildHtmlPageOrDashboard",
                        args: {
                          filename: "aylik_ozet.html",
                          title: "Aylık Gelir Özeti",
                          kpis: [
                            {
                              label: "Toplam Gelir",
                              value: "₺420B",
                              delta: "+12%",
                              tone: "positive",
                            },
                          ],
                          charts: [
                            {
                              title: "Çeyreklik Trend",
                              optionJson: {
                                xAxis: {
                                  type: "category",
                                  data: ["Ç1", "Ç2", "Ç3"],
                                },
                                yAxis: { type: "value" },
                                series: [
                                  { type: "bar", data: [110, 145, 165] },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    },
                    {
                      functionCall: {
                        name: "buildHtmlPageOrDashboard",
                        args: {
                          title: "Duplicate Broken Second Call",
                          charts: [{ title: "Bad", optionJson: "{bad" }],
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "", thoughtSignature: "sig-html-step1" }],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
          },
        ]);
      }

      return makeSseResponse([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "Aylık gelir gösterge panelini hazırladım; kart üzerinden tam ekran açabilir veya HTML dosyasını indirebilirsin.",
                    thoughtSignature: "sig-html-step2",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 180, candidatesTokenCount: 28 },
        },
      ]);
    }) as typeof fetch,
  });

  const session: InferenceSession = {
    ledger: createUsageLedger("owner-1", "req-hotfix-2"),
    available: [HYDROGEN],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
  };

  const visualTools = createVisualStudioTools({
    userId: "owner-1",
    fileStore: createInMemoryPrivateFileStore({
      secret: "test-encryption-secret-with-32-chars",
    }),
    signingSecret: "test-signing-secret-with-at-least-32-chars",
  });

  const chunks = await inferenceSession.run(session, () => {
    const model = createRoutedModel(HYDROGEN, session, () => vertexAdapter);
    const result = streamText({
      model,
      prompt: "Bana aylık gelir özeti için bir HTML dashboard hazırla.",
      tools: {
        buildHtmlPageOrDashboard: visualTools.buildHtmlPageOrDashboard,
      },
      stopWhen: isStepCount(4),
      maxRetries: 0,
    });
    return drainUiChunks(
      toUIMessageStream({ stream: result.stream }).pipeThrough(
        createMultiSearchRecoveryStream({
          userText: "Bana aylık gelir özeti için bir HTML dashboard hazırla.",
        })
      )
    );
  });

  assert.equal(vertexCalls, 2, "Expected Step 1 tool call + Step 2 text reply");
  const toolOutputs = chunks.filter((c) => c.type === "tool-output-available");
  const toolErrors = chunks.filter(
    (c) => c.type === "tool-output-error" || c.type === "error"
  );
  assert.equal(toolOutputs.length, 1, "Expected exactly 1 HTML dashboard card");
  assert.equal(
    toolErrors.length,
    0,
    "Expected zero tool-error or stream-error"
  );
  const cardPayload = (toolOutputs[0] as { output: Record<string, unknown> })
    .output;
  assert.equal(cardPayload.status, "ok");
  assert.equal(cardPayload.kind, "html_dashboard");
  assert.ok(String(cardPayload.downloadUrl).startsWith("/api/files/"));
  assert.ok(String(cardPayload.textPreview).includes("<!doctype html>"));

  // Verify Step-2 request sent compact toModelOutput (no 48KB raw HTML textPreview)
  const step2BodyJson = JSON.stringify(capturedBodies[1]);
  assert.equal(step2BodyJson.includes("<!doctype html>"), false);

  const assistantText = chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => (c as { delta: string }).delta)
    .join("");
  assert.match(assistantText, /gösterge panelini hazırladım/);
});

test("Fix 1b: createExcalidrawDiagram completes full tool call + Step-2 follow-up turn on first attempt (including upward/leftward negative-dimension arrows)", async () => {
  let vertexCalls = 0;

  const vertexAdapter = createVertexGeminiAdapter(HYDROGEN, {
    projectId: "proj-test",
    getAccessToken: () => Promise.resolve("tok-test"),
    fetcher: ((_url, init) => {
      vertexCalls += 1;
      const parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      assertStrictVertexV1RequestBody(parsedBody);

      if (vertexCalls === 1) {
        return makeSseResponse([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "createExcalidrawDiagram",
                        args: {
                          title: "Mikroservis Mimari Akışı",
                          elementsJson: [
                            {
                              id: "client",
                              type: "rectangle",
                              x: 80,
                              y: 220,
                              width: 160,
                              height: 72,
                              backgroundColor: "#dbeafe",
                              label: "Mobil İstemci",
                            },
                            {
                              id: "gateway",
                              type: "rectangle",
                              x: 320,
                              y: 120,
                              width: 180,
                              height: 72,
                              backgroundColor: "#dcfce7",
                              label: "API Gateway",
                            },
                            {
                              id: "arr1",
                              type: "arrow",
                              x: 240,
                              y: 240,
                              width: 80,
                              height: -84,
                              points: [
                                [0, 0],
                                [80, -84],
                              ],
                              startBinding: "client",
                              endBinding: "gateway",
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "", thoughtSignature: "sig-excal-1" }],
                },
                finishReason: "STOP",
              },
            ],
          },
        ]);
      }

      return makeSseResponse([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "Mikroservis mimari diyagramını çizdim; karttan düzenleyebilir veya PNG, SVG ya da .excalidraw olarak indirebilirsin.",
                    thoughtSignature: "sig-excal-2",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      ]);
    }) as typeof fetch,
  });

  const session: InferenceSession = {
    ledger: createUsageLedger("owner-1", "req-hotfix-2"),
    available: [HYDROGEN],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
  };

  const chunks = await inferenceSession.run(session, () => {
    const model = createRoutedModel(HYDROGEN, session, () => vertexAdapter);
    const result = streamText({
      model,
      prompt: "Bana mikroservis mimarisi için bir Excalidraw diyagramı çiz.",
      tools: {
        createExcalidrawDiagram: createExcalidrawDiagramTool(),
      },
      stopWhen: isStepCount(4),
      maxRetries: 0,
    });
    return drainUiChunks(toUIMessageStream({ stream: result.stream }));
  });

  assert.equal(vertexCalls, 2);
  const toolOutputs = chunks.filter((c) => c.type === "tool-output-available");
  const errors = chunks.filter(
    (c) => c.type === "tool-output-error" || c.type === "error"
  );
  assert.equal(toolOutputs.length, 1);
  assert.equal(errors.length, 0);
  const out = (toolOutputs[0] as { output: Record<string, unknown> }).output;
  assert.equal(out.status, "ok");
  assert.equal(out.kind, "excalidraw_diagram");

  const assistantText = chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => (c as { delta: string }).delta)
    .join("");
  assert.match(assistantText, /diyagramını çizdim/);
});

test("Fix 1c: generateInfographic completes full tool call + Step-2 follow-up turn on first attempt (long Turkish bullets + compact toModelOutput)", async () => {
  const capturedBodies: Record<string, unknown>[] = [];
  let vertexCalls = 0;

  const vertexAdapter = createVertexGeminiAdapter(HYDROGEN, {
    projectId: "proj-test",
    getAccessToken: () => Promise.resolve("tok-test"),
    fetcher: ((_url, init) => {
      vertexCalls += 1;
      const parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      assertStrictVertexV1RequestBody(parsedBody);
      capturedBodies.push(parsedBody);

      if (vertexCalls === 1) {
        return makeSseResponse([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "generateInfographic",
                        args: {
                          title: "Yenilenebilir Enerji Özeti",
                          subtitle:
                            "Güneş ve rüzgar enerjisi kapasitesindeki yıllık büyüme göstergeleri ve bölgesel dağılım özeti",
                          palette: "emerald",
                          stats: [
                            {
                              label: "Güneş Kapasitesi",
                              value: "+34%",
                              caption: "Yıllık artış oranı",
                            },
                            {
                              label: "Rüzgar Payı",
                              value: "28%",
                              caption: "Toplam üretimdeki pay",
                            },
                          ],
                          sections: [
                            {
                              heading: "Öne Çıkan Gelişmeler",
                              bullets: [
                                "Şebeke ölçekli batarya depolama yatırımları sayesinde akşam zirve saatlerinde yenilenebilir enerji kullanımı belirgin biçimde arttı.",
                                "Çatı tipi güneş kurulumlarında geri dönüş süresi ortalama beş yılın altına geriledi.",
                                "Açık deniz rüzgar türbinlerinde birim maliyet düşüşü devam ediyor.",
                                "Akıllı sayaç entegrasyonu talep tarafı esnekliğini güçlendirdi.",
                                "Bölgesel iletim hatları yenilendi.",
                              ],
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "", thoughtSignature: "sig-info-1" }],
                },
                finishReason: "STOP",
              },
            ],
          },
        ]);
      }

      return makeSseResponse([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "Yenilenebilir enerji infografiğini hazırladım; yukarıdaki görsel karttan inceleyip indirebilirsin.",
                    thoughtSignature: "sig-info-2",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      ]);
    }) as typeof fetch,
  });

  const session: InferenceSession = {
    ledger: createUsageLedger("owner-1", "req-hotfix-2"),
    available: [HYDROGEN],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
  };

  const visualTools = createVisualStudioTools({
    userId: "owner-1",
    fileStore: createInMemoryPrivateFileStore({
      secret: "test-encryption-secret-with-32-chars",
    }),
    signingSecret: "test-signing-secret-with-at-least-32-chars",
  });

  const chunks = await inferenceSession.run(session, () => {
    const model = createRoutedModel(HYDROGEN, session, () => vertexAdapter);
    const result = streamText({
      model,
      prompt: "Yenilenebilir enerji hakkında bir infografik hazırla.",
      tools: {
        generateInfographic: visualTools.generateInfographic,
      },
      stopWhen: isStepCount(4),
      maxRetries: 0,
    });
    return drainUiChunks(toUIMessageStream({ stream: result.stream }));
  });

  assert.equal(vertexCalls, 2);
  const toolOutputs = chunks.filter((c) => c.type === "tool-output-available");
  const errors = chunks.filter(
    (c) => c.type === "tool-output-error" || c.type === "error"
  );
  assert.equal(toolOutputs.length, 1);
  assert.equal(errors.length, 0);
  const out = (toolOutputs[0] as { output: Record<string, unknown> }).output;
  assert.equal(out.status, "ok");
  assert.equal(out.kind, "infographic");
  assert.ok(String(out.downloadUrl).includes("/api/files/"));

  // Step-2 request body must NOT inline base64 SVG/PNG data
  assert.equal(
    JSON.stringify(capturedBodies[1]).includes("data:image/"),
    false
  );

  const assistantText = chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => (c as { delta: string }).delta)
    .join("");
  assert.match(assistantText, /infografiğini hazırladım/);
});

test("Fix 1d: buildVertexRequestBody handles error-json / tool-error parts and omits thinkingConfig when historical DB tool calls lack thoughtSignature", () => {
  const body = buildVertexRequestBody(HYDROGEN, {
    prompt: [
      {
        role: "user",
        content: [{ type: "text", text: "Draw diagram" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "hist-call-1",
            toolName: "createExcalidrawDiagram",
            input: { title: "Flow" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "hist-call-1",
            toolName: "createExcalidrawDiagram",
            output: {
              type: "error-json",
              value: { message: "Missing elementsJson" },
            },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Try again with 2 boxes" }],
      },
    ],
  });

  assertStrictVertexV1RequestBody(body);
  const genCfg = body.generationConfig as Record<string, unknown>;
  assert.equal(
    "thinkingConfig" in genCfg,
    false,
    "Historical unsigned functionCall must omit thinkingConfig so Vertex /v1/ never returns 400"
  );
});

test("Fix 2: Firecrawl prompt ('firecrawl ile https://example.com sayfasını oku') without FIRECRAWL_API_KEY completes cleanly with Turkish 'Firecrawl bağlı değil' + /setup#setup-firecrawl and Vertex-safe schemas", async () => {
  const userPrompt = "firecrawl ile https://example.com sayfasını oku";
  const uiMsg: ChatMessage = {
    id: "u-fc-1",
    role: "user",
    parts: [{ type: "text", text: userPrompt }],
  };
  const selected = selectToolsWithRanking([uiMsg], true, true);
  assert.equal(
    selected.activeTools[0],
    "firecrawlScrape",
    "URL read prompt naming Firecrawl must prioritize firecrawlScrape"
  );
  assert.equal(
    selected.activeTools.includes("cloudBrowseUrl"),
    false,
    "Explicit Firecrawl request must not attach cloudBrowseUrl"
  );

  const firecrawlTools = createFirecrawlTools({ apiKey: "" });
  let vertexCalls = 0;

  const vertexAdapter = createVertexGeminiAdapter(HYDROGEN, {
    projectId: "proj-test",
    getAccessToken: () => Promise.resolve("tok-test"),
    fetcher: ((_url, init) => {
      vertexCalls += 1;
      const parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      assertStrictVertexV1RequestBody(parsedBody);

      if (vertexCalls === 1) {
        return makeSseResponse([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "firecrawlScrape",
                        args: { url: "https://example.com" },
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "", thoughtSignature: "sig-fc-1" }],
                },
                finishReason: "STOP",
              },
            ],
          },
        ]);
      }

      // Inspect Step-2 functionResponse to confirm setup_required guidance arrived cleanly
      const contents = parsedBody.contents as Array<{
        role: string;
        parts: Record<string, unknown>[];
      }>;
      const fnResp = contents[2]?.parts[0]?.functionResponse as {
        name: string;
        response: Record<string, unknown>;
      };
      assert.equal(fnResp.name, "firecrawlScrape");
      assert.equal(fnResp.response.status, "setup_required");
      assert.equal(fnResp.response.setupHref, "/setup#setup-firecrawl");

      return makeSseResponse([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "Firecrawl bağlı değil çünkü FIRECRAWL_API_KEY henüz eklenmemiş. Kurulum sayfasındaki Bağla adımından (/setup#setup-firecrawl) API anahtarını ekleyebilirsin.",
                    thoughtSignature: "sig-fc-2",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      ]);
    }) as typeof fetch,
  });

  const session: InferenceSession = {
    ledger: createUsageLedger("owner-1", "req-hotfix-2"),
    available: [HYDROGEN, COPILOT_HAIKU],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
  };

  let copilotCalled = false;
  const chunks = await inferenceSession.run(session, () => {
    const model = createRoutedModel(HYDROGEN, session, (id) => {
      if (id === COPILOT_HAIKU) {
        copilotCalled = true;
        throw new Error("Copilot VM sleeping");
      }
      return vertexAdapter;
    });
    const result = streamText({
      model,
      prompt: userPrompt,
      tools: firecrawlTools,
      stopWhen: isStepCount(4),
      maxRetries: 0,
    });
    return drainUiChunks(
      toUIMessageStream({ stream: result.stream }).pipeThrough(
        createMultiSearchRecoveryStream({ userText: userPrompt })
      )
    );
  });

  assert.equal(vertexCalls, 2);
  assert.equal(
    copilotCalled,
    false,
    "Step 2 must succeed directly on Vertex without falling back to sleeping Copilot VM"
  );
  const errors = chunks.filter(
    (c) => c.type === "error" || c.type === "tool-output-error"
  );
  assert.equal(errors.length, 0);

  const replyText = chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => (c as { delta: string }).delta)
    .join("");
  assert.match(replyText, /Firecrawl bağlı değil/i);
  assert.match(replyText, /\/setup#setup-firecrawl/);

  // Also verify post-tool safety net if Step 2 ever drops on network timeout:
  // the turn STILL replies with "Firecrawl bağlı değil" + /setup#setup-firecrawl instead of failing!
  const recoveryStream = new ReadableStream({
    start(controller) {
      controller.enqueue({
        type: "tool-input-available",
        toolCallId: "fc-drop-1",
        toolName: "firecrawlScrape",
        input: { url: "https://example.com" },
      });
      controller.enqueue({
        type: "tool-output-available",
        toolCallId: "fc-drop-1",
        output: {
          status: "setup_required",
          connected: false,
          connectProvider: "firecrawl",
          setupHref: "/setup#setup-firecrawl",
        },
      });
      controller.enqueue({
        type: "error",
        errorText: "vertex_timeout",
      });
      controller.close();
    },
  }).pipeThrough(createMultiSearchRecoveryStream({ userText: userPrompt }));

  const recoveredChunks = await drainUiChunks(recoveryStream);
  assert.equal(
    recoveredChunks.some((c) => c.type === "error"),
    false,
    "Post-tool recovery must suppress Step-2 error when setup_required card already completed"
  );
  const recoveredText = recoveredChunks
    .filter((c) => c.type === "text-delta")
    .map((c) => (c as { delta: string }).delta)
    .join("");
  assert.match(recoveredText, /Firecrawl bağlı değil/);
  assert.match(recoveredText, /\/setup#setup-firecrawl/);
});

test("Fix 3: Memory 'Bunu hatırla: en sevdiğim renk orman yeşili.' + 'Çağlar'ın en sevdiği renk orman yeşili.' dedupes semantically to 1 stored item & 1 card without 'zaten not etmiştim'", async () => {
  // 1. Semantic equivalence across 1st-person & 3rd-person Turkish/English phrasings
  const explicitParsed = extractExplicitRememberFact(
    "Bunu hatırla: en sevdiğim renk orman yeşili."
  );
  assert.ok(explicitParsed && explicitParsed.kind === "ok");
  assert.equal(explicitParsed.value, "En sevdiğim renk orman yeşili.");

  assert.equal(
    areMemoryFactsSemanticallyEquivalent(
      "En sevdiğim renk orman yeşili.",
      "Çağlar'ın en sevdiği renk orman yeşili."
    ),
    true
  );
  assert.equal(
    areMemoryFactsSemanticallyEquivalent(
      "Benim favori rengim orman yeşili.",
      "Çağlar'ın en sevdiği renk orman yeşili."
    ),
    true
  );
  assert.equal(
    areMemoryFactsSemanticallyEquivalent(
      "En sevdiğim renk orman yeşili.",
      "En sevdiğim renk lacivert."
    ),
    false,
    "Different favorite colors must NOT be treated as duplicates"
  );

  // 2. Store-level semantic dedupe with DIFFERENT keys ("en_sevdigim_renk_..." vs "favorite_color")
  const memStore = createInMemoryMemoryStore();
  const firstStored = await memStore.upsertProfileFact({
    userId: "owner-1",
    category: explicitParsed.category,
    key: explicitParsed.key,
    value: explicitParsed.value,
    source: "chat",
  });
  const secondStored = await memStore.upsertProfileFact({
    userId: "owner-1",
    category: "preferences",
    key: "favorite_color",
    value: "Çağlar'ın en sevdiği renk orman yeşili.",
    source: "voice",
  });
  assert.equal(
    secondStored.id,
    firstStored.id,
    "Second semantic variant must update existing fact in place rather than inserting a 2nd row"
  );
  const allStored = await memStore.listProfileFacts({ userId: "owner-1" });
  assert.equal(allStored.length, 1, "Expected exactly 1 stored fact");
  assert.equal(allStored[0]?.source, "chat+voice");

  // Also verify Postgres store reuses the semantic match's key on UPSERT
  resetParitySchemaStateForTests();
  const pgRows: Record<string, unknown>[] = [];
  const mockSql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join(" ");
      if (q.includes("to_regclass")) {
        return Promise.resolve([
          {
            pf: "PrivateFile",
            rt: "RoutineTrigger",
            cb: "ChatBotBinding",
            mpf: "MemoryProfileFact",
            oas: "OwnerAssistantSettings",
            rtpe: "RoutineTriggerProcessedEvent",
            mpf_legacy: false,
          },
        ]);
      }
      if (q.includes("SELECT *") && q.includes('FROM "MemoryProfileFact"')) {
        return Promise.resolve([...pgRows]);
      }
      if (q.includes('INSERT INTO "MemoryProfileFact"')) {
        const [
          id,
          userId,
          category,
          key,
          value,
          source,
          pinned,
          learnedAt,
          sharedAcrossBots,
          botSlug,
        ] = values;
        const existingIdx = pgRows.findIndex(
          (r) => r.userId === userId && r.key === key
        );
        const row = {
          id: existingIdx >= 0 ? pgRows[existingIdx]?.id : id,
          userId,
          category,
          key,
          value,
          source,
          pinned,
          learnedAt: learnedAt ?? new Date().toISOString(),
          sharedAcrossBots,
          botSlug,
          updatedAt: new Date().toISOString(),
        };
        if (existingIdx >= 0) {
          pgRows[existingIdx] = row;
        } else {
          pgRows.push(row);
        }
        return Promise.resolve([row]);
      }
      return Promise.resolve([]);
    },
    { unsafe: () => Promise.resolve() }
  ) as unknown as NonNullable<Parameters<typeof createPostgresMemoryStore>[0]>;

  const pgStore = createPostgresMemoryStore(mockSql);
  await pgStore.upsertProfileFact({
    userId: "owner-1",
    category: "about_me",
    key: explicitParsed.key,
    value: "En sevdiğim renk orman yeşili.",
    source: "chat",
  });
  await pgStore.upsertProfileFact({
    userId: "owner-1",
    category: "preferences",
    key: "caglar_fav_color",
    value: "Çağlar'ın en sevdiği renk orman yeşili.",
    source: "chat",
  });
  assert.equal(
    pgRows.length,
    1,
    "Postgres store must reuse semantic match key so ON CONFLICT updates 1 row instead of creating 2 rows"
  );

  // 3. Concurrent parallel tool calls (`Promise.all`) within a single attempt
  const singleAttemptStore = createInMemoryMemoryStore();
  const turnState = createMemoryTurnState();
  const tools = createMemoryTools({
    userId: "owner-1",
    store: singleAttemptStore,
    dedupePerTurn: true,
    turnState,
  });

  const [parallelA, parallelB] = await Promise.all([
    tools.saveProfileFact.execute?.(
      {
        category: "preferences",
        key: "renk_1",
        value: "En sevdiğim renk orman yeşili.",
      },
      { toolCallId: "mc-1", messages: [] } as never
    ),
    tools.saveProfileFact.execute?.(
      {
        category: "preferences",
        key: "favorite_color",
        value: "Çağlar'ın en sevdiği renk orman yeşili.",
      },
      { toolCallId: "mc-2", messages: [] } as never
    ),
  ]);

  const factsAfterParallel = await singleAttemptStore.listProfileFacts({
    userId: "owner-1",
  });
  assert.equal(
    factsAfterParallel.length,
    1,
    "Parallel saveProfileFact calls in one step must store exactly 1 item"
  );
  const collapsedParts = dedupeAssistantMemoryParts([
    { type: "tool-saveProfileFact", output: parallelA },
    { type: "tool-saveProfileFact", output: parallelB },
  ]);
  assert.equal(collapsedParts.length, 1, "Expected 1 memory card in parts");

  // 4. Multi-message turn dedupe (e.g. Live Voice tool message + transcript message)
  const dedupedMsgs = dedupeTurnMemoryCardsAcrossMessages([
    {
      id: "u1",
      role: "user",
      parts: [
        { type: "text", text: "Bunu hatırla: en sevdiğim renk orman yeşili." },
      ],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "tool-saveProfileFact", output: parallelA }],
    },
    {
      id: "a2",
      role: "assistant",
      parts: [
        { type: "tool-saveProfileFact", output: { saved: true } },
        { type: "text", text: "Tamamdır, belleğe kaydettim." },
      ],
    },
  ]);
  const totalMemoryCardsRendered = dedupedMsgs.flatMap((m) =>
    m.parts.filter((p) => p.type === "tool-saveProfileFact")
  );
  assert.equal(
    totalMemoryCardsRendered.length,
    1,
    "Expected at most 1 memory card across consecutive assistant messages in the same turn"
  );

  // 5. Verify route.ts excludes explicitSavedFact from historical Owner durable memory
  //    so the model does NOT think it already knew the fact beforehand ("zaten not etmiştim")
  const routeSrc = readFileSync(
    resolve(ROOT, "app/(chat)/api/chat/route.ts"),
    "utf8"
  );
  assert.match(routeSrc, /priorFactsForPrompt/);
  assert.match(routeSrc, /zaten not etmiştim/);
  const priorOnlyBlock = buildGroupedMemoryPromptBlock(
    [
      {
        id: "old-1",
        userId: "owner-1",
        category: "about_me" as const,
        key: "favorite_color",
        value: "Çağlar'ın en sevdiği renk orman yeşili.",
        source: "chat",
        pinned: true,
        learnedAt: new Date().toISOString(),
        sharedAcrossBots: true,
        updatedAt: new Date().toISOString(),
      },
    ].filter(
      (f) =>
        !areMemoryFactsSemanticallyEquivalent(
          f.value,
          "En sevdiğim renk orman yeşili."
        )
    ),
    "Bunu hatırla: en sevdiğim renk orman yeşili."
  );
  assert.equal(priorOnlyBlock, "");
});

test("Fix 4: Remaining English UI strings are in EN/TR dictionary with natural Turkish translations and wired into components", () => {
  const report = validateBilingualDictionary(
    uiCopy.en as unknown as Record<string, unknown>,
    uiCopy.tr as unknown as Record<string, unknown>
  );
  assert.deepEqual(report, {
    missingInTr: [],
    missingInEn: [],
    emptyInEn: [],
    emptyInTr: [],
    lengthMismatchKeys: [],
  });

  // Check required EN + TR pairs
  assert.equal(uiCopy.en.pageTitle, "Assistant");
  assert.equal(uiCopy.tr.pageTitle, "Asistan");
  assert.equal(uiCopy.en.accountMenu, "Account menu");
  assert.equal(uiCopy.tr.accountMenu, "Hesap menüsü");
  assert.equal(uiCopy.en.toggleSidebar, "Toggle sidebar");
  assert.equal(uiCopy.tr.toggleSidebar, "Kenar çubuğunu aç/kapat");
  assert.equal(uiCopy.en.toggleSidebarSr, "Toggle Sidebar");
  assert.equal(uiCopy.tr.toggleSidebarSr, "Kenar çubuğunu aç/kapat");
  assert.equal(uiCopy.en.chatOptions, "Chat options");
  assert.equal(uiCopy.tr.chatOptions, "Sohbet seçenekleri");
  assert.equal(uiCopy.en.liveVoiceChat, "Live voice chat");
  assert.equal(uiCopy.tr.liveVoiceChat, "Canlı sesli sohbet");
  assert.equal(uiCopy.en.chooseFile, "Choose File");
  assert.equal(uiCopy.tr.chooseFile, "Dosya seç");
  assert.equal(
    uiCopy.en.checkingChatAvailability,
    "Checking chat availability…"
  );
  assert.equal(
    uiCopy.tr.checkingChatAvailability,
    "Sohbet durumu kontrol ediliyor…"
  );
  assert.equal(uiCopy.en.chatNotReady, "Chat not ready");
  assert.equal(uiCopy.tr.chatNotReady, "Sohbet hazır değil");

  // Verify no hardcoded English strings remain in the UI components
  const checks: Array<{
    file: string;
    mustNotContain: RegExp[];
    mustContain: RegExp[];
  }> = [
    {
      file: "components/chat/sidebar-user-nav.tsx",
      mustNotContain: [/"Account menu/],
      mustContain: [/copy\.accountMenu/],
    },
    {
      file: "components/chat/chat-header.tsx",
      mustNotContain: [
        /aria-label="Toggle sidebar"/,
        /aria-label="Chat options"/,
        /aria-label="Open History"/,
      ],
      mustContain: [
        /copy\.toggleSidebar/,
        /copy\.chatOptions/,
        /copy\.openHistory/,
      ],
    },
    {
      file: "components/ui/sidebar.tsx",
      mustNotContain: [/>Toggle Sidebar</, /aria-label="Toggle Sidebar"/],
      mustContain: [/copy\.toggleSidebarSr/],
    },
    {
      file: "components/chat/voice-memo-button.tsx",
      mustNotContain: [/aria-label="Live voice chat"/],
      mustContain: [/copy\.liveVoiceChat/],
    },
    {
      file: "components/chat/multimodal-input.tsx",
      mustNotContain: [/"Checking chat availability…"/, />Chat not ready</],
      mustContain: [
        /copy\.chooseFile/,
        /copy\.checkingChatAvailability/,
        /copy\.chatNotReady/,
      ],
    },
    {
      file: "components/ui-locale-document-sync.tsx",
      mustNotContain: [],
      mustContain: [/document\.title = copy\.pageTitle/],
    },
  ];

  for (const check of checks) {
    const src = readFileSync(resolve(ROOT, check.file), "utf8");
    for (const bad of check.mustNotContain) {
      assert.doesNotMatch(
        src,
        bad,
        `${check.file} still contains hardcoded English pattern ${bad}`
      );
    }
    for (const good of check.mustContain) {
      assert.match(
        src,
        good,
        `${check.file} is missing localized dictionary reference ${good}`
      );
    }
  }
});

test("Fix 5: Gemini 4 Neon ('gemini-4-neon') replaces Argon everywhere — global location (never europe-west2), default HIGH thinking_level, MEDIUM on latency-sensitive turns, never MINIMAL or thinking_budget, @google/genai >= 2.32.0", async () => {
  // 1. Model IDs, display labels, catalog, and daily/fallback invariants
  assert.equal(DEFAULT_CHAT_MODEL, "gemini-4-hydrogen");
  assert.equal(ESCALATED_RESEARCH_MODEL, "gemini-4-neon");
  assert.equal(NEON, "gemini-4-neon");
  assert.equal(FALLBACK_CHAT_MODEL, "claude-haiku-5.5");
  assert.equal(getModelDisplayName("gemini-4-neon"), "Gemini 4 Neon");
  assert.equal("gemini-4-neon" in premiumModels, true);
  assert.equal("gemini-4-argon" in premiumModels, false);
  assert.deepEqual(
    chatModels.map((m) => m.id),
    ["gemini-4-hydrogen", "gemini-4-neon"]
  );

  // 2. @google/genai SDK version >= 2.32.0
  const genaiPkg = JSON.parse(
    readFileSync(
      resolve(ROOT, "node_modules/@google/genai/package.json"),
      "utf8"
    )
  ) as { version: string };
  const [major = 0, minor = 0] = genaiPkg.version
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  assert.equal(
    major > 2 || (major === 2 && minor >= 32),
    true,
    `Expected @google/genai >= 2.32.0, got ${genaiPkg.version}`
  );

  // 3. Location must be global (or us/eu), never europe-west2
  assert.equal(resolveVertexLocation(undefined), "global");
  assert.equal(resolveVertexLocation("global"), "global");
  assert.equal(resolveVertexLocation("us"), "us");
  assert.equal(resolveVertexLocation("eu"), "eu");
  assert.equal(
    resolveVertexLocation("europe-west2"),
    "global",
    "europe-west2 must never be used for Gemini 4 Neon"
  );

  let hitUrl = "";
  const neonAdapter = createVertexGeminiAdapter(NEON, {
    projectId: "proj-neon",
    location: "europe-west2", // must normalize to global!
    getAccessToken: () => Promise.resolve("tok"),
    fetcher: ((url) => {
      hitUrl = String(url);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Neon ready." }] },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }) as typeof fetch,
  });
  await neonAdapter.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Ping" }] }],
  });
  assert.equal(
    hitUrl,
    "https://aiplatform.googleapis.com/v1/projects/proj-neon/locations/global/publishers/google/models/gemini-4-neon:generateContent"
  );
  assert.equal(hitUrl.includes("europe-west2"), false);

  // 4. Default thinking_level is HIGH; only LOW/MEDIUM/HIGH allowed (never MINIMAL, never thinking_budget)
  const defaultNeonBody = buildVertexRequestBody(NEON, {
    prompt: [{ role: "user", content: [{ type: "text", text: "Analyze" }] }],
  });
  const defaultGenCfg = defaultNeonBody.generationConfig as {
    thinkingConfig: Record<string, unknown>;
  };
  assert.equal(defaultGenCfg.thinkingConfig.thinkingLevel, "HIGH");
  assert.equal("thinkingBudget" in defaultGenCfg.thinkingConfig, false);
  assert.equal("thinking_budget" in defaultGenCfg.thinkingConfig, false);

  for (const effort of ["minimal", "none", "low", "medium", "high"]) {
    const b = buildVertexRequestBody(NEON, {
      prompt: [{ role: "user", content: [{ type: "text", text: "Test" }] }],
      providerOptions: { openai: { reasoningEffort: effort } },
    });
    const cfg = (
      b.generationConfig as { thinkingConfig: Record<string, unknown> }
    ).thinkingConfig;
    assert.ok(
      ["LOW", "MEDIUM", "HIGH"].includes(String(cfg.thinkingLevel)),
      `Invalid thinkingLevel ${String(cfg.thinkingLevel)} for effort ${effort}`
    );
    assert.notEqual(cfg.thinkingLevel, "MINIMAL");
    assert.equal("thinkingBudget" in cfg, false);
    assert.equal("thinking_budget" in cfg, false);
  }

  // 5. Hard / research / visual turns escalate to Neon (HIGH default for analytical, MEDIUM for latency-sensitive tool turns);
  //    everyday chat stays on Hydrogen; fallback stays Copilot Haiku
  const daily = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, NEON],
    userText: "Selam, bugün nasılsın?",
    requestedTools: [],
  });
  assert.equal(daily.modelId, HYDROGEN);
  assert.equal(daily.reasoningEffort, "low");

  const hardAnalytical = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, NEON],
    userText:
      "Compare event-driven vs request-response architecture trade-offs in depth.",
    requestedTools: [],
  });
  assert.equal(hardAnalytical.modelId, NEON);
  assert.equal(hardAnalytical.reasoningEffort, "high");

  const latencySensitiveVisual = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, NEON],
    userText: "Bana satış verileri için bir HTML dashboard hazırla.",
    requestedTools: ["buildHtmlPageOrDashboard"],
  });
  assert.equal(latencySensitiveVisual.modelId, NEON);
  assert.equal(latencySensitiveVisual.reasoningEffort, "medium");

  const latencySensitiveSearch = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, NEON],
    userText: "Compare top cloud providers and current market share.",
    requestedTools: ["webSearch"],
  });
  assert.equal(latencySensitiveSearch.modelId, NEON);
  assert.equal(latencySensitiveSearch.reasoningEffort, "medium");
});
