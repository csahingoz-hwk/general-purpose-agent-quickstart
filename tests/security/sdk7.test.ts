import assert from "node:assert/strict";
import { test } from "node:test";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  type LanguageModel,
  Output,
  simulateReadableStream,
  streamText,
  type ToolSet,
  toUIMessageStream,
  type UIMessageChunk,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { postRequestBodySchema } from "../../app/(chat)/api/chat/schema";
import { artifactSettings } from "../../lib/ai/artifact-settings";
import {
  budgetModelMessages,
  estimateToolSchemaTokens,
} from "../../lib/ai/context/budget";
import {
  applyApprovalResponses,
  canRetryReply,
  prepareRetry,
  replyForStorage,
  safeUIStream,
} from "../../lib/ai/conversation-state";
import { createGroqModel } from "../../lib/ai/groq-model";
import { createFictionalInbox, demoInbox } from "../../lib/ai/tools/demo-inbox";
import type { ChatMessage } from "../../lib/types";

const usage = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const user: ChatMessage = {
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text: "Merhaba" }],
};
const assistant = (parts: ChatMessage["parts"]): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  parts,
});

async function consume(model: LanguageModel) {
  let persisted: ChatMessage | undefined;
  let outcome: string | undefined;
  const stream = createUIMessageStream<ChatMessage>({
    execute: ({ writer }) => {
      const result = streamText({
        model,
        instructions: "Respond briefly",
        messages: [{ role: "user", content: "Merhaba" }],
        maxRetries: 0,
      });
      writer.merge(
        toUIMessageStream<ToolSet, ChatMessage>({
          stream: result.stream,
          sendReasoning: false,
          onEnd: ({ outcome }) => writer.setOutcome(outcome),
        }).pipeThrough(safeUIStream("Merhaba"))
      );
    },
    onEnd: (event) => {
      persisted = event.responseMessage;
      outcome = event.outcome.status;
    },
  });
  const sse = await createUIMessageStreamResponse({ stream }).text();
  return { sse, persisted, outcome };
}

test("SDK 7 stateless adapter streams bilingual text and persists one response via onEnd", async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: "Merhaba! Hello!" },
          { type: "text-end", id: "text" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          },
        ],
      }),
    }),
  });
  const { sse, persisted, outcome } = await consume(model);
  assert.match(sse, /Merhaba! Hello!/);
  assert.equal(persisted?.role, "assistant");
  assert.equal(persisted?.parts.filter((p) => p.type === "text").length, 1);
  assert.equal(outcome, "completed");
  assert.equal(model.doStreamCalls[0].prompt[0].role, "system");
});

test("Groq adapter remains V4 Chat Completions with SDK 7 and no Gateway/Responses routing", async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    urls.push(String(input));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "openai/gpt-oss-20b");
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.stream, true);
    const chunks = [
      {
        choices: [
          { index: 0, delta: { content: "Merhaba" }, finish_reason: null },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    return await Promise.resolve(
      new Response(
        `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } }
      )
    );
  };
  const model = createGroqModel("synthetic", "openai/gpt-oss-20b", fetcher);
  assert.equal(model.specificationVersion, "v4");
  const result = streamText({
    model,
    prompt: "Hello",
    providerOptions: { openai: { reasoningEffort: "low" } },
    maxRetries: 0,
  });
  assert.equal(await result.text, "Merhaba");
  assert.deepEqual(urls, ["https://api.groq.com/openai/v1/chat/completions"]);
});

test("SDK 7 compact tool conversion leaves full persisted UI fixture unchanged", async () => {
  const output = createFictionalInbox("tr");
  const messages: ChatMessage[] = [
    user,
    assistant([
      {
        type: "tool-demoInbox",
        toolCallId: "call_demo",
        state: "output-available",
        input: { language: "tr" },
        output,
      },
    ]),
  ];
  const original = JSON.stringify(messages);
  const converted = await convertToModelMessages(messages, {
    tools: { demoInbox },
  });
  const serialized = JSON.stringify(converted);
  assert.match(serialized, /fictional/);
  assert.doesNotMatch(serialized, /mira@example.test|demo-12/);
  assert.equal(JSON.stringify(messages), original);
  assert.equal(output.messages.length, 12);
  assert.ok(
    (await estimateToolSchemaTokens({ demoInbox }, ["demoInbox"])) > 50
  );
});

test("SDK 7 prepareStep retains budgeted context, tool pairs and latest user in multi-step output", async () => {
  const model = new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call",
              toolCallId: "call_demo",
              toolName: "demoInbox",
              input: '{"language":"tr"}',
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "12 fictional messages" },
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
            },
          ],
        }),
      },
    ],
  });
  const result = streamText({
    model,
    instructions: "Be concise",
    prompt: "Show fictional inbox",
    tools: { demoInbox },
    stopWhen: isStepCount(2),
    maxRetries: 0,
    prepareStep: ({ messages }) => ({
      messages: budgetModelMessages({
        messages,
        system: "Be concise",
        toolCount: 1,
      }).messages,
    }),
  });
  await result.consumeStream();
  assert.equal(model.doStreamCalls.length, 2);
  const second = JSON.stringify(model.doStreamCalls[1].prompt);
  assert.match(second, /call_demo/);
  assert.doesNotMatch(second, /mira@example.test/);
  assert.equal((await result.toolResults).length, 1);
  assert.equal((await result.usage).totalTokens, 50);
  const manyTools = Array.from({ length: 8 }, () => ({
    role: "assistant" as const,
    content: "intermediate",
  }));
  const budget = budgetModelMessages({
    messages: [{ role: "user", content: "L".repeat(9000) }, ...manyTools],
    system: "short",
    toolCount: 1,
    requestBudget: 2000,
  });
  assert.equal(budget.tooLarge, true);
  assert.equal(budget.messages[0].role, "user");
});

test("validated array elements replace partial structured-output snapshots", async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t" },
          {
            type: "text-delta",
            id: "t",
            delta: '{"elements":[{"sentence":"complete sentence"}',
          },
          {
            type: "text-delta",
            id: "t",
            delta: ',{"sentence":"second complete sentence"}]}',
          },
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          },
        ],
      }),
    }),
  });
  const result = streamText({
    model,
    prompt: "Two suggestions",
    output: Output.array({ element: z.object({ sentence: z.string() }) }),
  });
  const elements: { sentence: string }[] = [];
  for await (const element of result.elementStream) {
    elements.push(element);
  }
  assert.deepEqual(elements, [
    { sentence: "complete sentence" },
    { sentence: "second complete sentence" },
  ]);
});

test("fatal and tool error chunks hide raw provider details", async () => {
  const raw =
    "org_private123 https://console.groq.com/settings/billing quota exceeded";
  const chunks: UIMessageChunk[] = [
    { type: "error", errorText: raw },
    { type: "tool-output-error", toolCallId: "t", errorText: raw },
  ];
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const chunk of chunks) {
        c.enqueue(chunk);
      }
      c.close();
    },
  });
  const output: UIMessageChunk[] = [];
  const reader = stream.pipeThrough(safeUIStream("Merhaba")).getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    output.push(next.value);
  }

  assert.doesNotMatch(JSON.stringify(output), /org_private|https:/);
  assert.match(JSON.stringify(output), /sınırına/);
});

test("retry reuses canonical saved input, replaces partial text and never repeats tools", () => {
  const partial = replyForStorage(
    assistant([{ type: "text", text: "Partial" }]),
    false
  );
  assert.ok(partial);
  const prepared = prepareRetry([user, partial], user.id);
  assert.equal(prepared.replaceId, partial.id);
  assert.deepEqual(prepared.messages, [user]);
  assert.equal(canRetryReply([user, partial]), true);
  const toolReply = replyForStorage(
    assistant([
      {
        type: "tool-demoInbox",
        toolCallId: "t",
        state: "output-available",
        input: {},
        output: createFictionalInbox(),
      },
    ]),
    false
  );
  assert.ok(toolReply);
  assert.equal(canRetryReply([user, toolReply]), false);
  assert.throws(() => prepareRetry([user, toolReply], user.id));
  assert.throws(() =>
    prepareRetry(
      [user, assistant([{ type: "text", text: "Complete" }])],
      user.id
    )
  );
  assert.equal(
    replyForStorage(assistant([{ type: "text", text: " " }]), false),
    null
  );
});

test("approval responses cannot rewrite persisted inputs or approve unknown actions", () => {
  const saved = assistant([
    {
      type: "tool-demoInbox",
      toolCallId: "t",
      state: "approval-requested",
      input: { language: "tr" },
      approval: { id: "approve" },
    },
  ]);
  const submitted = assistant([
    {
      type: "tool-demoInbox",
      toolCallId: "t",
      state: "approval-responded",
      input: { language: "en" },
      approval: { id: "approve", approved: true },
    },
  ]);
  submitted.id = saved.id;
  const result = applyApprovalResponses([saved], [submitted]);
  assert.deepEqual((result[0].parts[0] as { input: unknown }).input, {
    language: "tr",
  });
  assert.throws(() => applyApprovalResponses([user], [submitted]));
});

test("artifact generation is bounded, private and oversized content fails before provider call", () => {
  const settings = artifactSettings(
    "Write briefly",
    "Small synthetic document"
  );
  assert.equal(settings.maxRetries, 0);
  assert.equal(settings.maxOutputTokens, 768);
  assert.equal(settings.telemetry.recordInputs, false);
  assert.throws(
    () => artifactSettings("write", "A".repeat(12_000)),
    /chat_context_budget/
  );
});

test("request schema refuses ambiguous and missing turns", () => {
  const base = {
    id: crypto.randomUUID(),
    selectedChatModel: "openai/gpt-oss-20b",
    selectedVisibilityType: "private",
  };
  assert.equal(postRequestBodySchema.safeParse(base).success, false);
  assert.equal(
    postRequestBodySchema.safeParse({
      ...base,
      message: user,
      messages: [user],
    }).success,
    false
  );
  assert.equal(
    postRequestBodySchema.safeParse({ ...base, message: user, retry: true })
      .success,
    true
  );
});
