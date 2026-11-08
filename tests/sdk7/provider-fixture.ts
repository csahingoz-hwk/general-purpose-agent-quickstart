/** Test process preload only. Never imported by application code. */
import { appendFileSync } from "node:fs";

if (process.env.GROQ_API_KEY !== "synthetic-sdk7-provider-key") {
  throw new Error("SDK fixture requires an explicit synthetic key");
}
const originalFetch = globalThis.fetch;
const attempts = new Map<string, number>();
const premium = process.env.SDK7_PROVIDER === "openai";
if (premium && process.env.OPENAI_API_KEY !== "synthetic-sdk7-openai-key") {
  throw new Error("OpenAI fixture requires a synthetic key");
}
const ids = premium
  ? ["gpt-6-luna", "gpt-6.1-terra"]
  : ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];

globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.hostname === "geocoding-api.open-meteo.com") {
    return Response.json({ results: [{ latitude: 51.5, longitude: -0.1 }] });
  }
  if (url.hostname === "api.open-meteo.com") {
    return Response.json({
      latitude: 51.5,
      longitude: -0.1,
      timezone: "Europe/London",
      cityName: "London",
      current: { time: "2026-11-08T12:00", temperature_2m: 12 },
      current_units: { temperature_2m: "°C" },
      hourly: { time: ["2026-11-08T12:00"], temperature_2m: [12] },
      daily: { sunrise: ["2026-11-08T07:00"], sunset: ["2026-11-08T16:30"] },
    });
  }
  if (url.hostname !== "api.groq.com" && url.hostname !== "api.openai.com") {
    return await originalFetch(input, options);
  }
  if (
    (premium && url.hostname !== "api.openai.com") ||
    (!premium && url.hostname !== "api.groq.com")
  ) {
    throw new Error("Unexpected third-party inference");
  }
  const headers = new Headers(
    options?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  if (
    headers.get("authorization") !==
    `Bearer ${premium ? "synthetic-sdk7-openai-key" : "synthetic-sdk7-provider-key"}`
  ) {
    throw new Error("Fixture cannot forward a real credential");
  }
  if (url.pathname.endsWith("/models")) {
    return Response.json({ data: ids.map((id) => ({ id })) });
  }
  if (!url.pathname.endsWith(premium ? "/responses" : "/chat/completions")) {
    throw new Error("Unexpected provider path");
  }
  const body = JSON.parse(String(options?.body));
  if (premium) {
    if (body.store !== false || body.service_tier !== "default") {
      throw new Error("Unsafe OpenAI configuration");
    }
    body.messages = body.input.map(
      (item: {
        type?: string;
        role?: string;
        content?: unknown;
        output?: unknown;
      }) => ({
        role:
          item.type === "function_call_output"
            ? "tool"
            : (item.role ?? "assistant"),
        content: item.content ?? item.output ?? "",
      })
    );
    body.tools = body.tools?.map((t: { name: string }) => ({ function: t }));
  }
  const latest =
    [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const prompt = typeof latest === "string" ? latest : JSON.stringify(latest);
  const key = `${body.model}:${prompt}`;
  const attempt = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, attempt);
  if (process.env.SDK7_CALL_LOG) {
    appendFileSync(
      process.env.SDK7_CALL_LOG,
      `${JSON.stringify({
        model: body.model,
        prompt,
        messages: body.messages,
        tools: body.tools,
        max_completion_tokens: body.max_completion_tokens,
        max_tokens: body.max_tokens,
      })}\n`
    );
  }
  if (premium && prompt.includes("test-billing")) {
    return Response.json(
      {
        error: {
          code: "credit_balance_exhausted",
          message: "private billing detail",
        },
      },
      { status: 429 }
    );
  }
  if (
    premium &&
    prompt.includes("test-transient") &&
    body.model === "gpt-6-luna"
  ) {
    return Response.json(
      { error: { code: "server_error", message: "private failure" } },
      { status: 503 }
    );
  }
  if (prompt.includes("test-rate-once") && attempt === 1) {
    return Response.json(
      {
        error: {
          message:
            "org_private123 https://console.groq.com/billing quota exceeded",
        },
      },
      { status: 429 }
    );
  }
  const names =
    body.tools?.map((t: { function: { name: string } }) => t.function.name) ??
    [];
  const last = body.messages.at(-1);
  let name: string | undefined;
  let args = {};
  if (last?.role !== "tool") {
    if (names.includes("getWeather")) {
      name = "getWeather";
      args = { city: "London" };
    } else if (names.includes("demoInbox")) {
      name = "demoInbox";
      args = { language: /Türkçe|örnek/.test(prompt) ? "tr" : "en" };
    } else if (names.includes("createDocument")) {
      name = "createDocument";
      args = { title: "Synthetic artifact", kind: "text" };
    }
  }
  const text = prompt.includes("Synthetic artifact")
    ? "A complete synthetic artifact."
    : /Türkçe|Merhaba|örnek|hava/.test(prompt)
      ? "Merhaba! Türkçe yanıt. Bu örnek güvenli bir testtir."
      : last?.role === "tool"
        ? "Here is the result from the tool."
        : "Hello! English reply from the selected model.";
  if (!body.stream) {
    return Response.json({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });
  }
  const chunk = (
    delta: Record<string, unknown>,
    finish_reason: string | null = null
  ) =>
    `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  const payload = name
    ? chunk({
        tool_calls: [
          {
            index: 0,
            id: `call_${crypto.randomUUID()}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      }) + chunk({}, "tool_calls")
    : chunk({ content: text }) + chunk({}, "stop");
  if (premium) {
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const itemId = crypto.randomUUID();
    const callId = `call_${crypto.randomUUID()}`;
    const usage = {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 40 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 5 },
    };
    const created = event({
      type: "response.created",
      response: { id: itemId, created_at: 1_794_142_800, model: body.model },
    });
    const content = name
      ? event({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            id: itemId,
            call_id: callId,
            name,
            arguments: "",
          },
        }) +
        event({
          type: "response.function_call_arguments.delta",
          item_id: itemId,
          output_index: 0,
          delta: JSON.stringify(args),
        }) +
        event({
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "function_call",
            id: itemId,
            call_id: callId,
            name,
            status: "completed",
            arguments: JSON.stringify(args),
          },
        })
      : event({
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", id: itemId },
        }) +
        event({
          type: "response.output_text.delta",
          item_id: itemId,
          output_index: 0,
          delta:
            prompt.includes("test-partial-once") && attempt === 1
              ? "Partial synthetic reply"
              : text,
        });
    return new Response(
      new ReadableStream({
        async start(controller) {
          if (prompt.includes("test-concurrent")) {
            await new Promise((r) => setTimeout(r, 1200));
          }
          controller.enqueue(new TextEncoder().encode(created + content));
          if (/Merhaba/.test(prompt) && !name) {
            await new Promise((r) => setTimeout(r, 1200));
          }
          if (prompt.includes("test-partial-once") && attempt === 1) {
            await new Promise((r) => setTimeout(r, 40));
            controller.error(new Error("private disconnected"));
            return;
          }
          controller.enqueue(
            new TextEncoder().encode(
              event({ type: "response.completed", response: { usage } })
            )
          );
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    );
  }
  const delay = prompt.includes("test-concurrent") ? 1200 : 0;
  return new Response(
    new ReadableStream({
      async start(controller) {
        if (delay) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (prompt.includes("test-partial-once") && attempt === 1) {
          controller.enqueue(
            new TextEncoder().encode(
              chunk({ content: "Partial synthetic reply" })
            )
          );
          await new Promise((resolve) => setTimeout(resolve, 40));
          controller.error(new Error("org_private123 upstream disconnected"));
          return;
        }
        // Keep the stream open after visible text, as real providers do while
        // finishing usage/stop frames. This exposes early-follow-up UI races.
        if (/Merhaba/.test(prompt) && !name) {
          controller.enqueue(
            new TextEncoder().encode(chunk({ content: text }))
          );
          await new Promise((resolve) => setTimeout(resolve, 1200));
          controller.enqueue(
            new TextEncoder().encode(`${chunk({}, "stop")}data: [DONE]\n\n`)
          );
        } else {
          controller.enqueue(
            new TextEncoder().encode(`${payload}data: [DONE]\n\n`)
          );
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
};
