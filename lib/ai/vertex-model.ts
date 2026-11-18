import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { isAllowedShortKornFerryContextFact } from "@/lib/memory/bulk-import";
import { type VertexModelId, WEB_SEARCH_TOOL_ID } from "./routing/catalog";
import { ModelFailure } from "./routing/policy";
import { getVertexProjectId, getVertexWifAccessToken } from "./vertex-auth";

type VertexPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: {
    id?: string;
    name: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
};

type VertexContent = {
  role: "user" | "model";
  parts: VertexPart[];
};

type GroundingChunk = {
  web?: { uri?: string; title?: string };
};

type VertexCandidate = {
  content?: { role?: string; parts?: VertexPart[] };
  finishReason?: string;
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: GroundingChunk[];
  };
};

type VertexResponsePayload = {
  candidates?: VertexCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
};

const OWNER_MEMORY_HEADER =
  "Owner durable memory (self-contained facts; Rules and Preferences take priority):";
const OWNER_MEMORY_SECTION_HEADING_RE =
  /^### (?:Rules|Preferences|About me|Family|Work|Projects)$/;

function systemPromptContainsRestrictedWorkData(
  systemContent: string
): boolean {
  if (!containsRestrictedWorkData(systemContent)) {
    return false;
  }
  const lines = systemContent.split(/\r?\n/);
  let inOwnerMemorySection = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === OWNER_MEMORY_HEADER) {
      inOwnerMemorySection = true;
      continue;
    }
    if (inOwnerMemorySection) {
      if (OWNER_MEMORY_SECTION_HEADING_RE.test(trimmed)) {
        continue;
      }
      if (trimmed.startsWith("- ")) {
        const factBody = trimmed.slice(2).trim();
        if (
          !containsRestrictedWorkData(factBody) ||
          isAllowedShortKornFerryContextFact(factBody)
        ) {
          continue;
        }
        return true;
      }
      inOwnerMemorySection = false;
    }
    if (containsRestrictedWorkData(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Hard Korn Ferry / employer data-governance guard: scans every prompt message
 * before ANY packet leaves for Google Vertex AI.
 * Only validated short job-title/region context lines inside `Owner durable memory`
 * in `system` are permitted; ALL Korn Ferry data, documents, user messages,
 * attachments, and tool payloads are strictly blocked (`work_boundary`).
 */
export function assertNoKornFerryDataForGoogle(
  prompt: LanguageModelV4CallOptions["prompt"]
) {
  for (const msg of prompt) {
    if (msg.role === "system") {
      if (systemPromptContainsRestrictedWorkData(msg.content)) {
        throw new ModelFailure("work_boundary");
      }
      continue;
    }
    if (containsRestrictedWorkData(JSON.stringify(msg))) {
      throw new ModelFailure("work_boundary");
    }
  }
}

function mapFinishReason(raw?: string): LanguageModelV4FinishReason {
  switch (raw) {
    case "STOP":
      return { unified: "stop", raw };
    case "MAX_TOKENS":
      return { unified: "length", raw };
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
      return { unified: "content-filter", raw };
    case "MALFORMED_FUNCTION_CALL":
      return { unified: "error", raw };
    default:
      return { unified: "stop", raw: raw ?? "STOP" };
  }
}

function mapUsage(
  meta?: VertexResponsePayload["usageMetadata"]
): LanguageModelV4Usage {
  const promptTotal = meta?.promptTokenCount ?? 0;
  const cached = meta?.cachedContentTokenCount ?? 0;
  const candidates = meta?.candidatesTokenCount ?? 0;
  const thoughts = meta?.thoughtsTokenCount ?? 0;
  return {
    inputTokens: {
      total: promptTotal,
      noCache: Math.max(0, promptTotal - cached),
      cacheRead: cached,
      cacheWrite: 0,
    },
    outputTokens: {
      total: candidates + thoughts,
      text: candidates,
      reasoning: thoughts > 0 ? thoughts : undefined,
    },
  };
}

function extractInlineBase64(
  data: unknown,
  mediaType?: string
): { mimeType: string; data: string } | null {
  const mimeType = mediaType || "application/octet-stream";
  if (typeof data === "string") {
    if (data.startsWith("data:")) {
      const comma = data.indexOf(",");
      if (comma !== -1) {
        return { mimeType, data: data.slice(comma + 1) };
      }
    }
    if (!data.startsWith("http://") && !data.startsWith("https://")) {
      return { mimeType, data };
    }
    return null;
  }
  if (data instanceof Uint8Array) {
    return { mimeType, data: Buffer.from(data).toString("base64") };
  }
  return null;
}

const SPLIT_WEB_SEARCH_FN_NAME = "__vertexGroundedWebSearch";

export function buildVertexRequestBody(
  modelId: VertexModelId,
  params: LanguageModelV4CallOptions
): Record<string, unknown> {
  const systemTexts: string[] = [];
  const contents: VertexContent[] = [];

  for (const msg of params.prompt) {
    if (msg.role === "system") {
      if (msg.content.trim()) {
        systemTexts.push(msg.content);
      }
      continue;
    }

    if (msg.role === "user") {
      const parts: VertexPart[] = [];
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push({ text: part.text });
        } else if (part.type === "file") {
          const inline = extractInlineBase64(part.data, part.mediaType);
          if (inline) {
            parts.push({ inlineData: inline });
          }
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "user", parts });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const parts: VertexPart[] = [];
      for (const part of msg.content) {
        const thoughtSignature = (
          part.providerOptions?.vertex as
            | { thoughtSignature?: string }
            | undefined
        )?.thoughtSignature;
        if (part.type === "text" && part.text) {
          parts.push({
            text: part.text,
            ...(thoughtSignature ? { thoughtSignature } : {}),
          });
        } else if (part.type === "tool-call" && !part.providerExecuted) {
          let parsedArgs: Record<string, unknown> = {};
          if (typeof part.input === "string") {
            try {
              parsedArgs = JSON.parse(part.input) as Record<string, unknown>;
            } catch {
              parsedArgs = {};
            }
          } else if (part.input && typeof part.input === "object") {
            parsedArgs = part.input as Record<string, unknown>;
          }
          parts.push({
            functionCall: {
              id: part.toolCallId,
              name: part.toolName,
              args: parsedArgs,
            },
            ...(thoughtSignature ? { thoughtSignature } : {}),
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (msg.role === "tool") {
      const parts: VertexPart[] = [];
      for (const part of msg.content) {
        if (part.type !== "tool-result") {
          continue;
        }
        const out = part.output;
        let responseObj: Record<string, unknown>;
        if (out.type === "json" && out.value && typeof out.value === "object") {
          responseObj = Array.isArray(out.value)
            ? { items: out.value }
            : (out.value as Record<string, unknown>);
        } else if (out.type === "text" || out.type === "error-text") {
          responseObj = { result: out.value };
        } else {
          responseObj = { result: JSON.stringify(out) };
        }
        parts.push({
          functionResponse: {
            id: part.toolCallId,
            name: part.toolName,
            response: responseObj,
          },
        });
      }
      if (parts.length > 0) {
        contents.push({ role: "user", parts });
      }
    }
  }

  const vertexTools: Record<string, unknown>[] = [];
  const functionDeclarations: Record<string, unknown>[] = [];
  let wantsGoogleSearch = false;

  for (const tool of params.tools ?? []) {
    if (tool.type === "provider" && tool.id === WEB_SEARCH_TOOL_ID) {
      wantsGoogleSearch = true;
      continue;
    }
    if (tool.type === "function") {
      if (tool.name === "webSearch") {
        wantsGoogleSearch = true;
        continue;
      }
      functionDeclarations.push({
        name: tool.name,
        description: tool.description ?? "",
        parametersJsonSchema: tool.inputSchema,
      });
    }
  }

  // Never mix built-in `{ googleSearch: {} }` and `{ functionDeclarations }` in
  // the same Vertex request. When function tools are active alongside webSearch,
  // expose search as a function declaration and run an isolated grounded sub-call
  // only if the model invokes it.
  if (wantsGoogleSearch && functionDeclarations.length > 0) {
    functionDeclarations.push({
      name: SPLIT_WEB_SEARCH_FN_NAME,
      description:
        "Search Google on the public web for current live facts, news, prices, exchange rates, or match scores.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Focused public web search query.",
          },
        },
        required: ["query"],
      },
    });
    vertexTools.push({ functionDeclarations });
  } else {
    if (wantsGoogleSearch) {
      vertexTools.push({ googleSearch: {} });
    }
    if (functionDeclarations.length > 0) {
      vertexTools.push({ functionDeclarations });
    }
  }

  const requestedEffort = (
    params.providerOptions?.openai as { reasoningEffort?: string } | undefined
  )?.reasoningEffort;
  const thinkingLevel =
    requestedEffort === "high"
      ? "HIGH"
      : requestedEffort === "low" && modelId === "gemini-4-hydrogen"
        ? "LOW"
        : "MEDIUM";

  // Vertex Gemini 4 counts `thoughtsTokenCount` toward `generationConfig.maxOutputTokens`.
  // Add thinking headroom on top of the caller's visible-text `maxOutputTokens` budget
  // so deep reasoning never starves or truncates the visible answer.
  const thinkingHeadroom =
    modelId === "gemini-4-argon" || thinkingLevel === "HIGH"
      ? 8192
      : thinkingLevel === "MEDIUM"
        ? 4096
        : 1024;
  const visibleBudget = params.maxOutputTokens ?? 8192;

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: Math.min(32_768, visibleBudget + thinkingHeadroom),
    thinkingConfig: {
      thinkingLevel,
    },
  };

  if (params.temperature !== undefined) {
    generationConfig.temperature = params.temperature;
  }
  if (params.responseFormat?.type === "json") {
    generationConfig.responseMimeType = "application/json";
    if (params.responseFormat.schema) {
      generationConfig.responseJsonSchema = params.responseFormat.schema;
    }
  }

  return {
    ...(systemTexts.length > 0
      ? {
          systemInstruction: {
            parts: [{ text: systemTexts.join("\n\n") }],
          },
        }
      : {}),
    contents,
    ...(vertexTools.length > 0 ? { tools: vertexTools } : {}),
    generationConfig,
  };
}

function buildGroundingSearchResults(
  grounding?: VertexCandidate["groundingMetadata"]
): {
  queries: string[];
  results: { title: string; url: string; snippet: string }[];
} | null {
  if (!grounding) {
    return null;
  }
  const queries = (grounding.webSearchQueries ?? []).filter(Boolean);
  const results: { title: string; url: string; snippet: string }[] = [];
  const seen = new Set<string>();
  for (const chunk of grounding.groundingChunks ?? []) {
    const uri = chunk.web?.uri?.trim();
    const title = chunk.web?.title?.trim();
    if (!uri || seen.has(uri)) {
      continue;
    }
    seen.add(uri);
    results.push({
      title: title || uri,
      url: uri,
      snippet: queries[0] ? `Grounded via Google Search: ${queries[0]}` : "",
    });
    if (results.length >= 8) {
      break;
    }
  }
  if (results.length === 0 && queries.length === 0) {
    return null;
  }
  return { queries, results };
}

export function createVertexGeminiAdapter(
  modelId: VertexModelId,
  deps?: {
    fetcher?: typeof fetch;
    getAccessToken?: () => Promise<string>;
    projectId?: string;
    timeoutMs?: number;
  }
): LanguageModelV4 {
  const fetcher = deps?.fetcher ?? fetch;
  const resolveToken =
    deps?.getAccessToken ?? (() => getVertexWifAccessToken(fetcher));
  const defaultTimeoutMs = modelId === "gemini-4-argon" ? 55_000 : 35_000;
  const upstreamTimeoutMs = Math.max(
    250,
    deps?.timeoutMs ??
      Number.parseInt(
        process.env.VERTEX_UPSTREAM_TIMEOUT_MS ?? String(defaultTimeoutMs),
        10
      )
  );

  function withUpstreamTimeout(callerSignal?: AbortSignal): AbortSignal {
    const timerSignal = AbortSignal.timeout(upstreamTimeoutMs);
    return callerSignal
      ? AbortSignal.any([callerSignal, timerSignal])
      : timerSignal;
  }

  function normalizeUpstreamError(
    err: unknown,
    callerSignal?: AbortSignal
  ): never {
    if (callerSignal?.aborted) {
      throw err;
    }
    const name =
      err && typeof err === "object" && "name" in err ? String(err.name) : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw Object.assign(new Error("vertex_timeout"), { statusCode: 504 });
    }
    throw err;
  }

  function endpointFor(projectId: string, streaming: boolean): string {
    const encodedProject = encodeURIComponent(projectId);
    const encodedModel = encodeURIComponent(modelId);
    const action = streaming
      ? "streamGenerateContent?alt=sse"
      : "generateContent";
    return `https://aiplatform.googleapis.com/v1/projects/${encodedProject}/locations/global/publishers/google/models/${encodedModel}:${action}`;
  }

  return {
    specificationVersion: "v4",
    provider: "google.vertex.anthropic-free-wif",
    modelId,
    supportedUrls: {},

    async doGenerate(params) {
      params.abortSignal?.throwIfAborted();
      assertNoWorkDataForGoogle(params.prompt);

      const projectId = deps?.projectId ?? getVertexProjectId();
      if (!projectId) {
        throw Object.assign(new Error("vertex_project_missing"), {
          statusCode: 503,
        });
      }
      const accessToken = await resolveToken().catch((err) =>
        normalizeUpstreamError(err, params.abortSignal)
      );
      const body = buildVertexRequestBody(modelId, params);

      const res = await fetcher(endpointFor(projectId, false), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: withUpstreamTimeout(params.abortSignal),
      }).catch((err) => normalizeUpstreamError(err, params.abortSignal));

      if (!res.ok) {
        throw Object.assign(new Error(`vertex_http_${res.status}`), {
          statusCode: res.status,
        });
      }

      const payload = (await res.json()) as VertexResponsePayload;
      const candidate = payload.candidates?.[0];
      const content: LanguageModelV4Content[] = [];

      const grounding = buildGroundingSearchResults(
        candidate?.groundingMetadata
      );
      if (grounding && grounding.results.length > 0) {
        const callId = `vsearch-${Date.now()}`;
        content.push({
          type: "tool-call",
          toolCallId: callId,
          toolName: "webSearch",
          input: JSON.stringify({ query: grounding.queries[0] ?? "" }),
          providerExecuted: true,
        });
        content.push({
          type: "tool-result",
          toolCallId: callId,
          toolName: "webSearch",
          result: { results: grounding.results },
          providerExecuted: true,
        } as unknown as LanguageModelV4Content);
        for (const [idx, src] of grounding.results.entries()) {
          content.push({
            type: "source",
            sourceType: "url",
            id: `vsrc-${idx}`,
            url: src.url,
            title: src.title,
          });
        }
      }

      let hasToolCalls = false;
      for (const part of candidate?.content?.parts ?? []) {
        if (part.thought) {
          continue;
        }
        const providerMetadata = part.thoughtSignature
          ? { vertex: { thoughtSignature: part.thoughtSignature } }
          : undefined;
        if (part.functionCall) {
          hasToolCalls = true;
          content.push({
            type: "tool-call",
            toolCallId:
              part.functionCall.id ||
              `vcall-${Math.random().toString(36).slice(2, 10)}`,
            toolName: part.functionCall.name,
            input: JSON.stringify(part.functionCall.args ?? {}),
            ...(providerMetadata ? { providerMetadata } : {}),
          });
        } else if (typeof part.text === "string" && part.text.length > 0) {
          content.push({
            type: "text",
            text: part.text,
            ...(providerMetadata ? { providerMetadata } : {}),
          });
        }
      }

      const finishReason = hasToolCalls
        ? ({ unified: "tool-calls", raw: "functionCall" } as const)
        : mapFinishReason(candidate?.finishReason);

      return {
        content,
        finishReason,
        usage: mapUsage(payload.usageMetadata),
        warnings: [],
      };
    },

    async doStream(params) {
      params.abortSignal?.throwIfAborted();
      assertNoWorkDataForGoogle(params.prompt);

      const projectId = deps?.projectId ?? getVertexProjectId();
      if (!projectId) {
        throw Object.assign(new Error("vertex_project_missing"), {
          statusCode: 503,
        });
      }
      const accessToken = await resolveToken().catch((err) =>
        normalizeUpstreamError(err, params.abortSignal)
      );
      const body = buildVertexRequestBody(modelId, params);

      const res = await fetcher(endpointFor(projectId, true), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: withUpstreamTimeout(params.abortSignal),
      }).catch((err) => normalizeUpstreamError(err, params.abortSignal));

      if (!res.ok || !res.body) {
        throw Object.assign(new Error(`vertex_http_${res.status}`), {
          statusCode: res.status || 503,
        });
      }

      const upstreamReader = res.body
        .pipeThrough(new TextDecoderStream())
        .getReader();

      let sseBuffer = "";
      let textOpen = false;
      const textId = `vtxt-${Math.random().toString(36).slice(2, 10)}`;
      let lastUsage: LanguageModelV4Usage = mapUsage(undefined);
      let rawFinish: string | undefined;
      let sawFunctionCall = false;
      let latestThoughtSignature: string | undefined;
      const groundingChunksAcc: GroundingChunk[] = [];
      const groundingQueriesAcc: string[] = [];
      const hasSearchToolOnTurn = Boolean(
        params.tools?.some(
          (tool) =>
            (tool.type === "provider" && tool.id === WEB_SEARCH_TOOL_ID) ||
            (tool.type === "function" && tool.name === "webSearch")
        )
      );
      const hasOtherFunctionToolsOnTurn = Boolean(
        params.tools?.some(
          (tool) => tool.type === "function" && tool.name !== "webSearch"
        )
      );
      const latestUserQuery = (() => {
        for (let i = params.prompt.length - 1; i >= 0; i--) {
          const msg = params.prompt[i];
          if (msg?.role === "user") {
            const txt = msg.content
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join(" ")
              .trim();
            if (txt) {
              return txt.slice(0, 180);
            }
          }
        }
        return "";
      })();
      const immediateSearchCallId =
        hasSearchToolOnTurn && !hasOtherFunctionToolsOnTurn
          ? `vground-0-${Math.random().toString(36).slice(2, 7)}`
          : null;
      let immediateSearchStarted = false;
      let immediateSearchResolved = false;
      const deferredGroundedQueries: string[] = [];

      function processPayload(
        payload: VertexResponsePayload,
        controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>
      ) {
        if (payload.usageMetadata) {
          lastUsage = mapUsage(payload.usageMetadata);
        }
        const candidate = payload.candidates?.[0];
        if (!candidate) {
          return;
        }
        if (immediateSearchCallId && !immediateSearchStarted) {
          immediateSearchStarted = true;
          controller.enqueue({
            type: "tool-call",
            toolCallId: immediateSearchCallId,
            toolName: "webSearch",
            input: JSON.stringify({ query: latestUserQuery }),
            providerExecuted: true,
          });
        }
        if (candidate.finishReason) {
          rawFinish = candidate.finishReason;
        }
        if (candidate.groundingMetadata?.webSearchQueries) {
          for (const q of candidate.groundingMetadata.webSearchQueries) {
            if (q && !groundingQueriesAcc.includes(q)) {
              groundingQueriesAcc.push(q);
            }
          }
        }
        if (candidate.groundingMetadata?.groundingChunks) {
          groundingChunksAcc.push(
            ...candidate.groundingMetadata.groundingChunks
          );
        }

        for (const part of candidate.content?.parts ?? []) {
          if (part.thoughtSignature) {
            latestThoughtSignature = part.thoughtSignature;
          }
          if (part.thought) {
            continue;
          }
          if (part.functionCall) {
            if (part.functionCall.name === SPLIT_WEB_SEARCH_FN_NAME) {
              const q =
                typeof part.functionCall.args?.query === "string" &&
                part.functionCall.args.query.trim()
                  ? part.functionCall.args.query.trim()
                  : latestUserQuery;
              if (q) {
                deferredGroundedQueries.push(q);
              }
              continue;
            }
            if (textOpen) {
              controller.enqueue({
                type: "text-end",
                id: textId,
                ...(latestThoughtSignature
                  ? {
                      providerMetadata: {
                        vertex: { thoughtSignature: latestThoughtSignature },
                      },
                    }
                  : {}),
              });
              textOpen = false;
            }
            sawFunctionCall = true;
            const callId =
              part.functionCall.id ||
              `vcall-${Math.random().toString(36).slice(2, 10)}`;
            const serializedArgs = JSON.stringify(part.functionCall.args ?? {});
            const sig = part.thoughtSignature ?? latestThoughtSignature;
            controller.enqueue({
              type: "tool-call",
              toolCallId: callId,
              toolName: part.functionCall.name,
              input: serializedArgs,
              ...(sig
                ? { providerMetadata: { vertex: { thoughtSignature: sig } } }
                : {}),
            });
            continue;
          }

          if (typeof part.text === "string" && part.text.length > 0) {
            if (!textOpen) {
              controller.enqueue({ type: "text-start", id: textId });
              textOpen = true;
            }
            controller.enqueue({
              type: "text-delta",
              id: textId,
              delta: part.text,
            });
          }
        }
      }

      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
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
                  const parsed = JSON.parse(dataStr) as VertexResponsePayload;
                  processPayload(parsed, controller);
                }
              }

              if (sseBuffer.trim().startsWith("data:")) {
                const dataStr = sseBuffer.trim().slice(5).trim();
                if (dataStr && dataStr !== "[DONE]") {
                  processPayload(
                    JSON.parse(dataStr) as VertexResponsePayload,
                    controller
                  );
                }
              }

              if (textOpen) {
                controller.enqueue({
                  type: "text-end",
                  id: textId,
                  ...(latestThoughtSignature
                    ? {
                        providerMetadata: {
                          vertex: { thoughtSignature: latestThoughtSignature },
                        },
                      }
                    : {}),
                });
                textOpen = false;
              }

              // If a mixed-tool turn invoked the split search function, execute a
              // dedicated `{ googleSearch: {} }`-only Vertex sub-call (zero functionDeclarations).
              if (deferredGroundedQueries.length > 0 && !sawFunctionCall) {
                const subQuery =
                  deferredGroundedQueries[0] ?? latestUserQuery ?? "";
                const subCallId = `vground-split-${Math.random().toString(36).slice(2, 7)}`;
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: subCallId,
                  toolName: "webSearch",
                  input: JSON.stringify({ query: subQuery }),
                  providerExecuted: true,
                });
                const subBody = buildVertexRequestBody(modelId, {
                  ...params,
                  prompt: [
                    ...params.prompt.filter((m) => m.role === "system"),
                    {
                      role: "user",
                      content: [{ type: "text", text: subQuery }],
                    },
                  ],
                  tools: [
                    {
                      type: "provider",
                      id: WEB_SEARCH_TOOL_ID,
                      name: "webSearch",
                      args: {},
                    },
                  ],
                });
                const subRes = await fetcher(endpointFor(projectId, false), {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(subBody),
                  signal: withUpstreamTimeout(params.abortSignal),
                }).catch((err) =>
                  normalizeUpstreamError(err, params.abortSignal)
                );
                if (subRes.ok) {
                  const subPayload =
                    (await subRes.json()) as VertexResponsePayload;
                  const subCand = subPayload.candidates?.[0];
                  const subGrounding = buildGroundingSearchResults(
                    subCand?.groundingMetadata
                  );
                  controller.enqueue({
                    type: "tool-result",
                    toolCallId: subCallId,
                    toolName: "webSearch",
                    result: {
                      results: subGrounding?.results ?? [],
                    },
                    providerExecuted: true,
                  } as unknown as LanguageModelV4StreamPart);
                  const subText = (subCand?.content?.parts ?? [])
                    .filter((p) => !p.thought && typeof p.text === "string")
                    .map((p) => p.text)
                    .join("");
                  if (subText) {
                    const subTextId = `vtxt-split-${Math.random().toString(36).slice(2, 8)}`;
                    controller.enqueue({ type: "text-start", id: subTextId });
                    controller.enqueue({
                      type: "text-delta",
                      id: subTextId,
                      delta: subText,
                    });
                    controller.enqueue({ type: "text-end", id: subTextId });
                  }
                } else {
                  controller.enqueue({
                    type: "tool-result",
                    toolCallId: subCallId,
                    toolName: "webSearch",
                    result: { results: [] },
                    providerExecuted: true,
                  } as unknown as LanguageModelV4StreamPart);
                }
              }

              // Emit grounded Google Search sources as WebSearchCard parts
              const grounding = buildGroundingSearchResults({
                webSearchQueries: groundingQueriesAcc,
                groundingChunks: groundingChunksAcc,
              });
              if (grounding && grounding.results.length > 0) {
                const chunkSize = 5;
                for (
                  let idx = 0;
                  idx < grounding.results.length;
                  idx += chunkSize
                ) {
                  const slice = grounding.results.slice(idx, idx + chunkSize);
                  const qIdx = Math.floor(idx / chunkSize);
                  if (
                    idx === 0 &&
                    immediateSearchCallId &&
                    immediateSearchStarted
                  ) {
                    immediateSearchResolved = true;
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId: immediateSearchCallId,
                      toolName: "webSearch",
                      result: { results: slice },
                      providerExecuted: true,
                    } as unknown as LanguageModelV4StreamPart);
                    continue;
                  }
                  const callId = `vground-${qIdx}-${Math.random().toString(36).slice(2, 7)}`;
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: callId,
                    toolName: "webSearch",
                    input: JSON.stringify({
                      query:
                        grounding.queries[qIdx] ?? grounding.queries[0] ?? "",
                    }),
                    providerExecuted: true,
                  });
                  controller.enqueue({
                    type: "tool-result",
                    toolCallId: callId,
                    toolName: "webSearch",
                    result: { results: slice },
                    providerExecuted: true,
                  } as unknown as LanguageModelV4StreamPart);
                }
              } else if (
                immediateSearchCallId &&
                immediateSearchStarted &&
                !immediateSearchResolved
              ) {
                immediateSearchResolved = true;
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: immediateSearchCallId,
                  toolName: "webSearch",
                  result: { results: [], skippedForSynthesis: true },
                  providerExecuted: true,
                } as unknown as LanguageModelV4StreamPart);
              }

              controller.enqueue({
                type: "finish",
                finishReason: sawFunctionCall
                  ? { unified: "tool-calls", raw: "functionCall" }
                  : mapFinishReason(rawFinish),
                usage: lastUsage,
              });
              controller.close();
            } catch (err) {
              controller.error(err);
            } finally {
              upstreamReader.releaseLock();
            }
          },
          async cancel() {
            await upstreamReader.cancel().catch(() => undefined);
          },
        }),
      };
    },
  };
}

function assertNoWorkDataForGoogle(
  prompt: LanguageModelV4CallOptions["prompt"]
) {
  assertNoKornFerryDataForGoogle(prompt);
}
