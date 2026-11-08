import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelMessage } from "ai";
import {
  budgetModelMessages,
  estimateModelTokens,
} from "../../lib/ai/context/budget";
import {
  classifyModelError,
  safeModelError,
} from "../../lib/ai/context/errors";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import type { ChatMessage } from "../../lib/types";

function user(text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

test("ordinary chat sends no expensive tool schema", () => {
  assert.deepEqual(
    selectActiveTools([user("Eraser diagramı nasıl gözükür?")], true),
    []
  );
  assert.deepEqual(selectActiveTools([user("Merhaba!")], true), []);
  assert.deepEqual(
    selectActiveTools([user("What's the weather like in London?")], true),
    ["getWeather"]
  );
  assert.deepEqual(
    selectActiveTools([user("Can you show a fictional inbox demo chart?")], true),
    ["demoInbox"]
  );
});

test("brief follow-up preserves tool intent without loading all tools", () => {
  assert.deepEqual(
    selectActiveTools(
      [user("What's the weather like today?"), user("London")],
      true
    ),
    ["getWeather"]
  );
  assert.deepEqual(
    selectActiveTools([user("Please personalise your style")], false),
    []
  );
});

test("short history retains all exact messages", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" },
    { role: "user", content: "Merhaba" },
  ];
  const result = budgetModelMessages({
    messages,
    system: "Be concise",
    toolCount: 0,
    requestBudget: 7000,
  });
  assert.equal(result.compacted, false);
  assert.equal(result.tooLarge, false);
  assert.deepEqual(result.messages, messages);
  assert.ok(estimateModelTokens(messages) > 0);
});

test("long chats shrink only the model copy and retain latest user message", () => {
  const messages: ModelMessage[] = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "Older context ".repeat(90) + String(index),
  }));
  messages.push({ role: "user", content: "Eraser diagramı nasıl gözükür?" });
  const untouched = JSON.stringify(messages);
  const result = budgetModelMessages({
    messages,
    system: "Answer in Turkish",
    toolCount: 0,
    requestBudget: 6000,
  });
  assert.equal(result.compacted, true);
  assert.equal(result.tooLarge, false);
  assert.ok(result.estimatedRequestTokens <= 6000);
  assert.equal(result.messages.at(-1)?.role, "user");
  assert.ok(JSON.stringify(result.messages.at(-1)).includes("Eraser"));
  assert.equal(JSON.stringify(messages), untouched);
});

test("budget detects a genuinely oversized latest request instead of truncating it", () => {
  const result = budgetModelMessages({
    messages: [{ role: "user", content: "A".repeat(15000) }],
    system: "Helpful assistant",
    toolCount: 1,
    requestBudget: 3400,
  });
  assert.equal(result.tooLarge, true);
  assert.ok(JSON.stringify(result.messages).includes("A".repeat(1000)));
});

test("provider errors become brief bilingual messages without private details", () => {
  const upstream = Object.assign(
    new Error(
      "Request too large for model openai/gpt-oss-120b in organization org_private123; " +
        "Limit 8000 requested 8266; https://console.groq.com/settings/billing"
    ),
    { statusCode: 413 }
  );
  assert.equal(classifyModelError(upstream), "size");
  for (const prompt of ["Eraser diagramı nasıl gözükür?", "Show a diagram"]) {
    const value = safeModelError(upstream, prompt);
    assert.ok(!value.includes("org_private123"));
    assert.ok(!value.includes("https://"));
    assert.ok(!value.includes("8266"));
    assert.ok(value.length < 260);
  }
  assert.match(safeModelError(upstream, "Türkçe cevap verir misin?"), /sınırını/);
  assert.match(
    safeModelError(Object.assign(new Error("rate limit"), { statusCode: 429 }), "Hello"),
    /limit/
  );
});
