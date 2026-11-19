import assert from "node:assert/strict";
import test from "node:test";
import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { safeModelError } from "../../lib/ai/context/errors";
import { canRetryReply } from "../../lib/ai/conversation-state";
import {
  COPILOT_CLAUDE_HAIKU_ID,
  COPILOT_CLAUDE_HAIKU_NAME,
  createCopilotHaikuVmAdapter,
} from "../../lib/ai/copilot-vm-model";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  ESCALATED_RESEARCH_MODEL,
  FALLBACK_CHAT_MODEL,
  getModelDisplayName,
} from "../../lib/ai/models";
import {
  COPILOT_HAIKU,
  HYDROGEN,
  LUNA,
  NEON,
  TERRA,
  WEB_SEARCH_TOOL_ID,
} from "../../lib/ai/routing/catalog";
import type { Invocation } from "../../lib/ai/routing/ledger";
import { createRoutedModel } from "../../lib/ai/routing/model";
import type { Failure } from "../../lib/ai/routing/policy";
import type { InferenceSession } from "../../lib/ai/routing/session";
import { createVertexGeminiAdapter } from "../../lib/ai/vertex-model";
import {
  classifyCloudCommand,
  verifyCloudRelayRequest,
} from "../../lib/cloud-computer/client";
import type { ChatMessage } from "../../lib/types";

function makeSession(
  available: InferenceSession["available"] = [HYDROGEN, NEON, COPILOT_HAIKU]
) {
  const reserves: Invocation[] = [];
  const settlements: {
    id: string;
    model: string;
    outcome: string;
    extraUsd?: number;
  }[] = [];
  const fallbacks: { fromModel: string; toModel: string; reason: Failure }[] =
    [];
  const session: InferenceSession = {
    available,
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    onFallback: (info) => {
      fallbacks.push(info);
    },
    ledger: {
      reserve(call) {
        reserves.push(call);
        return Promise.resolve(`res-${reserves.length}`);
      },
      settle(id, model, outcome, _usage, extraUsd) {
        settlements.push({ id, model, outcome, extraUsd });
        return Promise.resolve();
      },
    },
  };
  return { session, reserves, settlements, fallbacks };
}

async function readStreamText(
  model: LanguageModelV4,
  extra: Record<string, unknown> = {}
) {
  const { stream } = await model.doStream({
    prompt: [
      {
        role: "user",
        content: [{ type: "text", text: "Give me a quick 1-line greeting." }],
      },
    ],
    ...extra,
  });
  const reader = stream.getReader();
  const parts: LanguageModelV4StreamPart[] = [];
  for (;;) {
    const item = await reader.read();
    if (item.done) {
      break;
    }
    parts.push(item.value);
  }
  return {
    parts,
    text: parts
      .filter((p) => p.type === "text-delta")
      .map((p) => p.delta)
      .join(""),
  };
}

function makeCopilotSseFetch(replyText: string) {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = String(init?.body ?? "");
    calls.push({ url, headers, body });
    const sse = [
      `data: ${JSON.stringify({ type: "text-delta", delta: replyText })}\n\n`,
      `data: ${JSON.stringify({ type: "finish", finishReason: "stop", model: COPILOT_CLAUDE_HAIKU_ID })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    return Promise.resolve(
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      })
    );
  };
  return { fetcher, calls };
}

test("Model chain catalog: Hydrogen default, Neon escalation, Copilot Claude Haiku 5.5 ONLY fallback (never Luna/Terra/Antigravity)", () => {
  assert.equal(DEFAULT_CHAT_MODEL, HYDROGEN);
  assert.equal(ESCALATED_RESEARCH_MODEL, NEON);
  assert.equal(FALLBACK_CHAT_MODEL, COPILOT_HAIKU);
  assert.equal(getModelDisplayName(COPILOT_HAIKU), COPILOT_CLAUDE_HAIKU_NAME);
  assert.deepEqual(
    chatModels.map((m) => m.id),
    [HYDROGEN, NEON]
  );
  assert.ok(!chatModels.some((m) => m.id === LUNA || m.id === TERRA));
});

test("Everyday Vertex Hydrogen failure & timeout fall back ONCE to Copilot Claude Haiku 5.5 via Cloud VM bridge and report real model name", async () => {
  // 1) Vertex 503 failure -> Copilot Claude Haiku 5.5
  const { session, fallbacks, settlements } = makeSession();
  const attempted: string[] = [];
  const copilotMock = makeCopilotSseFetch("Hello from Claude Haiku 5.5!");

  const routed = createRoutedModel(
    HYDROGEN,
    session,
    (id) => {
      attempted.push(id);
      if (id === HYDROGEN) {
        return createVertexGeminiAdapter(HYDROGEN, {
          projectId: "project-cd0bc64c-0025-446c-b41",
          getAccessToken: () => Promise.resolve("ya29.test"),
          fetcher: () =>
            Promise.resolve(
              new Response("upstream unavailable", { status: 503 })
            ),
        });
      }
      if (id === COPILOT_HAIKU) {
        return createCopilotHaikuVmAdapter({
          relayUrl: "https://relay.example.run.app",
          hmacSecret: "0123456789abcdef0123456789abcdef",
          copilotToken: "synthetic-unit-test-copilot-token",
          fetcher: copilotMock.fetcher,
        });
      }
      throw new Error(`Unexpected model ${id}`);
    },
    { gateway: false, vertexSearch: true }
  );

  const out = await readStreamText(routed);
  assert.deepEqual(attempted, [HYDROGEN, COPILOT_HAIKU]);
  assert.equal(out.text, "Hello from Claude Haiku 5.5!");
  assert.equal(session.activeModelId, COPILOT_HAIKU);
  assert.equal(session.fallbackUsed, true);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0]?.fromModel, HYDROGEN);
  assert.equal(fallbacks[0]?.toModel, COPILOT_HAIKU);
  assert.equal(settlements.at(-1)?.model, COPILOT_HAIKU);
  assert.equal(settlements.at(-1)?.outcome, "completed");

  // Verify Cloud VM HMAC signature was valid
  const call = copilotMock.calls[0];
  assert.ok(call);
  assert.equal(
    verifyCloudRelayRequest({
      secret: "0123456789abcdef0123456789abcdef",
      method: "POST",
      pathname: "/copilot/chat",
      body: call.body,
      timestamp: call.headers.get("x-sandbox-timestamp") ?? "",
      signature: call.headers.get("x-sandbox-signature") ?? "",
    }),
    true
  );

  // 2) Vertex timeout -> Copilot Claude Haiku 5.5 (within sub-second timeoutMs)
  const timeoutCtx = makeSession();
  const timeoutAttempted: string[] = [];
  const timeoutRouted = createRoutedModel(
    HYDROGEN,
    timeoutCtx.session,
    (id) => {
      timeoutAttempted.push(id);
      if (id === HYDROGEN) {
        return createVertexGeminiAdapter(HYDROGEN, {
          projectId: "project-cd0bc64c-0025-446c-b41",
          getAccessToken: () => Promise.resolve("ya29.test"),
          timeoutMs: 250,
          fetcher: (_input, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(
                  init.signal?.reason ??
                    new DOMException("Timed out", "TimeoutError")
                );
              });
            }),
        });
      }
      return createCopilotHaikuVmAdapter({
        relayUrl: "https://relay.example.run.app",
        hmacSecret: "0123456789abcdef0123456789abcdef",
        copilotToken: "synthetic-unit-test-copilot-token",
        fetcher: makeCopilotSseFetch("Recovered from Vertex timeout!").fetcher,
      });
    },
    { gateway: false, vertexSearch: true }
  );

  const timeoutOut = await readStreamText(timeoutRouted);
  assert.deepEqual(timeoutAttempted, [HYDROGEN, COPILOT_HAIKU]);
  assert.equal(timeoutOut.text, "Recovered from Vertex timeout!");
  assert.equal(timeoutCtx.fallbacks[0]?.toModel, COPILOT_HAIKU);
});

test("Escalated research turn (Hydrogen -> Neon) falls back to Copilot Claude Haiku 5.5 even with webSearch active and $0 Gateway charge", async () => {
  const esc = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, NEON],
    userText: "Compare top 5 European cloud regions vs latency in detail",
    requestedTools: ["webSearch"],
    baseEffort: "low",
  });
  assert.equal(esc.modelId, NEON);
  assert.equal(esc.escalated, true);

  const { session, fallbacks, reserves, settlements } = makeSession();
  const attempted: string[] = [];

  const routed = createRoutedModel(
    esc.modelId as typeof NEON,
    session,
    (id) => {
      attempted.push(id);
      if (id === NEON) {
        return createVertexGeminiAdapter(NEON, {
          projectId: "project-cd0bc64c-0025-446c-b41",
          getAccessToken: () => Promise.resolve("ya29.test"),
          fetcher: () =>
            Promise.resolve(new Response("rate exhausted", { status: 429 })),
        });
      }
      return createCopilotHaikuVmAdapter({
        relayUrl: "https://relay.example.run.app",
        hmacSecret: "0123456789abcdef0123456789abcdef",
        copilotToken: "synthetic-unit-test-copilot-token",
        fetcher: makeCopilotSseFetch(
          "Neon fallback answered by Claude Haiku 5.5."
        ).fetcher,
      });
    },
    { gateway: false, vertexSearch: true }
  );

  const out = await readStreamText(routed, {
    tools: [
      {
        type: "provider",
        id: WEB_SEARCH_TOOL_ID,
        name: "webSearch",
        args: {},
      },
    ],
  });

  assert.deepEqual(attempted, [NEON, COPILOT_HAIKU]);
  assert.equal(out.text, "Neon fallback answered by Claude Haiku 5.5.");
  assert.equal(fallbacks[0]?.fromModel, NEON);
  assert.equal(fallbacks[0]?.toModel, COPILOT_HAIKU);
  assert.ok(reserves.every((r) => r.reserveUsd === 0));
  assert.ok(settlements.every((s) => (s.extraUsd ?? 0) === 0));
});

test("Double failure (Vertex fails AND Copilot fails) surfaces clean error and preserves Retry button", async () => {
  const { session, fallbacks } = makeSession();
  const attempted: string[] = [];

  const routed = createRoutedModel(
    HYDROGEN,
    session,
    (id) => {
      attempted.push(id);
      if (id === HYDROGEN) {
        return createVertexGeminiAdapter(HYDROGEN, {
          projectId: "project-cd0bc64c-0025-446c-b41",
          getAccessToken: () => Promise.resolve("ya29.test"),
          fetcher: () => Promise.resolve(new Response("503", { status: 503 })),
        });
      }
      return createCopilotHaikuVmAdapter({
        relayUrl: "https://relay.example.run.app",
        hmacSecret: "0123456789abcdef0123456789abcdef",
        copilotToken: "synthetic-unit-test-copilot-token",
        fetcher: () =>
          Promise.resolve(new Response('{"error":"vm down"}', { status: 502 })),
      });
    },
    { gateway: false, vertexSearch: true }
  );

  let caught: unknown = null;
  try {
    await readStreamText(routed);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof Error);
  assert.deepEqual(attempted, [HYDROGEN, COPILOT_HAIKU]);
  assert.equal(fallbacks.length, 1);

  const uiError = safeModelError(caught, "Hello there");
  assert.match(uiError, /Retry response/i);
  assert.doesNotMatch(
    uiError,
    /synthetic-unit-test-copilot-token|relay\.example|502/
  );

  // Assistant stub with data-turn-status + data-model-used still keeps Retry enabled!
  const messagesAfterDoubleFailure: ChatMessage[] = [
    {
      id: "u-1",
      role: "user",
      parts: [{ type: "text", text: "Hello there" }],
    },
    {
      id: "a-1",
      role: "assistant",
      parts: [
        {
          type: "data-turn-status",
          data: { phase: "thinking", model: COPILOT_HAIKU },
        },
        {
          type: "data-model-used",
          data: {
            modelId: COPILOT_HAIKU,
            modelName: COPILOT_CLAUDE_HAIKU_NAME,
            isFallback: true,
            fallbackFrom: HYDROGEN,
          },
        },
      ],
    },
  ];
  assert.equal(canRetryReply(messagesAfterDoubleFailure), true);
});

test("Korn Ferry firewall & VM secret isolation: KF data never reaches Vertex or Copilot, and /etc/opt-sandboxd.env is blocked", async () => {
  const { session } = makeSession();
  let copilotCalled = false;

  const routed = createRoutedModel(
    HYDROGEN,
    session,
    (id) => {
      if (id === HYDROGEN) {
        return createVertexGeminiAdapter(HYDROGEN, {
          projectId: "project-cd0bc64c-0025-446c-b41",
          getAccessToken: () => Promise.resolve("ya29.test"),
          fetcher: () => {
            throw new Error("Vertex network must not be called for KF data");
          },
        });
      }
      copilotCalled = true;
      throw new Error("Copilot fallback must NEVER run on work_boundary");
    },
    { gateway: false, vertexSearch: true }
  );

  await assert.rejects(async () => {
    await readStreamText(routed, {
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Summarize Korn Ferry SA90 EOSB accrual GL 239300 audit schedule",
            },
          ],
        },
      ],
    });
  }, /model_work_boundary/);
  assert.equal(copilotCalled, false);

  // Direct adapter call also enforces Korn Ferry firewall
  const directCopilot = createCopilotHaikuVmAdapter({
    relayUrl: "https://relay.example.run.app",
    hmacSecret: "0123456789abcdef0123456789abcdef",
    copilotToken: "synthetic-unit-test-copilot-token",
    fetcher: () => {
      throw new Error("Must never send KF data to Cloud VM");
    },
  });
  await assert.rejects(async () => {
    await directCopilot.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Review Korn Ferry SOX controls" }],
        },
      ],
    });
  }, /model_work_boundary/);

  // Cloud Computer shell policy blocks reading sandboxd env file or /proc/self/environ
  assert.equal(
    classifyCloudCommand("cat /etc/opt-sandboxd.env").tier,
    "blocked"
  );
  assert.equal(classifyCloudCommand("cat /proc/self/environ").tier, "blocked");
});

test("Copilot VM adapter streams declaration-only tool calls back to AI SDK agent loop", async () => {
  const sse = [
    `data: ${JSON.stringify({
      type: "tool-calls",
      toolCalls: [
        {
          toolCallId: "toolu_weather_london",
          toolName: "getWeather",
          args: { city: "London" },
        },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      type: "finish",
      finishReason: "tool-calls",
      model: COPILOT_CLAUDE_HAIKU_ID,
    })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");

  const adapter = createCopilotHaikuVmAdapter({
    relayUrl: "https://relay.example.run.app",
    hmacSecret: "0123456789abcdef0123456789abcdef",
    copilotToken: "synthetic-unit-test-copilot-token",
    fetcher: () =>
      Promise.resolve(
        new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        })
      ),
  });

  const { stream } = await adapter.doStream({
    prompt: [
      {
        role: "user",
        content: [{ type: "text", text: "What is the weather in London?" }],
      },
    ],
    tools: [
      {
        type: "function",
        name: "getWeather",
        description: "Get weather for a city",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ],
  });

  const parts: LanguageModelV4StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const item = await reader.read();
    if (item.done) {
      break;
    }
    parts.push(item.value);
  }

  const toolCall = parts.find((p) => p.type === "tool-call");
  assert.ok(toolCall && toolCall.type === "tool-call");
  assert.equal(toolCall.toolName, "getWeather");
  assert.deepEqual(JSON.parse(toolCall.input), { city: "London" });
  const finish = parts.find((p) => p.type === "finish");
  assert.ok(finish && finish.type === "finish");
  assert.equal(finish.finishReason.unified, "tool-calls");
});
