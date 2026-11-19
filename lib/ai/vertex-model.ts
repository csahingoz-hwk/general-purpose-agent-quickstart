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
import { ModelFailure, safeErrorDiagnostic } from "./routing/policy";
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

function sanitizeJsonSchemaForVertex(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeJsonSchemaForVertex(item));
  }
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(src)) {
    if (
      key === "$schema" ||
      key === "propertyNames" ||
      key === "additionalItems"
    ) {
      continue;
    }
    if (key === "additionalProperties") {
      if (typeof val === "boolean") {
        out[key] = val;
      }
      continue;
    }
    if (key === "items" && Array.isArray(val)) {
      out[key] =
        val.length > 0
          ? sanitizeJsonSchemaForVertex(val[0])
          : { type: "string" };
      continue;
    }
    out[key] = sanitizeJsonSchemaForVertex(val);
  }
  return out;
}

async function extractSafeVertexErrorCode(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    const parsed = JSON.parse(raw) as {
      error?: { status?: unknown };
    };
    const status =
      typeof parsed?.error?.status === "string"
        ? parsed.error.status.trim()
        : "";
    if (/^[A-Za-z0-9_.:-]{1,64}$/.test(status)) {
      return status;
    }
  } catch {
    /* Never inspect or surface raw upstream error text */
  }
  return `vertex_http_${res.status || 503}`;
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

const VISUAL_SINGLETON_TOOLS = new Set<string>([
  "buildHtmlPageOrDashboard",
  "createExcalidrawDiagram",
  "generateInfographic",
]);

function extractPartThoughtSignature(part: {
  providerOptions?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
}): string | undefined {
  const fromOptions = (
    part.providerOptions?.vertex as { thoughtSignature?: unknown } | undefined
  )?.thoughtSignature;
  if (typeof fromOptions === "string" && fromOptions.length > 0) {
    return fromOptions;
  }
  const fromMeta = (
    part.providerMetadata?.vertex as { thoughtSignature?: unknown } | undefined
  )?.thoughtSignature;
  if (typeof fromMeta === "string" && fromMeta.length > 0) {
    return fromMeta;
  }
  return undefined;
}

/**
 * Coerces structured objects/arrays returned by Gemini in `*Json` string fields
 * (such as `elementsJson` or `charts[].optionJson`) into valid JSON strings so
 * AI SDK's `z.string()` schema check never rejects valid structured values.
 */
export function normalizeVertexFunctionArgs(
  rawArgs: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return {};
  }
  const coerceValue = (key: string, val: unknown): unknown => {
    if (
      key.endsWith("Json") &&
      val !== null &&
      val !== undefined &&
      typeof val === "object"
    ) {
      return JSON.stringify(val);
    }
    if (Array.isArray(val)) {
      return val.map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const outItem: Record<string, unknown> = {};
          for (const [ik, iv] of Object.entries(
            item as Record<string, unknown>
          )) {
            outItem[ik] = coerceValue(ik, iv);
          }
          return outItem;
        }
        return item;
      });
    }
    return val;
  };
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    normalized[k] = coerceValue(k, v);
  }
  return normalized;
}

function appendVertexContent(
  contents: VertexContent[],
  role: "user" | "model",
  parts: VertexPart[]
): void {
  if (parts.length === 0) {
    return;
  }
  const prev = contents.at(-1);
  if (prev && prev.role === role) {
    prev.parts.push(...parts);
    return;
  }
  contents.push({ role, parts });
}

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
      appendVertexContent(contents, "user", parts);
      continue;
    }

    if (msg.role === "assistant") {
      const parts: VertexPart[] = [];
      for (const part of msg.content) {
        const thoughtSignature = extractPartThoughtSignature(
          part as {
            providerOptions?: Record<string, unknown>;
            providerMetadata?: Record<string, unknown>;
          }
        );
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
          // Vertex AI `/v1/` FunctionCall accepts `{ name, args }` ONLY — sending `id`
          // causes HTTP 400 INVALID_ARGUMENT (`Unknown name "id"`).
          parts.push({
            functionCall: {
              name: part.toolName,
              args: parsedArgs,
            },
            ...(thoughtSignature ? { thoughtSignature } : {}),
          });
        }
      }
      appendVertexContent(contents, "model", parts);
      continue;
    }

    if (msg.role === "tool") {
      const parts: VertexPart[] = [];
      for (const part of msg.content) {
        const rawPart = part as unknown as {
          type: string;
          toolName?: string;
          output?: {
            type?: string;
            value?: unknown;
            reason?: string;
          };
          error?: unknown;
        };
        if (rawPart.type === "tool-error" && rawPart.toolName) {
          const errMessage =
            rawPart.error instanceof Error
              ? rawPart.error.message
              : typeof rawPart.error === "string"
                ? rawPart.error
                : JSON.stringify(rawPart.error ?? "Tool execution failed.");
          parts.push({
            functionResponse: {
              name: rawPart.toolName,
              response: { status: "error", error: errMessage },
            },
          });
          continue;
        }
        if (part.type !== "tool-result") {
          continue;
        }
        const out = part.output;
        let responseObj: Record<string, unknown>;
        if (out.type === "json" && out.value && typeof out.value === "object") {
          responseObj = Array.isArray(out.value)
            ? { items: out.value }
            : (out.value as Record<string, unknown>);
        } else if (out.type === "error-json") {
          responseObj =
            out.value &&
            typeof out.value === "object" &&
            !Array.isArray(out.value)
              ? { status: "error", ...(out.value as Record<string, unknown>) }
              : { status: "error", error: out.value ?? "Tool input error" };
        } else if (out.type === "error-text") {
          responseObj = { status: "error", error: out.value };
        } else if (out.type === "execution-denied") {
          responseObj = {
            status: "denied",
            reason: out.reason ?? "Action declined by user.",
          };
        } else if (out.type === "text") {
          responseObj = { result: out.value };
        } else {
          responseObj = { result: JSON.stringify(out) };
        }
        // Vertex AI `/v1/` FunctionResponse accepts `{ name, response }` ONLY —
        // sending `id` causes HTTP 400 INVALID_ARGUMENT (`Unknown name "id"`).
        parts.push({
          functionResponse: {
            name: part.toolName,
            response: responseObj,
          },
        });
      }
      appendVertexContent(contents, "user", parts);
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
        parametersJsonSchema: sanitizeJsonSchemaForVertex(tool.inputSchema),
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
        "Search Google on the public web immediately for current live facts, sourced research, current statistics, economic indicators (such as inflation or interest rates), news, prices, exchange rates, or match scores. Call directly without asking permission.",
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
  )?.reasoningEffort?.toLowerCase();
  // Gemini 4 Neon: default thinking_level is HIGH; thinking_budget and MINIMAL return HTTP 400.
  // Use LOW, MEDIUM, HIGH, or XHIGH only (MEDIUM for latency-sensitive turns).
  const thinkingLevel: "LOW" | "MEDIUM" | "HIGH" | "XHIGH" =
    requestedEffort === "xhigh"
      ? "XHIGH"
      : requestedEffort === "high"
        ? "HIGH"
        : requestedEffort === "medium"
          ? "MEDIUM"
          : requestedEffort === "low" ||
              requestedEffort === "minimal" ||
              requestedEffort === "none"
            ? "LOW"
            : modelId === "gemini-4-neon"
              ? "HIGH"
              : "MEDIUM";

  // Vertex Gemini 4 counts `thoughtsTokenCount` toward `generationConfig.maxOutputTokens`.
  // Add thinking headroom on top of the caller's visible-text `maxOutputTokens` budget
  // so deep reasoning never starves or truncates the visible answer.
  const thinkingHeadroom =
    modelId === "gemini-4-neon" ||
    thinkingLevel === "HIGH" ||
    thinkingLevel === "XHIGH"
      ? 8192
      : thinkingLevel === "MEDIUM"
        ? 4096
        : 1024;
  const visibleBudget = params.maxOutputTokens ?? 8192;
  // Historical tool calls reloaded from Postgres do not store `thoughtSignature`.
  // When any prior `functionCall` in `contents` lacks a signature, omit `thinkingConfig`
  // so Vertex `/v1/` never rejects multi-turn history with 400 `missing thought_signature`.
  const hasUnsignedFunctionCall = contents.some((item) =>
    item.parts.some((p) => Boolean(p.functionCall) && !p.thoughtSignature)
  );

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: Math.min(32_768, visibleBudget + thinkingHeadroom),
    ...(hasUnsignedFunctionCall
      ? {}
      : {
          thinkingConfig: {
            thinkingLevel,
          },
        }),
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

export const ALLOWED_VERTEX_LOCATIONS = ["global", "us", "eu"] as const;
export type AllowedVertexLocation = (typeof ALLOWED_VERTEX_LOCATIONS)[number];

/**
 * Gemini 4 Neon requires `global` (or multi-region `us`/`eu`); regional endpoints
 * like `europe-west2` are never used.
 */
export function resolveVertexLocation(
  raw = process.env.GOOGLE_VERTEX_LOCATION
): AllowedVertexLocation {
  const clean = (raw ?? "").trim().toLowerCase();
  if (clean === "global" || clean === "us" || clean === "eu") {
    return clean;
  }
  return "global";
}

export function createVertexGeminiAdapter(
  modelId: VertexModelId,
  deps?: {
    fetcher?: typeof fetch;
    getAccessToken?: () => Promise<string>;
    projectId?: string;
    location?: string;
    timeoutMs?: number;
  }
): LanguageModelV4 {
  const fetcher = deps?.fetcher ?? fetch;
  const resolveToken =
    deps?.getAccessToken ?? (() => getVertexWifAccessToken(fetcher));
  const defaultTimeoutMs = modelId === "gemini-4-neon" ? 55_000 : 35_000;
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
      throw Object.assign(new Error("vertex_timeout"), {
        name: "VertexTimeoutError",
        statusCode: 504,
        code: "vertex_timeout",
      });
    }
    throw err;
  }

  function endpointFor(projectId: string, streaming: boolean): string {
    const encodedProject = encodeURIComponent(projectId);
    const encodedModel = encodeURIComponent(modelId);
    const loc = resolveVertexLocation(deps?.location);
    const host =
      loc === "global"
        ? "aiplatform.googleapis.com"
        : `${loc}-aiplatform.googleapis.com`;
    const action = streaming
      ? "streamGenerateContent?alt=sse"
      : "generateContent";
    return `https://${host}/v1/projects/${encodedProject}/locations/${loc}/publishers/google/models/${encodedModel}:${action}`;
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
          name: "VertexConfigError",
          statusCode: 503,
          code: "vertex_project_missing",
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
        const safeCode = await extractSafeVertexErrorCode(res);
        throw Object.assign(new Error(`vertex_http_${res.status}`), {
          name: "VertexHttpError",
          statusCode: res.status,
          code: safeCode,
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
      const candidateParts = candidate?.content?.parts ?? [];
      let fallbackSignature: string | undefined;
      for (const p of candidateParts) {
        if (p.thoughtSignature) {
          fallbackSignature = p.thoughtSignature;
        }
      }
      const seenSingletonVisualInGen = new Set<string>();
      for (const part of candidateParts) {
        if (part.thought) {
          continue;
        }
        const sig = part.thoughtSignature ?? fallbackSignature;
        const providerMetadata = sig
          ? { vertex: { thoughtSignature: sig } }
          : undefined;
        if (part.functionCall) {
          if (VISUAL_SINGLETON_TOOLS.has(part.functionCall.name)) {
            if (seenSingletonVisualInGen.has(part.functionCall.name)) {
              continue;
            }
            seenSingletonVisualInGen.add(part.functionCall.name);
          }
          hasToolCalls = true;
          content.push({
            type: "tool-call",
            toolCallId:
              part.functionCall.id ||
              `vcall-${Math.random().toString(36).slice(2, 10)}`,
            toolName: part.functionCall.name,
            input: JSON.stringify(
              normalizeVertexFunctionArgs(part.functionCall.args)
            ),
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
          name: "VertexConfigError",
          statusCode: 503,
          code: "vertex_project_missing",
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
        const safeCode = res.ok
          ? "vertex_empty_stream"
          : await extractSafeVertexErrorCode(res);
        throw Object.assign(new Error(`vertex_http_${res.status}`), {
          name: "VertexHttpError",
          statusCode: res.status || 503,
          code: safeCode,
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
      const seenSingletonVisualInStream = new Set<string>();
      const pendingToolCalls: Array<{
        toolCallId: string;
        toolName: string;
        input: string;
        partSignature?: string;
      }> = [];

      function flushPendingToolCalls(
        controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>
      ) {
        while (pendingToolCalls.length > 0) {
          const tc = pendingToolCalls.shift();
          if (!tc) {
            continue;
          }
          const sig = tc.partSignature ?? latestThoughtSignature;
          controller.enqueue({
            type: "tool-call",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.input,
            ...(sig
              ? { providerMetadata: { vertex: { thoughtSignature: sig } } }
              : {}),
          });
        }
      }

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
            if (VISUAL_SINGLETON_TOOLS.has(part.functionCall.name)) {
              if (seenSingletonVisualInStream.has(part.functionCall.name)) {
                continue;
              }
              seenSingletonVisualInStream.add(part.functionCall.name);
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
            const serializedArgs = JSON.stringify(
              normalizeVertexFunctionArgs(part.functionCall.args)
            );
            // Buffer tool-call emission until SSE stream ends so trailing
            // `thoughtSignature` chunks attach cleanly for Step-2 Vertex calls.
            pendingToolCalls.push({
              toolCallId: callId,
              toolName: part.functionCall.name,
              input: serializedArgs,
              partSignature: part.thoughtSignature,
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
              flushPendingToolCalls(controller);

              // If a mixed-tool turn invoked the split search function, execute a
              // dedicated `{ googleSearch: {} }`-only Vertex sub-call (zero functionDeclarations).
              // A failed search sub-call MUST NOT kill the whole turn.
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

                const nonSearchTools = (params.tools ?? []).filter(
                  (t) =>
                    !(t.type === "provider" && t.id === WEB_SEARCH_TOOL_ID) &&
                    !(t.type === "function" && t.name === "webSearch")
                );

                const runFollowUpStream = async (followNote: string) => {
                  const followBody = buildVertexRequestBody(modelId, {
                    ...params,
                    prompt: [
                      ...params.prompt,
                      {
                        role: "user",
                        content: [{ type: "text", text: followNote }],
                      },
                    ],
                    tools: nonSearchTools,
                  });
                  const followRes = await fetcher(
                    endpointFor(projectId, true),
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify(followBody),
                      signal: withUpstreamTimeout(params.abortSignal),
                    }
                  );
                  if (!followRes.ok || !followRes.body) {
                    return false;
                  }
                  const followReader = followRes.body
                    .pipeThrough(new TextDecoderStream())
                    .getReader();
                  try {
                    let followBuf = "";
                    let followRaw = "";
                    let sawFollowSse = false;
                    for (;;) {
                      const { done: fDone, value: fChunk } =
                        await followReader.read();
                      if (fDone) {
                        break;
                      }
                      followRaw += fChunk;
                      followBuf += fChunk;
                      const fLines = followBuf.split(/\r?\n/);
                      followBuf = fLines.pop() ?? "";
                      for (const fl of fLines) {
                        const ft = fl.trim();
                        if (!ft.startsWith("data:")) {
                          continue;
                        }
                        const fd = ft.slice(5).trim();
                        if (!fd || fd === "[DONE]") {
                          continue;
                        }
                        sawFollowSse = true;
                        processPayload(
                          JSON.parse(fd) as VertexResponsePayload,
                          controller
                        );
                      }
                    }
                    if (followBuf.trim().startsWith("data:")) {
                      const fd = followBuf.trim().slice(5).trim();
                      if (fd && fd !== "[DONE]") {
                        sawFollowSse = true;
                        processPayload(
                          JSON.parse(fd) as VertexResponsePayload,
                          controller
                        );
                      }
                    }
                    if (!sawFollowSse && followRaw.trim()) {
                      processPayload(
                        JSON.parse(followRaw) as VertexResponsePayload,
                        controller
                      );
                    }
                  } finally {
                    if (textOpen) {
                      controller.enqueue({ type: "text-end", id: textId });
                      textOpen = false;
                    }
                    flushPendingToolCalls(controller);
                    followReader.releaseLock();
                  }
                  return true;
                };

                let subToolResultEmitted = false;
                let subTextAcc = "";
                const subTextId = `vtxt-split-${Math.random().toString(36).slice(2, 8)}`;
                let subTextOpen = false;
                let subSearchFailed = false;

                try {
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
                  const subRes = await fetcher(endpointFor(projectId, true), {
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

                  if (!subRes.ok || !subRes.body) {
                    const safeCode = subRes.ok
                      ? "vertex_empty_substream"
                      : await extractSafeVertexErrorCode(subRes);
                    throw Object.assign(
                      new Error(`vertex_subsearch_http_${subRes.status}`),
                      {
                        name: "VertexSubSearchError",
                        statusCode: subRes.status || 503,
                        code: safeCode,
                      }
                    );
                  }

                  const hasFileOrDocWriteTool = (params.tools ?? []).some(
                    (t) =>
                      t.type === "function" &&
                      (t.name === "cloudWriteFile" ||
                        t.name === "createDocument")
                  );
                  const wantsGroundedFileOrDoc =
                    hasFileOrDocWriteTool &&
                    (/\b(?:html|page|file|artifact|document|markdown|\.html|\.md|write\s+file|export\s+file)\b|(?<![\p{L}])(?:sayfa\p{L}*|dosya\p{L}*|belge\p{L}*|html|oluştur\p{L}*|hazırla\p{L}*)(?![\p{L}])/iu.test(
                      latestUserQuery
                    ) ||
                      (deferredGroundedQueries.some((q) =>
                        /\b(?:html|page|digest|news)\b/i.test(q)
                      ) &&
                        /\.html|\bhtml\b|\bpage\b|sayfa/iu.test(
                          latestUserQuery
                        )));

                  const subReader = subRes.body
                    .pipeThrough(new TextDecoderStream())
                    .getReader();
                  try {
                    let subSseBuf = "";
                    let rawSubText = "";
                    let sawSubSseFrame = false;
                    const subQueriesAcc: string[] = [];
                    const subChunksAcc: NonNullable<
                      VertexCandidate["groundingMetadata"]
                    >["groundingChunks"] = [];

                    const handleSubPayload = (
                      subPayload: VertexResponsePayload
                    ) => {
                      if (subPayload.usageMetadata) {
                        lastUsage = mapUsage(subPayload.usageMetadata);
                      }
                      const subCand = subPayload.candidates?.[0];
                      if (!subCand) {
                        return;
                      }
                      if (subCand.groundingMetadata?.webSearchQueries) {
                        for (const q of subCand.groundingMetadata
                          .webSearchQueries) {
                          if (q && !subQueriesAcc.includes(q)) {
                            subQueriesAcc.push(q);
                          }
                        }
                      }
                      if (subCand.groundingMetadata?.groundingChunks) {
                        subChunksAcc.push(
                          ...subCand.groundingMetadata.groundingChunks
                        );
                      }
                      for (const p of subCand.content?.parts ?? []) {
                        if (
                          !p.thought &&
                          typeof p.text === "string" &&
                          p.text
                        ) {
                          subTextAcc += p.text;
                          if (!wantsGroundedFileOrDoc) {
                            if (!subTextOpen) {
                              controller.enqueue({
                                type: "text-start",
                                id: subTextId,
                              });
                              subTextOpen = true;
                            }
                            controller.enqueue({
                              type: "text-delta",
                              id: subTextId,
                              delta: p.text,
                            });
                          }
                        }
                      }
                    };

                    for (;;) {
                      const { done: subDone, value: subChunk } =
                        await subReader.read();
                      if (subDone) {
                        break;
                      }
                      rawSubText += subChunk;
                      subSseBuf += subChunk;
                      const subLines = subSseBuf.split(/\r?\n/);
                      subSseBuf = subLines.pop() ?? "";
                      for (const line of subLines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith("data:")) {
                          continue;
                        }
                        const dataStr = trimmed.slice(5).trim();
                        if (!dataStr || dataStr === "[DONE]") {
                          continue;
                        }
                        sawSubSseFrame = true;
                        handleSubPayload(
                          JSON.parse(dataStr) as VertexResponsePayload
                        );
                      }
                    }
                    if (subSseBuf.trim().startsWith("data:")) {
                      const dataStr = subSseBuf.trim().slice(5).trim();
                      if (dataStr && dataStr !== "[DONE]") {
                        sawSubSseFrame = true;
                        handleSubPayload(
                          JSON.parse(dataStr) as VertexResponsePayload
                        );
                      }
                    }
                    if (!sawSubSseFrame && rawSubText.trim()) {
                      try {
                        handleSubPayload(
                          JSON.parse(rawSubText) as VertexResponsePayload
                        );
                      } catch {
                        /* non-JSON empty fallback */
                      }
                    }
                    if (subTextOpen) {
                      controller.enqueue({ type: "text-end", id: subTextId });
                      subTextOpen = false;
                    }
                    const subGrounding = buildGroundingSearchResults({
                      webSearchQueries: subQueriesAcc,
                      groundingChunks: subChunksAcc,
                    });
                    subToolResultEmitted = true;
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId: subCallId,
                      toolName: "webSearch",
                      result: {
                        results: subGrounding?.results ?? [],
                      },
                      providerExecuted: true,
                    } as unknown as LanguageModelV4StreamPart);

                    if (wantsGroundedFileOrDoc) {
                      const sourceLines = (subGrounding?.results ?? [])
                        .map((r) => `- ${r.title}: ${r.url}`)
                        .join("\n");
                      const groundedBrief = [
                        `Verified Google Search date: ${new Date().toISOString().slice(0, 10)}`,
                        subTextAcc.trim(),
                        sourceLines
                          ? `Verified source URLs:\n${sourceLines}`
                          : "",
                        "Now call the appropriate file/document tool (e.g. cloudWriteFile then cloudExportFileToChat, or createDocument) using ONLY the real items, publication dates, and clickable https:// source links above — never invent items.",
                      ]
                        .filter(Boolean)
                        .join("\n\n");
                      const okFollow = await runFollowUpStream(
                        groundedBrief
                      ).catch((followErr) => {
                        if (params.abortSignal?.aborted) {
                          throw followErr;
                        }
                        console.warn(
                          "[vertex] grounded file follow-up failed",
                          safeErrorDiagnostic(followErr)
                        );
                        return false;
                      });
                      if (!okFollow && subTextAcc) {
                        controller.enqueue({
                          type: "text-start",
                          id: subTextId,
                        });
                        controller.enqueue({
                          type: "text-delta",
                          id: subTextId,
                          delta: subTextAcc,
                        });
                        controller.enqueue({ type: "text-end", id: subTextId });
                      }
                    }
                  } finally {
                    subReader.releaseLock();
                  }
                } catch (subErr) {
                  if (params.abortSignal?.aborted) {
                    throw subErr;
                  }
                  subSearchFailed = true;
                  console.warn(
                    "[vertex] grounded search sub-call failed; continuing without live search",
                    safeErrorDiagnostic(subErr)
                  );
                  if (subTextOpen) {
                    controller.enqueue({ type: "text-end", id: subTextId });
                    subTextOpen = false;
                  }
                  if (!subToolResultEmitted) {
                    subToolResultEmitted = true;
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId: subCallId,
                      toolName: "webSearch",
                      result: { results: [], searchUnavailable: true },
                      providerExecuted: true,
                    } as unknown as LanguageModelV4StreamPart);
                  }
                }

                if (subSearchFailed && !subTextAcc.trim() && !sawFunctionCall) {
                  await runFollowUpStream(
                    "Live Google Search grounding was temporarily unavailable on this turn (0 results returned). Respond helpfully in the user's language without inventing current live facts, dates, or URLs; if live web data was needed, state briefly that live search was temporarily unavailable."
                  ).catch((followErr) => {
                    if (params.abortSignal?.aborted) {
                      throw followErr;
                    }
                    console.warn(
                      "[vertex] non-search recovery follow-up failed",
                      safeErrorDiagnostic(followErr)
                    );
                  });
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
