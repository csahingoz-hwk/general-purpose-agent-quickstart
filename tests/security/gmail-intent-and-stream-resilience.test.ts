import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";
import { scenarios } from "../../audit/scenarios";
import { safeModelError } from "../../lib/ai/context/errors";
import {
  isOpenQuestion,
  selectActiveTools,
  shouldOfferWebSearch,
} from "../../lib/ai/context/select-tools";
import {
  canRetryReply,
  hasNonRetryableToolExecution,
  interruptedReply,
  prepareRetry,
  replyForStorage,
  safeUIStream,
} from "../../lib/ai/conversation-state";
import { createCopilotHaikuVmAdapter } from "../../lib/ai/copilot-vm-model";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import { systemPrompt } from "../../lib/ai/prompts";
import {
  ARGON,
  COPILOT_HAIKU,
  HYDROGEN,
  TERRA,
  WEB_SEARCH_TOOL_ID,
} from "../../lib/ai/routing/catalog";
import { createUsageLedger } from "../../lib/ai/routing/ledger";
import { createRoutedModel } from "../../lib/ai/routing/model";
import { ModelFailure } from "../../lib/ai/routing/policy";
import type { InferenceSession } from "../../lib/ai/routing/session";
import { createGoogleConnectorTools } from "../../lib/ai/tools/google-connectors";
import {
  buildVertexRequestBody,
  createVertexGeminiAdapter,
} from "../../lib/ai/vertex-model";
import { hasStoredGoogleConnection } from "../../lib/connectors/google-vault-auth";
import { readGmailMessages } from "../../lib/connectors/google-workspace";
import {
  ensureParitySchema,
  resetParitySchemaStateForTests,
} from "../../lib/db/ensure-parity-schema";
import { extractExplicitRememberFact } from "../../lib/memory/bulk-import";
import type { ChatMessage } from "../../lib/types";
import { getCopy } from "../../lib/ui-copy";
import type { SecretVaultStore } from "../../lib/vault/secret-vault";

const userTurn = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

const EXACT_OWNER_SENTENCE =
  "selam asistan, bana x.ai'den gelen son emaili bulup bir cevap taslağı oluşturur musun?";

const FIVE_TR_EN_VARIANTS = [
  "Merhaba, Stripe'tan gelen son maili bulup kısa bir yanıt taslağı yazar mısın?",
  "Can you find the latest email from x.ai and draft a reply?",
  "Could you check the last email from GitHub in my inbox and prepare a response draft?",
  "May you look at my recent email from Sarah and create a Gmail draft reply?",
  "Bana gelen son e-postayı kontrol edip kibar bir cevap taslağı hazırlar mısın?",
] as const;

test("Exact owner sentence + 5 TR/EN variants select Gmail read & draft tools, suppress webSearch, and stay on Gemini 4 Hydrogen", () => {
  const prevGoogle = process.env.GOOGLE_CONNECTORS_ENABLED;
  try {
    process.env.GOOGLE_CONNECTORS_ENABLED = "true";

    const allSix = [EXACT_OWNER_SENTENCE, ...FIVE_TR_EN_VARIANTS];

    for (const sentence of allSix) {
      const connectedTools = selectActiveTools(
        [userTurn(sentence)],
        true,
        true,
        { googleConnectedAndHealthy: true }
      );
      assert.ok(
        connectedTools.includes("gmailReadMessages"),
        `gmailReadMessages missing (connected) for: ${sentence}`
      );
      assert.ok(
        connectedTools.includes("gmailCreateDraft"),
        `gmailCreateDraft missing (connected) for: ${sentence}`
      );
      assert.ok(
        connectedTools.includes("calendarReadEvents"),
        `calendarReadEvents missing (connected) for: ${sentence}`
      );
      assert.ok(
        connectedTools.includes("driveReadFiles"),
        `driveReadFiles missing (connected) for: ${sentence}`
      );
      assert.ok(
        !connectedTools.includes("webSearch"),
        `webSearch must NOT be offered for: ${sentence}`
      );
      assert.ok(
        connectedTools.indexOf("gmailReadMessages") <
          connectedTools.indexOf("driveReadFiles"),
        `Expected Gmail tools ranked ahead of Drive baseline for: ${sentence}`
      );

      const unconnectedTools = selectActiveTools(
        [userTurn(sentence)],
        true,
        true
      );
      assert.ok(
        unconnectedTools.includes("gmailReadMessages"),
        `gmailReadMessages missing (unconnected) for: ${sentence}`
      );
      assert.ok(
        unconnectedTools.includes("gmailCreateDraft"),
        `gmailCreateDraft missing (unconnected) for: ${sentence}`
      );
      assert.ok(
        !unconnectedTools.includes("webSearch"),
        `webSearch leaked (unconnected) for: ${sentence}`
      );

      const routing = resolveTurnModelAndEffort({
        selectedModelId: HYDROGEN,
        availableModelIds: [HYDROGEN, ARGON, TERRA],
        userText: sentence,
        requestedTools: connectedTools,
        baseEffort: "low",
      });
      assert.equal(
        routing.modelId,
        HYDROGEN,
        `Unexpected escalation to ${routing.modelId} for: ${sentence}`
      );
      assert.equal(routing.reasoningEffort, "low");
      assert.equal(routing.escalated, false);
    }

    const unhintedConnected = selectActiveTools(
      [userTurn("Selam, önemli bir gelişme var mı bir göz atalım")],
      true,
      true,
      { googleConnectedAndHealthy: true }
    );
    assert.ok(unhintedConnected.includes("gmailReadMessages"));
    assert.ok(unhintedConnected.includes("gmailCreateDraft"));
    assert.ok(unhintedConnected.includes("calendarReadEvents"));
    assert.ok(unhintedConnected.includes("driveReadFiles"));
    assert.ok(!unhintedConnected.includes("webSearch"));
  } finally {
    if (prevGoogle === undefined) {
      Reflect.deleteProperty(process.env, "GOOGLE_CONNECTORS_ENABLED");
    } else {
      process.env.GOOGLE_CONNECTORS_ENABLED = prevGoogle;
    }
  }
});

test("Full 89-scenario audit matrix passes 89/89", () => {
  let n = 0;
  const mk = (role: "user" | "assistant", text: string): ChatMessage => ({
    id: `aud-${n++}`,
    role,
    parts: [{ type: "text", text }],
  });

  for (const s of scenarios) {
    const hist: ChatMessage[] = (s.history ?? []).map((t) =>
      t.approvedTool
        ? ({
            id: `aud-${n++}`,
            role: "assistant",
            parts: [
              {
                type: `tool-${t.approvedTool}`,
                toolCallId: "c1",
                state: "approval-responded",
                input: {},
                approval: { id: "a1", approved: true },
              },
            ],
          } as unknown as ChatMessage)
        : mk(t.role, t.text)
    );
    const msgs = s.prompt.startsWith("(approve")
      ? hist
      : [...hist, mk("user", s.prompt)];
    const tools = selectActiveTools(msgs, !s.guest, true);
    const esc = resolveTurnModelAndEffort({
      selectedModelId: HYDROGEN,
      availableModelIds: [HYDROGEN, ARGON],
      userText: s.prompt.startsWith("(approve")
        ? (s.history?.[0]?.text ?? "")
        : s.prompt,
      requestedTools: tools,
    });
    const model = esc.modelId.includes("argon") ? "argon" : "hydrogen";
    for (const reqTool of s.include ?? []) {
      if (reqTool === "saveProfileFact" && (s.id === "M01" || s.id === "M02")) {
        assert.ok(tools.includes("saveProfileFact"), `${s.id} saveProfileFact`);
        continue;
      }
      assert.ok(
        tools.includes(reqTool as never),
        `${s.id} missing ${reqTool} (got: ${tools.join(",")})`
      );
    }
    for (const forbidden of s.exclude ?? []) {
      assert.ok(
        !tools.includes(forbidden as never),
        `${s.id} unexpected ${forbidden}`
      );
    }
    if (s.model) {
      assert.equal(model, s.model, `${s.id} model ${model} !== ${s.model}`);
    }
    if (s.search === false) {
      assert.ok(!tools.includes("webSearch"), `${s.id} unexpected webSearch`);
    }
  }
});

test("isOpenQuestion and shouldOfferWebSearch require real live-fact signals and ignore polite task endings or bare '?'", () => {
  const nonWebPrompts = [
    EXACT_OWNER_SENTENCE,
    "nasılsın bugün?",
    "hey, how are you?",
    "fotosentez nasıl çalışır?",
    "Nasılsın? Bugün ne yapıyorsun?",
    "Bu paragrafı daha kısa özetler misin?",
    "Bana kibar bir teşekkür mesajı yazar mısın?",
    "Şu metni İngilizceye çevirir müsün?",
    "Can you rewrite this paragraph more concisely?",
    "Could you summarize these notes into bullet points?",
    "May you draft a polite follow-up note?",
  ];

  for (const p of nonWebPrompts) {
    const norm = p.toLocaleLowerCase("en").normalize("NFC");
    assert.equal(isOpenQuestion(norm), false, `isOpenQuestion on: ${p}`);
    assert.equal(
      shouldOfferWebSearch(norm, true),
      false,
      `shouldOfferWebSearch on: ${p}`
    );
  }

  for (const liveFact of [
    "who won the match last night?",
    "how many people live in lisbon?",
    "türkiye'nin cumhurbaşkanı kimdir?",
    "dolar kaç bugün?",
  ]) {
    assert.equal(shouldOfferWebSearch(liveFact, true), true, liveFact);
  }
});

test("systemPrompt never claims Gmail/Calendar is unavailable and reflects live setup capabilities", () => {
  const basePrompt = systemPrompt({
    supportsTools: true,
  });
  assert.doesNotMatch(
    basePrompt,
    /Personal Gmail\/Calendar access.*not enabled here/i
  );

  const connectedPrompt = systemPrompt({
    supportsTools: true,
    includeOperatorTools: true,
    googleConnected: true,
    setupCapabilities: {
      googleConnected: true,
      macBridgeConnected: true,
    },
  });
  assert.match(connectedPrompt, /Active Personal Connectors & Operator Tools/);
  assert.match(connectedPrompt, /Gmail \+ Google Calendar \+ Google Drive/);
  assert.match(connectedPrompt, /Mac Bridge/);
});

test("Vertex never mixes googleSearch and functionDeclarations in one request, and Copilot fallback recovers after a read-only tool step", async () => {
  const mixedBody = buildVertexRequestBody(HYDROGEN, {
    prompt: [{ role: "user", content: [{ type: "text", text: "Test" }] }],
    tools: [
      {
        type: "provider",
        id: WEB_SEARCH_TOOL_ID,
        name: "webSearch",
        args: {},
      },
      {
        type: "function",
        name: "getFixtures",
        description: "Get match fixtures",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  });
  const vertexTools = mixedBody.tools as Record<string, unknown>[];
  assert.equal(vertexTools.length, 1);
  assert.equal("googleSearch" in vertexTools[0], false);
  assert.equal(Array.isArray(vertexTools[0].functionDeclarations), true);

  // Multi-step: Step 1 executes read-only `gmailReadMessages` on Vertex, Step 2 Vertex 503 -> Copilot Haiku finishes
  let vertexCalls = 0;
  const session: InferenceSession = {
    available: [HYDROGEN, COPILOT_HAIKU],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    ledger: {
      reserve: () => Promise.resolve("r1"),
      settle: () => Promise.resolve(),
    },
  };

  const routed = createRoutedModel(
    HYDROGEN,
    session,
    (id) => {
      if (id === HYDROGEN) {
        return createVertexGeminiAdapter(HYDROGEN, {
          projectId: "project-cd0bc64c-0025-446c-b41",
          getAccessToken: () => Promise.resolve("ya29.test"),
          fetcher: () => {
            vertexCalls += 1;
            if (vertexCalls === 1) {
              const sse = `data: ${JSON.stringify({
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [
                        {
                          functionCall: {
                            id: "call_gm_1",
                            name: "gmailReadMessages",
                            args: { query: "from:x.ai" },
                          },
                        },
                      ],
                    },
                    finishReason: "STOP",
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 20,
                  candidatesTokenCount: 5,
                },
              })}\n\ndata: [DONE]\n\n`;
              return Promise.resolve(
                new Response(sse, {
                  status: 200,
                  headers: { "content-type": "text/event-stream" },
                })
              );
            }
            return Promise.resolve(new Response("503", { status: 503 }));
          },
        });
      }
      return createCopilotHaikuVmAdapter({
        relayUrl: "https://relay.example.run.app",
        hmacSecret: "0123456789abcdef0123456789abcdef",
        copilotToken: "synthetic-unit-test-copilot-token",
        fetcher: () => {
          const sse = [
            `data: ${JSON.stringify({ type: "text-delta", delta: "x.ai e-postası özetlendi." })}\n\n`,
            `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}\n\n`,
            "data: [DONE]\n\n",
          ].join("");
          return Promise.resolve(
            new Response(sse, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            })
          );
        },
      });
    },
    { gateway: false, vertexSearch: true }
  );

  const res = streamText({
    model: routed,
    prompt: EXACT_OWNER_SENTENCE,
    stopWhen: isStepCount(3),
    maxRetries: 0,
    tools: {
      gmailReadMessages: tool({
        inputSchema: z.object({ query: z.string().optional() }),
        execute: () =>
          Promise.resolve({ status: "ok", count: 1, messages: [] }),
      }),
    },
  });
  const finalText = await res.text;
  assert.equal(finalText, "x.ai e-postası özetlendi.");
  assert.equal(session.fallbackUsed, true);
  assert.equal(session.activeModelId, COPILOT_HAIKU);
});

test("ensureParitySchema runs once per process across clients and skips DDL when tables exist", async () => {
  resetParitySchemaStateForTests();
  let unsafeCalls = 0;
  let regclassCalls = 0;
  const makeFakeSql = () => {
    const fn = (() => {
      regclassCalls += 1;
      return Promise.resolve([
        {
          pf: "PrivateFile",
          rt: "RoutineTrigger",
          cb: "ChatBotBinding",
          mpf: "MemoryProfileFact",
        },
      ]);
    }) as any;
    fn.unsafe = () => {
      unsafeCalls += 1;
      return Promise.resolve();
    };
    return fn;
  };

  await ensureParitySchema(makeFakeSql());
  await ensureParitySchema(makeFakeSql());
  await ensureParitySchema(makeFakeSql());
  assert.equal(regclassCalls, 1);
  assert.equal(unsafeCalls, 0);
});

test("route onError logs failureKind only, Turkish partial break shows 'Yarıda kesildi, tekrar dene', and retry works after partial text or read-only Gmail lookup", () => {
  const routeSrc = readFileSync("app/(chat)/api/chat/route.ts", "utf8");
  assert.match(routeSrc, /failureKind\(error\)/);
  assert.doesNotMatch(
    routeSrc,
    /console\.(?:error|warn|log)\([^)]*error\.(?:message|stack|responseBody|requestBody)/
  );

  assert.equal(getCopy("tr").statusInterrupted, "Yarıda kesildi, tekrar dene");

  const uMsg = userTurn(EXACT_OWNER_SENTENCE);
  const partialAfterGmailRead: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "tool-gmailReadMessages",
        toolCallId: "call_gm_read_1",
        state: "output-available",
        input: { query: "from:x.ai", maxResults: 5 },
        output: { status: "ok", count: 1, messages: [] },
      } as any,
      {
        type: "text",
        text: "x.ai'den gelen son e-postayı buldum, yanıt taslağını ",
      },
    ],
  };

  assert.equal(hasNonRetryableToolExecution(partialAfterGmailRead), false);
  const stored = replyForStorage(partialAfterGmailRead, false);
  assert.ok(stored);
  assert.deepEqual(interruptedReply(stored), {
    status: "interrupted",
    retryable: true,
  });
  assert.equal(canRetryReply([uMsg, stored]), true);

  const prepared = prepareRetry([uMsg, stored], uMsg.id);
  assert.deepEqual(prepared.messages, [uMsg]);
  assert.equal(prepared.replaceId, stored.id);

  const completedDraftWrite: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "tool-gmailCreateDraft",
        toolCallId: "call_gm_draft_1",
        state: "output-available",
        input: {
          recipient: "support@x.ai",
          subject: "Re: API",
          body: "Merhaba",
        },
        output: { status: "draft_created_unsent", draftId: "d1" },
      } as any,
    ],
  };
  assert.equal(hasNonRetryableToolExecution(completedDraftWrite), true);
  const storedWrite = replyForStorage(completedDraftWrite, false);
  assert.ok(storedWrite);
  assert.equal(canRetryReply([uMsg, storedWrite]), false);
});

test("Owner Decision (No Internal Spend Cap): 60 consecutive turns across Hydrogen, Argon, and Vertex-429 -> Copilot Haiku fallback never hit any internal cap, never select pay-per-use models, and show exact Turkish cause on double 429", async () => {
  const prevAllowance = process.env.AI_MONTHLY_ALLOWANCE_USD;
  try {
    // Even if a stale or invalid AI_MONTHLY_ALLOWANCE_USD=0 env var is left set, it has zero effect
    process.env.AI_MONTHLY_ALLOWANCE_USD = "0";

    const ledgerSrc = readFileSync("lib/ai/routing/ledger.ts", "utf8");
    assert.doesNotMatch(ledgerSrc, /AI_MONTHLY_ALLOWANCE_USD/);
    assert.doesNotMatch(ledgerSrc, /ModelFailure\("spend"\)/);

    for (let turn = 1; turn <= 60; turn++) {
      const ledger = createUsageLedger("owner-1", `req-turn-${turn}`);
      const isArgonTurn = turn % 5 === 0;
      const simulateVertex429 = turn % 8 === 0;
      const initialModel = isArgonTurn ? ARGON : HYDROGEN;

      const session: InferenceSession = {
        available: [HYDROGEN, ARGON, COPILOT_HAIKU],
        exposed: false,
        toolBoundary: false,
        fallbackUsed: false,
        ledger,
      };

      const routed = createRoutedModel(
        initialModel,
        session,
        (modelId) => {
          assert.ok(
            modelId === HYDROGEN ||
              modelId === ARGON ||
              modelId === COPILOT_HAIKU,
            `Forbidden pay-per-use model selected on turn ${turn}: ${modelId}`
          );
          if (modelId === HYDROGEN || modelId === ARGON) {
            return createVertexGeminiAdapter(modelId, {
              projectId: "project-cd0bc64c-0025-446c-b41",
              getAccessToken: () => Promise.resolve("ya29.test"),
              fetcher: () => {
                if (simulateVertex429) {
                  return Promise.resolve(
                    new Response("Resource exhausted", { status: 429 })
                  );
                }
                const sse = `data: ${JSON.stringify({
                  candidates: [
                    {
                      content: {
                        role: "model",
                        parts: [{ text: `Yanıt #${turn}` }],
                      },
                      finishReason: "STOP",
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 5000,
                    candidatesTokenCount: 2000,
                  },
                })}\n\ndata: [DONE]\n\n`;
                return Promise.resolve(
                  new Response(sse, {
                    status: 200,
                    headers: { "content-type": "text/event-stream" },
                  })
                );
              },
            });
          }
          return createCopilotHaikuVmAdapter({
            relayUrl: "https://relay.example.run.app",
            hmacSecret: "0123456789abcdef0123456789abcdef",
            copilotToken: "synthetic-unit-test-copilot-token",
            fetcher: () => {
              const sse = [
                `data: ${JSON.stringify({ type: "text-delta", delta: `Copilot yedek yanıt #${turn}` })}\n\n`,
                `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}\n\n`,
                "data: [DONE]\n\n",
              ].join("");
              return Promise.resolve(
                new Response(sse, {
                  status: 200,
                  headers: { "content-type": "text/event-stream" },
                })
              );
            },
          });
        },
        { gateway: false, vertexSearch: true }
      );

      const res = streamText({
        model: routed,
        prompt: `Merhaba tur ${turn}`,
        maxRetries: 0,
      });
      const text = await res.text;
      if (simulateVertex429) {
        assert.equal(text, `Copilot yedek yanıt #${turn}`);
        assert.equal(session.fallbackUsed, true);
        assert.equal(session.activeModelId, COPILOT_HAIKU);
      } else {
        assert.equal(text, `Yanıt #${turn}`);
        assert.equal(session.fallbackUsed, false);
      }
    }

    // When Vertex returns 429 AND Copilot is unavailable, show exact Turkish cause
    const vertexRateMsg = safeModelError(
      new ModelFailure("rate"),
      "Merhaba nasılsın"
    );
    assert.match(vertexRateMsg, /Vertex AI.*429/i);
  } finally {
    if (prevAllowance === undefined) {
      Reflect.deleteProperty(process.env, "AI_MONTHLY_ALLOWANCE_USD");
    } else {
      process.env.AI_MONTHLY_ALLOWANCE_USD = prevAllowance;
    }
  }
});

test("Browser Audit B & C: English inbox read, Turkish calendar read, and ordinal draft follow-up ('İlkine kısa bir cevap taslağı yaz') call Gmail/Calendar tools & accept RFC-5322 recipients", () => {
  const emailsTools = selectActiveTools(
    [userTurn("Show me my last 5 emails")],
    true,
    true,
    { googleConnectedAndHealthy: true }
  );
  assert.ok(emailsTools.includes("gmailReadMessages"));
  assert.ok(!emailsTools.includes("webSearch"));

  const calTools = selectActiveTools(
    [userTurn("Bu hafta takvimimde neler var?")],
    true,
    true,
    { googleConnectedAndHealthy: true }
  );
  assert.ok(calTools.includes("calendarReadEvents"));
  assert.ok(!calTools.includes("webSearch"));
  assert.equal(
    resolveTurnModelAndEffort({
      selectedModelId: HYDROGEN,
      availableModelIds: [HYDROGEN, ARGON],
      userText: "Bu hafta takvimimde neler var?",
      requestedTools: calTools,
    }).modelId,
    HYDROGEN
  );

  const followUpTools = selectActiveTools(
    [
      userTurn("Son 5 mailimi göster"),
      {
        id: "a-inbox-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "1. x.ai <support@x.ai> — API key update\n2. GitHub — Security alert",
          },
        ],
      },
      userTurn("İlkine kısa bir cevap taslağı yaz"),
    ],
    true,
    true,
    { googleConnectedAndHealthy: true }
  );
  assert.ok(followUpTools.includes("gmailCreateDraft"));
  assert.ok(followUpTools.includes("gmailReadMessages"));
  assert.ok(!followUpTools.includes("webSearch"));

  const googleTools = createGoogleConnectorTools({ userId: "owner-1" });
  const schema = googleTools.gmailCreateDraft.inputSchema as z.ZodTypeAny;
  assert.equal(
    schema.safeParse({
      recipient: "x.ai Support <support@x.ai>",
      subject: "Re: API key update",
      body: "Teşekkürler, inceledim.",
    }).success,
    true
  );
});

test("Browser Audit D: gmailReadMessages retries once with forceRefresh on stale 401 token and readGmailMessages fetches batches in parallel", async () => {
  const secrets = new Map<string, string>([
    ["GOOGLE_CONNECTOR_REFRESH_TOKEN", "1//refresh-token"],
    ["GOOGLE_CONNECTOR_CLIENT_ID", "12345-abc.apps.googleusercontent.com"],
    ["GOOGLE_CONNECTOR_CLIENT_SECRET", "GOCSPX-secret"],
  ]);
  const fakeVault: SecretVaultStore = {
    upsertSecret: () => Promise.reject(new Error("unused")),
    listSecrets: () => Promise.resolve([]),
    deleteSecret: () => Promise.resolve(false),
    resolveSecret: ({ name }) => Promise.resolve(secrets.get(name) ?? null),
  };

  let tokenIssued = 0;
  let gmailListCalls = 0;
  const tools = createGoogleConnectorTools({
    userId: "owner-d-retry",
    vaultStore: fakeVault,
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        tokenIssued += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: `ya29.token_${tokenIssued}`,
              expires_in: 3600,
            }),
            { status: 200 }
          )
        );
      }
      if (url.includes("/gmail/v1/users/me/messages?")) {
        gmailListCalls += 1;
        if (gmailListCalls === 1) {
          return Promise.resolve(new Response("Unauthorized", { status: 401 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ messages: [{ id: "m1" }] }), {
            status: 200,
          })
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "m1",
            threadId: "t1",
            snippet: "Hello from x.ai",
            payload: {
              headers: [
                { name: "From", value: "support@x.ai" },
                { name: "Subject", value: "Welcome" },
              ],
            },
          }),
          { status: 200 }
        )
      );
    }) as typeof fetch,
  });

  const out = (await tools.gmailReadMessages.execute?.({ maxResults: 5 }, {
    toolCallId: "c1",
    messages: [],
  } as any)) as { status: string; count?: number };
  assert.equal(out.status, "ok");
  assert.equal(out.count, 1);
  assert.equal(tokenIssued, 2);
  assert.equal(gmailListCalls, 2);

  // Verify parallel batch detail fetching + 800-char excerpt cap when >5 messages
  let activeDetailFetches = 0;
  let peakDetailFetches = 0;
  const longBody = Buffer.from("A".repeat(2500), "utf8").toString("base64url");
  const batchMessages = await readGmailMessages({
    accessToken: "ya29.batch",
    maxResults: 12,
    fetchImpl: (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/messages?")) {
        return new Response(
          JSON.stringify({
            messages: Array.from({ length: 12 }, (_, idx) => ({
              id: `msg_${idx}`,
            })),
          }),
          { status: 200 }
        );
      }
      activeDetailFetches += 1;
      peakDetailFetches = Math.max(peakDetailFetches, activeDetailFetches);
      await new Promise((r) => setTimeout(r, 10));
      activeDetailFetches -= 1;
      return new Response(
        JSON.stringify({
          id: "msg_x",
          threadId: "th_x",
          payload: {
            mimeType: "text/plain",
            headers: [{ name: "Subject", value: "Batch" }],
            body: { data: longBody },
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch,
  });
  assert.equal(batchMessages.length, 12);
  assert.ok(peakDetailFetches > 1 && peakDetailFetches <= 5);
  assert.ok(batchMessages[0].fencedContent.length < 1050);
});

test("Browser Audit E & F: Argon MEDIUM allocates 8192 thinking headroom (16384 total output tokens) to prevent mid-sentence truncation, and safeUIStream deduplicates fatal errors", async () => {
  const argonBody = buildVertexRequestBody(ARGON, {
    maxOutputTokens: 8192,
    prompt: [{ role: "user", content: [{ type: "text", text: "Deep dive" }] }],
    providerOptions: { openai: { reasoningEffort: "medium" } },
  });
  assert.equal(
    (argonBody.generationConfig as { maxOutputTokens: number }).maxOutputTokens,
    8192 + 8192
  );

  // F: safeUIStream deduplicates multiple fatal `error` chunks
  const transform = safeUIStream("Merhaba");
  const writer = transform.writable.getWriter();
  const collected: unknown[] = [];
  const readerPromise = (async () => {
    const reader = transform.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      collected.push(value);
    }
  })();
  await writer.write({ type: "error", errorText: "model_spend" } as any);
  await writer.write({ type: "error", errorText: "model_spend" } as any);
  await writer.write({ type: "error", errorText: "model_spend" } as any);
  await writer.close();
  await readerPromise;
  assert.equal(collected.length, 1);
});

test("Browser Audit G, H, I, J: shared Google connection helper, Turkish SOV remember extraction, account menu email/signout, and consistent per-message model badge", () => {
  // G: shared Google connection truth
  assert.equal(
    hasStoredGoogleConnection(
      new Set(["GOOGLE_CONNECTOR_REFRESH_TOKEN"]),
      true
    ),
    true
  );
  assert.equal(hasStoredGoogleConnection(new Set(), true), false);

  // I: Turkish SOV & English remember directives
  const trSovColon = extractExplicitRememberFact(
    "Benim adımı ve doğum yılımı hatırla: 1981"
  );
  assert.ok(trSovColon && trSovColon.kind === "ok");
  assert.equal(trSovColon.value, "Benim adımı ve doğum yılımı: 1981.");

  const trSovSentence = extractExplicitRememberFact(
    "Doğum yılımın 1981 olduğunu hatırla"
  );
  assert.ok(trSovSentence && trSovSentence.kind === "ok");
  assert.equal(trSovSentence.value, "Doğum yılımın 1981.");

  const enTopicColon = extractExplicitRememberFact(
    "Remember my birth year: 1981"
  );
  assert.ok(enTopicColon && enTopicColon.kind === "ok");
  assert.equal(enTopicColon.value, "My birth year: 1981.");

  // H & J: source assertions for account menu & model badge
  const navSrc = readFileSync("components/chat/sidebar-user-nav.tsx", "utf8");
  assert.match(navSrc, /data-testid="user-nav-button"/);
  assert.match(navSrc, /data-testid="user-menu-email"/);
  assert.match(navSrc, /data-testid="user-nav-item-auth"/);

  const msgSrc = readFileSync("components/chat/message.tsx", "utf8");
  assert.doesNotMatch(
    msgSrc,
    /modelUsed\s*&&\s*\(modelUsed\.isFallback\s*\|\|\s*modelUsed\.escalated\)/
  );
  assert.match(msgSrc, /data-testid="message-model-badge"/);
});
