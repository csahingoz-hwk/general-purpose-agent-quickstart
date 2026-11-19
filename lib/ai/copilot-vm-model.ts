import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import {
  isCloudComputerConfigured,
  signCloudRelayRequest,
} from "@/lib/cloud-computer/client";
import { ModelFailure } from "./routing/policy";
import { assertNoKornFerryDataForGoogle } from "./vertex-model";

export const COPILOT_CLAUDE_HAIKU_ID = "claude-haiku-5.5" as const;
export const COPILOT_CLAUDE_HAIKU_NAME = "Claude Haiku 5.5" as const;

export function isCopilotTokenConfigured(): boolean {
  return Boolean(
    process.env.COPILOT_GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  );
}

export function isCopilotFallbackConfigured(): boolean {
  return isCloudComputerConfigured() && isCopilotTokenConfigured();
}

type CopilotBlobAttachment = {
  type: "blob";
  data: string;
  mimeType: string;
};

type CopilotToolDeclaration = {
  name: string;
  description: string;
  parameters: unknown;
};

type CopilotToolCallPayload = {
  toolCallId?: string;
  toolName: string;
  args?: Record<string, unknown>;
};

function extractImageBlob(
  data: unknown,
  mediaType?: string
): CopilotBlobAttachment | null {
  const mimeType = (mediaType || "").toLowerCase();
  if (
    mimeType !== "image/png" &&
    mimeType !== "image/jpeg" &&
    mimeType !== "image/webp" &&
    mimeType !== "image/gif"
  ) {
    return null;
  }
  if (typeof data === "string") {
    if (data.startsWith("data:")) {
      const comma = data.indexOf(",");
      if (comma !== -1) {
        return { type: "blob", data: data.slice(comma + 1), mimeType };
      }
    }
    if (!data.startsWith("http://") && !data.startsWith("https://")) {
      return { type: "blob", data, mimeType };
    }
    return null;
  }
  if (data instanceof Uint8Array) {
    return {
      type: "blob",
      data: Buffer.from(data).toString("base64"),
      mimeType,
    };
  }
  return null;
}

function buildCopilotTurnPayload(
  params: LanguageModelV4CallOptions,
  streaming: boolean,
  timeoutMs: number
): Record<string, unknown> {
  const systemBlocks: string[] = [];
  const transcriptEntries: { role: string; text: string }[] = [];
  const attachments: CopilotBlobAttachment[] = [];

  for (const msg of params.prompt) {
    if (msg.role === "system") {
      if (msg.content.trim()) {
        systemBlocks.push(msg.content.trim());
      }
      continue;
    }

    if (msg.role === "user") {
      const textChunks: string[] = [];
      for (const part of msg.content) {
        if (part.type === "text" && part.text.trim()) {
          textChunks.push(part.text);
        } else if (part.type === "file") {
          const blob = extractImageBlob(part.data, part.mediaType);
          if (blob) {
            attachments.push(blob);
          }
        }
      }
      if (textChunks.length > 0 || attachments.length > 0) {
        transcriptEntries.push({
          role: "User",
          text: textChunks.join("\n").trim() || "[Attached image]",
        });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const chunks: string[] = [];
      for (const part of msg.content) {
        if (part.type === "text" && part.text.trim()) {
          chunks.push(part.text);
        } else if (part.type === "tool-call" && !part.providerExecuted) {
          const argsStr =
            typeof part.input === "string"
              ? part.input
              : JSON.stringify(part.input ?? {});
          chunks.push(
            `[Called tool ${part.toolName}(id=${part.toolCallId}): ${argsStr}]`
          );
        }
      }
      if (chunks.length > 0) {
        transcriptEntries.push({
          role: "Assistant",
          text: chunks.join("\n"),
        });
      }
      continue;
    }

    if (msg.role === "tool") {
      const chunks: string[] = [];
      for (const part of msg.content) {
        if (part.type !== "tool-result") {
          continue;
        }
        const serialized =
          "value" in part.output
            ? typeof part.output.value === "string"
              ? part.output.value
              : JSON.stringify(part.output.value)
            : JSON.stringify(part.output);
        chunks.push(
          `[Tool result for ${part.toolName}(id=${part.toolCallId}): ${serialized}]`
        );
      }
      if (chunks.length > 0) {
        transcriptEntries.push({
          role: "Tool",
          text: chunks.join("\n"),
        });
      }
    }
  }

  let prompt = "";
  if (transcriptEntries.length === 1 && transcriptEntries[0]?.role === "User") {
    prompt = transcriptEntries[0].text;
  } else if (transcriptEntries.length > 1) {
    const history = transcriptEntries.slice(0, -1);
    const latest = transcriptEntries.at(-1);
    const historyBlock = history
      .map((item) => `${item.role}:\n${item.text}`)
      .join("\n\n");
    prompt =
      latest?.role === "Tool"
        ? `<conversation_history>\n${historyBlock}\n\n${latest.role}:\n${latest.text}\n</conversation_history>\n\nUse the tool results above to continue and answer the user's request.`
        : `<conversation_history>\n${historyBlock}\n</conversation_history>\n\n${latest?.text ?? ""}`;
  } else {
    prompt = "Hello";
  }

  const tools: CopilotToolDeclaration[] = [];
  for (const tool of params.tools ?? []) {
    if (tool.type === "function" && tool.name !== "webSearch") {
      tools.push({
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.inputSchema,
      });
    }
  }

  let responseSchema: unknown;
  if (params.responseFormat?.type === "json") {
    responseSchema = params.responseFormat.schema;
    systemBlocks.push(
      "Return ONLY valid JSON matching the requested schema, with no markdown code fences or commentary."
    );
  }

  return {
    model: COPILOT_CLAUDE_HAIKU_ID,
    ...(systemBlocks.length > 0 ? { system: systemBlocks.join("\n\n") } : {}),
    prompt,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(responseSchema ? { responseSchema } : {}),
    stream: streaming,
    timeoutMs,
  };
}

function estimateUsage(
  promptChars: number,
  outputChars: number
): LanguageModelV4Usage {
  const inputTotal = Math.max(1, Math.ceil(promptChars / 4));
  const outputTotal = Math.max(0, Math.ceil(outputChars / 4));
  return {
    inputTokens: {
      total: inputTotal,
      noCache: inputTotal,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: outputTotal,
      text: outputTotal,
      reasoning: undefined,
    },
  };
}

function resolveBridgeConfig(deps?: {
  relayUrl?: string;
  hmacSecret?: string;
  copilotToken?: string;
}) {
  const relayUrl = (
    deps?.relayUrl ??
    process.env.CLOUD_COMPUTER_RELAY_URL ??
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const hmacSecret = (
    deps?.hmacSecret ??
    process.env.CLOUD_COMPUTER_HMAC_SECRET ??
    process.env.AUTH_SECRET ??
    ""
  ).trim();
  const copilotToken = (
    deps?.copilotToken ??
    process.env.COPILOT_GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    ""
  ).trim();
  return { relayUrl, hmacSecret, copilotToken };
}

function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? (match[1]?.trim() ?? trimmed) : trimmed;
}

async function extractSafeCopilotErrorCode(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    const parsed = JSON.parse(raw) as {
      code?: unknown;
      error?: unknown;
    };
    for (const candidate of [parsed?.code, parsed?.error]) {
      if (
        typeof candidate === "string" &&
        /^[A-Za-z0-9_.:-]{1,64}$/.test(candidate.trim())
      ) {
        return candidate.trim();
      }
    }
  } catch {
    /* Never inspect or surface raw upstream error text */
  }
  return `copilot_http_${res.status || 502}`;
}

export function createCopilotHaikuVmAdapter(deps?: {
  fetcher?: typeof fetch;
  relayUrl?: string;
  hmacSecret?: string;
  copilotToken?: string;
  timeoutMs?: number;
}): LanguageModelV4 {
  const fetcher = deps?.fetcher ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? 45_000;

  async function postCopilotBridge(
    bodyObj: Record<string, unknown>,
    abortSignal?: AbortSignal
  ): Promise<Response> {
    const { relayUrl, hmacSecret, copilotToken } = resolveBridgeConfig(deps);
    if (!relayUrl || hmacSecret.length < 16 || !copilotToken) {
      throw Object.assign(new Error("copilot_bridge_unconfigured"), {
        name: "CopilotBridgeConfigError",
        statusCode: 503,
        code: "copilot_bridge_unconfigured",
      });
    }
    const pathname = "/copilot/chat";
    const body = JSON.stringify(bodyObj);
    const { timestamp, signature } = signCloudRelayRequest({
      secret: hmacSecret,
      method: "POST",
      pathname,
      body,
    });
    const combinedSignal = abortSignal
      ? AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs + 20_000)])
      : AbortSignal.timeout(timeoutMs + 20_000);

    try {
      return await fetcher(`${relayUrl}${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sandbox-Timestamp": timestamp,
          "X-Sandbox-Signature": signature,
          "X-Copilot-Token": copilotToken,
        },
        body,
        cache: "no-store",
        signal: combinedSignal,
      });
    } catch (err) {
      if (abortSignal?.aborted) {
        throw err;
      }
      throw Object.assign(new Error("copilot_bridge_unreachable"), {
        name: "CopilotBridgeNetworkError",
        statusCode: 504,
        code: "copilot_bridge_unreachable",
      });
    }
  }

  return {
    specificationVersion: "v4",
    provider: "github.copilot.vm-bridge",
    modelId: COPILOT_CLAUDE_HAIKU_ID,
    supportedUrls: {},

    async doGenerate(params) {
      params.abortSignal?.throwIfAborted();
      assertNoKornFerryDataForGoogle(params.prompt);
      if (
        params.tools?.some(
          (t) =>
            t.type !== "function" &&
            !(t.type === "provider" && t.id === "gateway.deepseek_search")
        )
      ) {
        throw new ModelFailure("tool");
      }

      const payload = buildCopilotTurnPayload(params, false, timeoutMs);
      const res = await postCopilotBridge(payload, params.abortSignal);
      if (!res.ok) {
        const safeCode = await extractSafeCopilotErrorCode(res);
        throw Object.assign(new Error(`copilot_http_${res.status}`), {
          name: "CopilotHttpError",
          statusCode: res.status || 502,
          code: safeCode,
        });
      }
      const data = (await res.json()) as {
        text?: string;
        finishReason?: string;
        toolCalls?: CopilotToolCallPayload[];
      };

      const content: LanguageModelV4Content[] = [];
      const rawText = typeof data.text === "string" ? data.text : "";
      const effectiveText =
        params.responseFormat?.type === "json"
          ? stripJsonCodeFence(rawText)
          : rawText;

      if (effectiveText.length > 0) {
        content.push({ type: "text", text: effectiveText });
      }

      const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : [];
      for (const tc of toolCalls) {
        content.push({
          type: "tool-call",
          toolCallId: (
            tc.toolCallId || `cpcall-${Math.random().toString(36).slice(2, 10)}`
          ).replace(/[^a-zA-Z0-9_-]/g, "_"),
          toolName: tc.toolName,
          input: JSON.stringify(tc.args ?? {}),
        });
      }

      const finishReason: LanguageModelV4FinishReason =
        toolCalls.length > 0 || data.finishReason === "tool-calls"
          ? { unified: "tool-calls", raw: "tool-calls" }
          : { unified: "stop", raw: "stop" };

      return {
        content,
        finishReason,
        usage: estimateUsage(
          JSON.stringify(payload).length,
          effectiveText.length
        ),
        warnings: [],
      };
    },

    async doStream(params) {
      params.abortSignal?.throwIfAborted();
      assertNoKornFerryDataForGoogle(params.prompt);

      const payload = buildCopilotTurnPayload(params, true, timeoutMs);
      const res = await postCopilotBridge(payload, params.abortSignal);
      if (!res.ok || !res.body) {
        const safeCode = res.ok
          ? "copilot_empty_stream"
          : await extractSafeCopilotErrorCode(res);
        throw Object.assign(new Error(`copilot_http_${res.status}`), {
          name: "CopilotHttpError",
          statusCode: res.status || 502,
          code: safeCode,
        });
      }

      const contentType = res.headers.get("content-type") ?? "";
      const isJsonFormat = params.responseFormat?.type === "json";
      const promptByteEstimate = JSON.stringify(payload).length;

      // Graceful support if upstream relay returned buffered JSON instead of SSE
      if (!contentType.includes("text/event-stream")) {
        const data = (await res.json()) as {
          text?: string;
          finishReason?: string;
          toolCalls?: CopilotToolCallPayload[];
        };
        const rawText = typeof data.text === "string" ? data.text : "";
        const outText = isJsonFormat ? stripJsonCodeFence(rawText) : rawText;
        const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : [];
        const textId = `cptxt-${Math.random().toString(36).slice(2, 10)}`;

        return {
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              if (outText.length > 0) {
                controller.enqueue({ type: "text-start", id: textId });
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: outText,
                });
                controller.enqueue({ type: "text-end", id: textId });
              }
              for (const tc of toolCalls) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: (
                    tc.toolCallId ||
                    `cpcall-${Math.random().toString(36).slice(2, 10)}`
                  ).replace(/[^a-zA-Z0-9_-]/g, "_"),
                  toolName: tc.toolName,
                  input: JSON.stringify(tc.args ?? {}),
                });
              }
              controller.enqueue({
                type: "finish",
                finishReason:
                  toolCalls.length > 0 || data.finishReason === "tool-calls"
                    ? { unified: "tool-calls", raw: "tool-calls" }
                    : { unified: "stop", raw: "stop" },
                usage: estimateUsage(promptByteEstimate, outText.length),
              });
              controller.close();
            },
          }),
        };
      }

      const upstreamReader = res.body
        .pipeThrough(new TextDecoderStream())
        .getReader();

      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            const textId = `cptxt-${Math.random().toString(36).slice(2, 10)}`;
            let textOpen = false;
            let totalOutChars = 0;
            let bufferedJsonText = "";
            let sawToolCall = false;
            let sseBuffer = "";

            const handleEventObj = (ev: {
              type?: string;
              delta?: string;
              toolCalls?: CopilotToolCallPayload[];
              finishReason?: string;
              statusCode?: number;
            }) => {
              if (ev.type === "error") {
                throw Object.assign(new Error("copilot_stream_error"), {
                  statusCode: ev.statusCode ?? 502,
                });
              }
              if (
                ev.type === "text-delta" &&
                typeof ev.delta === "string" &&
                ev.delta
              ) {
                totalOutChars += ev.delta.length;
                if (isJsonFormat) {
                  bufferedJsonText += ev.delta;
                  return;
                }
                if (!textOpen) {
                  controller.enqueue({ type: "text-start", id: textId });
                  textOpen = true;
                }
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: ev.delta,
                });
                return;
              }
              if (ev.type === "tool-calls" && Array.isArray(ev.toolCalls)) {
                if (textOpen) {
                  controller.enqueue({ type: "text-end", id: textId });
                  textOpen = false;
                }
                for (const tc of ev.toolCalls) {
                  sawToolCall = true;
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: (
                      tc.toolCallId ||
                      `cpcall-${Math.random().toString(36).slice(2, 10)}`
                    ).replace(/[^a-zA-Z0-9_-]/g, "_"),
                    toolName: tc.toolName,
                    input: JSON.stringify(tc.args ?? {}),
                  });
                }
              }
            };

            try {
              for (;;) {
                const { done, value } = await upstreamReader.read();
                if (done) {
                  break;
                }
                sseBuffer += value;
                const lines = sseBuffer.split(/\r?\n/);
                sseBuffer = lines.pop() ?? "";
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith("data:")) {
                    continue;
                  }
                  const dataStr = trimmed.slice(5).trim();
                  if (!dataStr || dataStr === "[DONE]") {
                    continue;
                  }
                  handleEventObj(JSON.parse(dataStr));
                }
              }

              if (sseBuffer.trim().startsWith("data:")) {
                const dataStr = sseBuffer.trim().slice(5).trim();
                if (dataStr && dataStr !== "[DONE]") {
                  handleEventObj(JSON.parse(dataStr));
                }
              }

              if (isJsonFormat && bufferedJsonText.length > 0) {
                const cleaned = stripJsonCodeFence(bufferedJsonText);
                controller.enqueue({ type: "text-start", id: textId });
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: cleaned,
                });
                controller.enqueue({ type: "text-end", id: textId });
              } else if (textOpen) {
                controller.enqueue({ type: "text-end", id: textId });
                textOpen = false;
              }

              controller.enqueue({
                type: "finish",
                finishReason: sawToolCall
                  ? { unified: "tool-calls", raw: "tool-calls" }
                  : { unified: "stop", raw: "stop" },
                usage: estimateUsage(promptByteEstimate, totalOutChars),
              });
              controller.close();
            } catch (err) {
              controller.error(err);
            } finally {
              upstreamReader.releaseLock();
            }
          },
          async cancel() {
            await upstreamReader.cancel().catch(() => null);
          },
        }),
      };
    },
  };
}
