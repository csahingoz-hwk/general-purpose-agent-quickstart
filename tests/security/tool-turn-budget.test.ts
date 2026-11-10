import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelMessage } from "ai";
import {
  budgetModelMessages,
  estimateToolSchemaTokens,
  followUpBudget,
  GROQ_REQUEST_BUDGET,
  GROQ_TOOL_TURN_BUDGET,
} from "../../lib/ai/context/budget";
import { systemPrompt } from "../../lib/ai/prompts";
import { getWeather } from "../../lib/ai/tools/get-weather";
import { contextBlock } from "../../lib/temporal";

// Regression: after a tool call the follow-up model call (the written answer)
// exceeded the old 3400-token tool-turn budget because the system prompt grew
// (time/location rules + context block). The prepareStep guard then threw
// chat_context_budget and the user saw only the weather card, never the answer.
test("the written answer after a weather tool call fits the tool-turn budget", async () => {
  assert.equal(GROQ_TOOL_TURN_BUDGET * 2, GROQ_REQUEST_BUDGET);
  const system = systemPrompt({
    supportsTools: true,
    needsOnboarding: true,
    includeArtifacts: false,
    context: contextBlock({
      now: new Date("2026-11-08T12:00:00Z"),
      timeZone: "Europe/London",
      home: null,
    }),
  });
  const tools = { getWeather: getWeather({ home: null }) };
  const schema = await estimateToolSchemaTokens(tools, ["getWeather"]);
  const output = {
    cityName: "London",
    current: { time: "2026-11-08T12:00", temperature_2m: 12 },
    current_units: { temperature_2m: "°C" },
    daily_units: {
      precipitation_probability_max: "%",
      precipitation_sum: "mm",
    },
    daily: {
      time: ["2026-11-08", "2026-11-09", "2026-11-10"],
      sunrise: ["2026-11-08T07:00"],
      sunset: ["2026-11-08T16:30"],
      temperature_2m_max: [12, 11, 10],
      temperature_2m_min: [6, 5, 4],
      precipitation_probability_max: [10, 60, 30],
      precipitation_sum: [0, 2.4, 0.6],
    },
  };
  const modelOutput = (
    tools.getWeather as unknown as {
      toModelOutput: (o: { output: unknown }) => { value: string };
    }
  ).toModelOutput({ output });
  const text = (role: "user" | "assistant", value: string) =>
    ({ role, content: [{ type: "text", text: value }] }) as ModelMessage;
  const afterTool: ModelMessage[] = [
    text("user", "Merhaba, Türkçe cevap ver."),
    text("assistant", "Merhaba! Türkçe yanıt. Bu örnek güvenli bir testtir."),
    text("user", "Please answer in English now."),
    text("assistant", "Hello! English reply from the selected model."),
    text("user", "What is the weather in London?"),
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call_0123456789abcdef",
          toolName: "getWeather",
          input: { city: "London" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_0123456789abcdef",
          toolName: "getWeather",
          output: { type: "text", value: modelOutput.value },
        },
      ],
    },
  ];
  const budget = (messages: ModelMessage[], requestBudget: number) =>
    budgetModelMessages({
      messages,
      system,
      toolCount: 1,
      toolSchemaTokens: schema,
      maxOutputTokens: 768,
      requestBudget,
    });
  const first = budget(afterTool.slice(0, 5), GROQ_TOOL_TURN_BUDGET);
  assert.equal(first.tooLarge, false);
  assert.equal(first.compacted, false);
  const next = budget(afterTool, followUpBudget(first.estimatedRequestTokens));
  assert.equal(next.tooLarge, false);
  // Both calls together stay inside the shared per-minute budget.
  assert.ok(
    first.estimatedRequestTokens + next.estimatedRequestTokens <=
      GROQ_REQUEST_BUDGET
  );
  // Older turns may be digested, but the request, tool call and result survive.
  assert.deepEqual(next.messages.slice(-3), afterTool.slice(-3));
});
