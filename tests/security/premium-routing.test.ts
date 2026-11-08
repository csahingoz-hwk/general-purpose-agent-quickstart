import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { isStepCount, streamText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { budgetModelMessages } from "../../lib/ai/context/budget";
import { safeModelError } from "../../lib/ai/context/errors";
import { DEFAULT_CHAT_MODEL } from "../../lib/ai/models";
import {
  LUNA,
  legacyEnabled,
  openAIEnabled,
  premiumModels,
  TERRA,
} from "../../lib/ai/routing/catalog";
import { usageCost } from "../../lib/ai/routing/cost";
import type { Invocation } from "../../lib/ai/routing/ledger";
import {
  createPremiumAdapter,
  createRoutedModel,
} from "../../lib/ai/routing/model";
import {
  failureKind,
  ModelFailure,
  mayFallback,
} from "../../lib/ai/routing/policy";
import type { InferenceSession } from "../../lib/ai/routing/session";

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 1000, noCache: 500, cacheRead: 300, cacheWrite: 200 },
  outputTokens: { total: 100, text: 75, reasoning: 25 },
};
const complete: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage,
};
const text = (value: string): LanguageModelV4StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: value },
  { type: "text-end", id: "t" },
  complete,
];
function fixture() {
  const calls: Invocation[] = [];
  const settled: {
    id: string;
    model: string;
    outcome: string;
    usage?: LanguageModelV4Usage;
  }[] = [];
  const session: InferenceSession = {
    available: [LUNA, TERRA],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    ledger: {
      reserve(call) {
        calls.push(call);
        return Promise.resolve(String(calls.length));
      },
      settle(id, model, outcome, reported) {
        settled.push({ id, model, outcome, usage: reported });
        return Promise.resolve();
      },
    },
  };
  return { session, calls, settled };
}
function mock(parts: LanguageModelV4StreamPart[] | Error): LanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: () => {
      if (parts instanceof Error) {
        return Promise.reject(parts);
      }
      return Promise.resolve({
        stream: new ReadableStream({
          start(c) {
            for (const p of parts) {
              c.enqueue(p);
            }
            c.close();
          },
        }),
      });
    },
  });
}
async function collect(
  model: LanguageModelV4,
  extra: Record<string, unknown> = {}
) {
  const result = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "Synthetic" }] }],
    ...extra,
  });
  const rows: LanguageModelV4StreamPart[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const part = await reader.read();
    if (part.done) {
      break;
    }
    rows.push(part.value);
  }
  return rows;
}
const transient = Object.assign(new Error("private upstream body"), {
  statusCode: 503,
});

test("Luna is the default; OpenAI and legacy routing require explicit separate enablement", () => {
  assert.equal(DEFAULT_CHAT_MODEL, LUNA);
  const prior = { ...process.env };
  try {
    process.env.OPENAI_API_KEY = undefined;
    process.env.OPENAI_API_USAGE_ENABLED = undefined;
    assert.equal(openAIEnabled(), false);
    assert.equal(legacyEnabled(), false);
    process.env.OPENAI_API_KEY = "synthetic";
    assert.equal(openAIEnabled(), false);
    process.env.OPENAI_API_USAGE_ENABLED = "true";
    assert.equal(openAIEnabled(), true);
    process.env.CHAT_PROVIDER = "groq-legacy";
    assert.equal(legacyEnabled(), false);
    process.env.ENABLE_LEGACY_GROQ = "true";
    assert.equal(openAIEnabled(), false);
    assert.equal(legacyEnabled(), true);
  } finally {
    process.env = prior;
  }
});
test("fallback policy excludes billing, shared rates, cancellation, auth, context and tool failures", () => {
  const base = {
    exposed: false,
    toolBoundary: false,
    used: false,
    available: true,
    cancelled: false,
  };
  for (const failure of [
    "billing",
    "rate",
    "cancelled",
    "auth",
    "context",
    "tool",
    "unavailable",
    "spend",
  ] as const) {
    assert.equal(mayFallback({ ...base, failure }), false);
  }
  assert.equal(mayFallback({ ...base, failure: "transient" }), true);
  for (const key of ["exposed", "toolBoundary", "used", "cancelled"] as const) {
    assert.equal(
      mayFallback({ ...base, [key]: true, failure: "transient" }),
      false
    );
  }
  assert.equal(
    mayFallback({ ...base, available: false, failure: "structured" }),
    false
  );
  assert.equal(
    failureKind({
      statusCode: 429,
      data: { error: { code: "credit_balance_exhausted" } },
    }),
    "billing"
  );
  assert.equal(
    failureKind({
      statusCode: 429,
      data: { error: { code: "project_spend_limit_exceeded" } },
    }),
    "billing"
  );
});
test("successful bilingual Luna response never invokes Terra; transient failure falls back once", async () => {
  const f = fixture();
  const selected: string[] = [];
  const model = createRoutedModel(LUNA, f.session, (id) => {
    selected.push(id);
    return mock(text("Merhaba! Hello!"));
  });
  await collect(model);
  assert.deepEqual(selected, [LUNA]);
  assert.equal(f.calls.length, 1);
  const g = fixture();
  const fallback: string[] = [];
  const result = await collect(
    createRoutedModel(LUNA, g.session, (id) => {
      fallback.push(id);
      return mock(id === LUNA ? transient : text("English follow-up"));
    })
  );
  assert.deepEqual(fallback, [LUNA, TERRA]);
  assert.equal(g.calls[1].fallbackReason, "transient");
  assert.equal(g.settled[1].usage, usage);
  assert.equal(result.filter((p) => p.type === "text-delta").length, 1);
  await assert.rejects(
    collect(createRoutedModel(LUNA, fixture().session, () => mock(transient))),
    /model_transient/
  );
});
test("partial text, emitted tools, unavailable Terra and cancellation never start a second answer", async () => {
  for (const parts of [
    [...text("Partial").slice(0, -1), { type: "error", error: transient }],
    [
      {
        type: "tool-call",
        toolCallId: "one",
        toolName: "consequential",
        input: "{}",
      },
      { type: "error", error: transient },
    ],
  ] as LanguageModelV4StreamPart[][]) {
    const f = fixture();
    let count = 0;
    await assert.rejects(
      collect(
        createRoutedModel(LUNA, f.session, () => {
          count++;
          return mock(parts);
        })
      ),
      /model_transient/
    );
    assert.equal(count, 1);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  f.session.available = [LUNA];
  await assert.rejects(
    collect(createRoutedModel(LUNA, f.session, () => mock(transient))),
    /model_transient/
  );
  assert.equal(f.calls.length, 1);
  const abort = new AbortController();
  abort.abort();
  const g = fixture();
  await assert.rejects(
    collect(
      createRoutedModel(LUNA, g.session, () => mock(text("never"))),
      { abortSignal: abort.signal }
    )
  );
  assert.equal(g.calls.length, 0);
});
test("invalid structured output is validated before exposure; only valid Terra output is released", async () => {
  const f = fixture();
  const rows = await collect(
    createRoutedModel(LUNA, f.session, (id) =>
      mock(text(id === LUNA ? '{"count":"wrong"}' : '{"count":2}'))
    ),
    {
      responseFormat: {
        type: "json",
        schema: {
          type: "object",
          properties: { count: { type: "number" } },
          required: ["count"],
          additionalProperties: false,
        },
      },
    }
  );
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].fallbackReason, "structured");
  assert.deepEqual(
    rows.filter((p) => p.type === "text-delta").map((p) => p.delta),
    ['{"count":2}']
  );
  assert.equal(f.settled[0].usage, usage); // Failed quality attempt still costs money.
});
test("provider usage includes cached/write tokens and reasoning without double charging", () => {
  const luna = usageCost(LUNA, usage);
  assert.ok(luna);
  assert.equal(luna.reasoning, 25);
  assert.equal(luna.input, 1000);
  assert.equal(luna.output, 100);
  assert.ok(Math.abs(luna.usd - 0.000_128) < 1e-12);
  const terra = usageCost(TERRA, usage);
  assert.ok(terra);
  assert.ok(Math.abs(terra.usd - 0.001_265) < 1e-12);
  assert.equal(
    usageCost(LUNA, {
      ...usage,
      inputTokens: { ...usage.inputTokens, total: undefined },
    }),
    null
  );
  assert.equal(
    usageCost(LUNA, {
      ...usage,
      inputTokens: { ...usage.inputTokens, cacheRead: 2000 },
    }),
    null
  );
  const missingWrite = usageCost(LUNA, {
    ...usage,
    inputTokens: { ...usage.inputTokens, cacheWrite: undefined },
  });
  assert.ok(missingWrite);
  assert.equal(missingWrite.exactBreakdown, false);
  assert.ok(missingWrite.usd >= luna.usd);
});
test("OpenAI adapter is SDK 7 V4 Responses with tools and safe Standard processing", async () => {
  const urls: string[] = [];
  const f = fixture();
  const model = createRoutedModel(TERRA, f.session, (id) =>
    createPremiumAdapter("synthetic", id, (input, options) => {
      urls.push(String(input));
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, TERRA);
      assert.equal(body.store, false);
      assert.equal(body.service_tier, "default");
      assert.equal(body.reasoning.effort, "medium");
      assert.equal(body.tools[0].type, "function");
      assert.deepEqual(body.prompt_cache_options, {
        mode: "implicit",
        ttl: "30m",
      });
      return Promise.resolve(
        new Response(
          'data: {"type":"response.created","response":{"id":"r","created_at":1,"model":"gpt-6.1-terra"}}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":10}}}\n\n',
          { headers: { "content-type": "text/event-stream" } }
        )
      );
    })
  );
  await collect(model, {
    tools: [
      {
        type: "function",
        name: "weather",
        description: "Weather",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  });
  assert.deepEqual(urls, ["https://api.openai.com/v1/responses"]);
  assert.equal(model.specificationVersion, "v4");
});
test("model-aware context retains long recent History; full original messages are untouched", () => {
  const messages = Array.from({ length: 70 }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `turn ${i} ${"bilingual history ".repeat(30)}`,
  }));
  const saved = JSON.stringify(messages);
  const result = budgetModelMessages({
    messages,
    system: "stable",
    toolCount: 0,
    requestBudget: premiumModels[LUNA].inferenceBudget,
    maxOutputTokens: 2048,
  });
  assert.ok(result.messages.length > 6);
  assert.equal(result.tooLarge, false);
  assert.equal(JSON.stringify(messages), saved);
  assert.equal(result.messages.at(-1)?.content, messages.at(-1)?.content);
  assert.doesNotMatch(
    safeModelError(new ModelFailure("billing"), "Hello"),
    /private|JSON|recharge/
  );
});

test("multi-step execution cannot replay a completed consequential tool through fallback", async () => {
  const f = fixture();
  let executed = 0;
  const selected: string[] = [];
  let step = 0;
  const model = createRoutedModel(LUNA, f.session, (id) => {
    selected.push(id);
    step++;
    return mock(
      step === 1
        ? [
            {
              type: "tool-call",
              toolCallId: "write-once",
              toolName: "save",
              input: "{}",
            },
            {
              ...complete,
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
            },
          ]
        : transient
    );
  });
  const result = streamText({
    model,
    prompt: "Synthetic approved local write",
    tools: {
      save: tool({
        inputSchema: z.object({}),
        execute: () => {
          executed++;
          return Promise.resolve({ saved: true });
        },
      }),
    },
    stopWhen: isStepCount(2),
    maxRetries: 0,
    onError: () => {
      /* Assert the stream error below; do not log fake private errors. */
    },
  });
  const reader = result.stream.getReader();
  const partTypes: string[] = [];
  await assert.rejects(async () => {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      partTypes.push(part.value.type);
    }
  }, /model_transient/);
  assert.equal(executed, 1);
  assert.deepEqual(selected, [LUNA, LUNA]);
  assert.equal(f.calls.length, 2);
  assert.ok(partTypes.includes("tool-result"));
  assert.equal(f.settled.at(-1)?.outcome, "transient_after_tool");
});

test("cancelling a live provider stream stops generation and retains unknown-usage reservation", async () => {
  const f = fixture();
  let cancelled = 0;
  const source = new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "t" });
            controller.enqueue({
              type: "text-delta",
              id: "t",
              delta: "Partial",
            });
          },
          cancel() {
            cancelled++;
          },
        }),
      }),
  });
  const result = await createRoutedModel(
    LUNA,
    f.session,
    () => source
  ).doStream({ prompt: [] });
  const reader = result.stream.getReader();
  await reader.read();
  await reader.read();
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cancelled, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.settled.length, 1);
  assert.equal(f.settled[0].outcome, "cancelled");
  assert.equal(f.settled[0].usage, undefined);
});
