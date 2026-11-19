import { createOpenAI } from "@ai-sdk/openai";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { createGateway } from "ai";
import { z } from "zod";
import {
  COPILOT_HAIKU,
  HYDROGEN,
  isCopilotFallbackModel,
  isVertexModel,
  LUNA,
  NEON,
  type PremiumModelId,
  premiumModels,
  TERRA,
  WEB_SEARCH_COST_USD,
  WEB_SEARCH_MAX_CALLS,
  WEB_SEARCH_TOOL_ID,
} from "./catalog";
import { inputTokenBound, reserveCost } from "./cost";
import { gatewaySlug } from "./gateway";
import {
  type Failure,
  failureKind,
  ModelFailure,
  mayFallback,
  mayFallbackBetweenVertexModels,
  mayFallbackFromVertexToCopilot,
  mayRetryVertexSameModel,
  type SafeErrorDiagnostic,
  safeErrorDiagnostic,
} from "./policy";
import type { InferenceSession } from "./session";

/** Official API only. No Gateway, web session, hosted tool or provider fallback. */
export function createPremiumAdapter(
  key: string,
  model: PremiumModelId,
  fetcher: typeof fetch = fetch
): LanguageModelV4 {
  return createOpenAI({
    apiKey: key,
    baseURL: "https://api.openai.com/v1",
    fetch: fetcher,
  }).responses(model);
}

/**
 * Native AI SDK Gateway provider. Authentication (OIDC request header on Vercel,
 * AI_GATEWAY_API_KEY, or a local OIDC token) is resolved by the provider on every
 * request, so rotating OIDC tokens never need manual handling here. Only the
 * verified provider-prefixed OpenAI slug is ever requested.
 */
export function createGatewayAdapter(
  model: PremiumModelId,
  provider: (id: string) => LanguageModelV4 = createGateway()
): LanguageModelV4 {
  return provider(gatewaySlug(model));
}

const READ_ONLY_FALLBACK_SAFE_TOOLS = new Set<string>([
  "gmailReadMessages",
  "calendarReadEvents",
  "driveReadFiles",
  "githubReadPullRequests",
  "recallMemories",
  "saveProfileFact",
  "addJournalEntry",
  "listMySchedules",
  "getWeather",
  "getCurrentTime",
  "getFixtures",
  "webSearch",
  "firecrawlSearch",
  "firecrawlScrape",
  "firecrawlCrawlMap",
]);

function hasConsequentialToolInPrompt(
  prompt: LanguageModelV4CallOptions["prompt"]
): boolean {
  for (const msg of prompt) {
    if (msg.role !== "tool") {
      continue;
    }
    for (const part of msg.content) {
      if (
        part.type === "tool-result" &&
        !READ_ONLY_FALLBACK_SAFE_TOOLS.has(part.toolName)
      ) {
        return true;
      }
    }
  }
  return false;
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** One request shares its exposure/tool/fallback boundary across all SDK steps and artifacts. */
export function createRoutedModel(
  initial: PremiumModelId,
  session: InferenceSession,
  factory: (id: PremiumModelId) => LanguageModelV4,
  {
    gateway = false,
    vertexSearch = false,
    retryDelayMs = 120,
  }: { gateway?: boolean; vertexSearch?: boolean; retryDelayMs?: number } = {}
): LanguageModelV4 {
  function isSubscriptionBackedZeroCashModel(model: PremiumModelId): boolean {
    return isVertexModel(model) || isCopilotFallbackModel(model);
  }
  function fallbackTargetFor(
    model: PremiumModelId,
    failure: Failure = "transient",
    visited?: Set<PremiumModelId>
  ): PremiumModelId | null {
    // Owner chain: Gemini 4 Hydrogen -> Neon (escalation & separate Vertex 429 quota pool)
    // -> Copilot Claude Haiku 5.5 (fallback ONLY on Vertex failure/timeout via Cloud VM bridge).
    if (model === HYDROGEN) {
      if (
        failure === "rate" &&
        session.available.includes(NEON) &&
        !visited?.has(NEON)
      ) {
        return NEON;
      }
      return session.available.includes(COPILOT_HAIKU) &&
        !visited?.has(COPILOT_HAIKU)
        ? COPILOT_HAIKU
        : null;
    }
    if (model === NEON) {
      if (
        session.available.includes(COPILOT_HAIKU) &&
        !visited?.has(COPILOT_HAIKU)
      ) {
        return COPILOT_HAIKU;
      }
      if (
        failure === "rate" &&
        session.available.includes(HYDROGEN) &&
        !visited?.has(HYDROGEN)
      ) {
        return HYDROGEN;
      }
      return null;
    }
    if (model === COPILOT_HAIKU || model === TERRA) {
      return null;
    }
    // Synthetic unit-test compatibility when createRoutedModel(LUNA, ...) is tested directly:
    return session.available.includes(TERRA) && !visited?.has(TERRA)
      ? TERRA
      : null;
  }
  function options(
    model: PremiumModelId,
    params: LanguageModelV4CallOptions
  ): LanguageModelV4CallOptions {
    const maxOutputTokens = Math.min(
      params.maxOutputTokens ?? premiumModels[model].outputLimit,
      premiumModels[model].outputLimit
    );
    const requestedEffort = (
      params.providerOptions?.openai as { reasoningEffort?: string } | undefined
    )?.reasoningEffort;
    const safeEffort: "low" | "medium" | "high" | "xhigh" =
      requestedEffort === "xhigh"
        ? "xhigh"
        : requestedEffort === "high"
          ? "high"
          : requestedEffort === "medium"
            ? "medium"
            : requestedEffort === "low" ||
                requestedEffort === "minimal" ||
                requestedEffort === "none"
              ? "low"
              : model === HYDROGEN || model === LUNA
                ? "low"
                : model === NEON
                  ? "high"
                  : "medium";
    if (isSubscriptionBackedZeroCashModel(model)) {
      return {
        ...params,
        maxOutputTokens,
        providerOptions: {
          openai: { reasoningEffort: safeEffort },
        },
      };
    }
    return {
      ...params,
      maxOutputTokens,
      providerOptions: {
        openai: {
          // Deliberately override arbitrary provider options; no paid hosted tools,
          // persistence, premium tiers, 12h cache writes or unbounded reasoning.
          reasoningEffort: safeEffort,
          store: false,
          serviceTier: "default",
          parallelToolCalls: false,
          promptCacheOptions: { mode: "implicit", ttl: "30m" },
        },
        // Keep routing on OpenAI itself: no silent hop to another host or model.
        ...(gateway ? { gateway: { only: ["openai"] } } : {}),
      },
    };
  }
  function recordedOutcome(model: PremiumModelId, error: unknown) {
    const failure = failureKind(error);
    if (failure !== "transient" && failure !== "structured") {
      return failure;
    }
    if (session.toolBoundary) {
      return `${failure}_after_tool`;
    }
    if (session.exposed) {
      return `${failure}_after_output`;
    }
    const target = fallbackTargetFor(model, failure);
    if (!target) {
      return `${failure}_terra_unavailable`;
    }
    if (session.fallbackUsed) {
      return `${failure}_fallback_used`;
    }
    return failure;
  }
  let primaryFailure: (SafeErrorDiagnostic & { model?: string }) | undefined;
  function next(
    model: PremiumModelId,
    error: unknown,
    params: LanguageModelV4CallOptions,
    visited: Set<PremiumModelId>,
    retriedModels: Set<PremiumModelId>,
    stepState?: { stepExposed: boolean; stepToolBoundary: boolean }
  ): { kind: "retry" | "fallback"; reason: string; target: PremiumModelId } {
    const failure = failureKind(error);
    const diag = safeErrorDiagnostic(error);
    const role = visited.size <= 1 ? "primary" : "fallback";
    if (!primaryFailure) {
      primaryFailure = { model, ...diag };
    }
    const target = fallbackTargetFor(model, failure, visited);
    const cancelled = params.abortSignal?.aborted ?? false;
    if (!cancelled) {
      console.error("[routing] model attempt failed", {
        model,
        role,
        ...diag,
      });
    }
    const vertexStepExposed = stepState
      ? stepState.stepExposed
      : session.exposed;
    const vertexToolBoundary = stepState
      ? stepState.stepToolBoundary ||
        hasConsequentialToolInPrompt(params.prompt)
      : session.toolBoundary;

    // On Vertex models, automatically retry ONCE on brief transient errors
    // (or on 429 rate limits when no separate quota pool / fallback lane is available).
    // Permanent errors (400 INVALID_ARGUMENT, auth, billing, safety, work_boundary)
    // and long timeouts are never retried in a loop.
    if (
      isVertexModel(model) &&
      mayRetryVertexSameModel({
        error,
        failure,
        exposed: vertexStepExposed,
        toolBoundary: vertexToolBoundary,
        retried: retriedModels.has(model),
        cancelled,
      }) &&
      (failure === "transient" || target === null)
    ) {
      retriedModels.add(model);
      return { kind: "retry", reason: failure, target: model };
    }

    const allowed =
      target !== null &&
      !visited.has(target) &&
      (isVertexModel(model) && isVertexModel(target)
        ? mayFallbackBetweenVertexModels({
            failure,
            exposed: vertexStepExposed,
            toolBoundary: vertexToolBoundary,
            available: true,
            cancelled,
          })
        : isVertexModel(model) && target === COPILOT_HAIKU
          ? mayFallbackFromVertexToCopilot({
              failure,
              exposed: vertexStepExposed,
              toolBoundary: vertexToolBoundary,
              used: false,
              available: true,
              cancelled,
            })
          : mayFallback({
              failure,
              exposed: session.exposed,
              toolBoundary: session.toolBoundary,
              used: session.fallbackUsed,
              available: true,
              cancelled,
            }));
    if (!allowed || !target) {
      throw new ModelFailure(failure, {
        statusCode: diag.statusCode,
        upstreamCode: diag.code,
        upstreamName: diag.name,
        primaryDiagnostic: primaryFailure,
      });
    }
    session.fallbackUsed = true;
    session.activeModelId = target;
    visited.add(target);
    session.onFallback?.({
      fromModel: model,
      toModel: target,
      reason: failure,
    });
    return { kind: "fallback", reason: failure, target };
  }
  function reserve(
    model: PremiumModelId,
    params: LanguageModelV4CallOptions,
    fallbackReason?: string
  ) {
    params.abortSignal?.throwIfAborted();
    if (
      inputTokenBound({
        prompt: params.prompt,
        tools: params.tools,
        responseFormat: params.responseFormat,
      }) > 272_000
    ) {
      throw new ModelFailure("context");
    }
    const allowWebSearchOnModel = isSubscriptionBackedZeroCashModel(model)
      ? vertexSearch
      : gateway;
    const searchChargePerCall = isSubscriptionBackedZeroCashModel(model)
      ? 0
      : WEB_SEARCH_COST_USD;
    const searchTools =
      params.tools?.filter(
        (tool) => tool.type === "provider" && tool.id === WEB_SEARCH_TOOL_ID
      ).length ?? 0;
    if (
      params.tools?.some(
        (tool) =>
          tool.type !== "function" &&
          !(
            allowWebSearchOnModel &&
            tool.type === "provider" &&
            tool.id === WEB_SEARCH_TOOL_ID
          )
      ) ||
      searchTools > 1
    ) {
      throw new ModelFailure("tool");
    }
    return session.ledger.reserve({
      model,
      // Search is billed outside token usage on AI Gateway; Vertex AI Google
      // Search grounding bills to GCP Ultra credit ($0 Gateway allowance).
      reserveUsd:
        reserveCost(
          model,
          {
            prompt: params.prompt,
            tools: params.tools,
            responseFormat: params.responseFormat,
          },
          params.maxOutputTokens ?? premiumModels[model].outputLimit
        ) +
        searchTools * WEB_SEARCH_MAX_CALLS * searchChargePerCall,
      fallbackReason,
    });
  }
  /**
   * AI Gateway runs the search internally and the model keeps writing in the same
   * call, so searches appear as provider-executed tool calls inside one stream.
   * Count every attempt (failed searches are not billed, but we never under-count).
   */
  function searchCalls(
    parts: readonly { type: string; providerExecuted?: boolean }[]
  ) {
    return parts.filter(
      (part) => part.type === "tool-call" && part.providerExecuted === true
    ).length;
  }
  function exposed(part: LanguageModelV4StreamPart) {
    if (
      part.type.startsWith("tool-") ||
      part.type === "tool-call" ||
      part.type === "tool-result"
    ) {
      session.toolBoundary = true;
    }
    if (
      (part.type === "text-delta" || part.type === "reasoning-delta") &&
      part.delta
    ) {
      session.exposed = true;
    }
  }
  return {
    specificationVersion: "v4",
    provider: "openai.responses",
    modelId: initial,
    supportedUrls: {},
    async doGenerate(params) {
      let model = initial;
      let reason: string | undefined;
      const visited = new Set<PremiumModelId>([initial]);
      const retriedModels = new Set<PremiumModelId>();
      const adapters = new Map<PremiumModelId, LanguageModelV4>();
      const getAdapter = (id: PremiumModelId) => {
        let existing = adapters.get(id);
        if (!existing) {
          existing = factory(id);
          adapters.set(id, existing);
        }
        return existing;
      };
      for (;;) {
        session.activeModelId = model;
        const opts = options(model, params);
        const id = await reserve(model, opts, reason);
        let usage: LanguageModelV4Usage | undefined;
        let searches = 0;
        try {
          const result = await getAdapter(model).doGenerate(opts);
          usage = result.usage;
          searches = searchCalls(result.content);
          if (searches > WEB_SEARCH_MAX_CALLS) {
            throw new ModelFailure("tool");
          }
          const isStructuredJson =
            params.responseFormat?.type === "json" &&
            Boolean(params.responseFormat.schema);
          if (result.finishReason.unified === "error") {
            throw new ModelFailure(
              isStructuredJson ? "structured" : "transient",
              { upstreamCode: "finish_error" }
            );
          }
          if (isStructuredJson && result.finishReason.unified === "length") {
            throw new ModelFailure("structured", {
              upstreamCode: "finish_length",
            });
          }
          if (
            params.responseFormat?.type === "json" &&
            params.responseFormat.schema
          ) {
            try {
              z.fromJSONSchema(params.responseFormat.schema).parse(
                JSON.parse(
                  result.structuredOutputText ??
                    result.content
                      .filter((p) => p.type === "text")
                      .map((p) => p.text)
                      .join("")
                )
              );
            } catch {
              throw new ModelFailure("structured");
            }
          }
          await session.ledger.settle(
            id,
            model,
            "completed",
            usage,
            searches *
              (isSubscriptionBackedZeroCashModel(model)
                ? 0
                : WEB_SEARCH_COST_USD)
          );
          session.exposed = true;
          if (result.content.some((p) => p.type === "tool-call")) {
            session.toolBoundary = true;
          }
          return result;
        } catch (error) {
          await session.ledger.settle(
            id,
            model,
            recordedOutcome(model, error),
            usage,
            searches *
              (isSubscriptionBackedZeroCashModel(model)
                ? 0
                : WEB_SEARCH_COST_USD)
          );
          const decision = next(model, error, params, visited, retriedModels);
          if (decision.kind === "retry") {
            await sleepAbortable(retryDelayMs, params.abortSignal);
          }
          reason = decision.reason;
          model = decision.target;
        }
      }
    },
    doStream(params) {
      let currentReader:
        | ReadableStreamDefaultReader<LanguageModelV4StreamPart>
        | undefined;
      let cancelled = false;
      return Promise.resolve({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async start(controller) {
            let model = initial;
            let reason: string | undefined;
            const visited = new Set<PremiumModelId>([initial]);
            const retriedModels = new Set<PremiumModelId>();
            const adapters = new Map<PremiumModelId, LanguageModelV4>();
            const getAdapter = (id: PremiumModelId) => {
              let existing = adapters.get(id);
              if (!existing) {
                existing = factory(id);
                adapters.set(id, existing);
              }
              return existing;
            };
            for (;;) {
              session.activeModelId = model;
              const opts = options(model, params);
              let id: string | undefined;
              let usage: LanguageModelV4Usage | undefined;
              let searches = 0;
              let stepExposed = false;
              let stepToolBoundary = false;
              try {
                id = await reserve(model, opts, reason);
                const result = await getAdapter(model).doStream(opts);
                currentReader = result.stream.getReader();
                const structured =
                  params.responseFormat?.type === "json" &&
                  params.responseFormat.schema;
                const held: LanguageModelV4StreamPart[] = [];
                let text = "";
                let finished = false;
                while (!cancelled) {
                  params.abortSignal?.throwIfAborted();
                  const item = await currentReader.read();
                  if (item.done) {
                    break;
                  }
                  const part = item.value;
                  if (part.type === "error") {
                    throw part.error;
                  }
                  if (searchCalls([part]) > 0) {
                    searches++;
                    // Cancelling the read ends the Gateway-side loop; no new search starts.
                    if (searches > WEB_SEARCH_MAX_CALLS) {
                      throw new ModelFailure("tool");
                    }
                  }
                  if (part.type === "finish") {
                    usage = part.usage;
                    if (part.finishReason.unified === "error") {
                      throw new ModelFailure(
                        structured
                          ? "structured"
                          : !stepExposed && !stepToolBoundary
                            ? "transient"
                            : "unavailable",
                        { upstreamCode: "finish_error" }
                      );
                    }
                    if (part.finishReason.unified === "length") {
                      throw new ModelFailure(
                        structured ? "structured" : "unavailable",
                        { upstreamCode: "finish_length" }
                      );
                    }
                    finished = true;
                  }
                  if (structured) {
                    held.push(part);
                    if (part.type === "text-delta") {
                      text += part.delta;
                    }
                    if (text.length > 100_000 || held.length > 20_000) {
                      throw new ModelFailure("structured");
                    }
                    // Never buffer or replay a tool call in structured mode.
                    if (part.type.startsWith("tool-")) {
                      session.toolBoundary = true;
                      throw new ModelFailure("tool");
                    }
                  } else if (
                    !session.exposed &&
                    !session.toolBoundary &&
                    [
                      "stream-start",
                      "response-metadata",
                      "text-start",
                      "reasoning-start",
                    ].includes(part.type)
                  ) {
                    held.push(part);
                  } else {
                    exposed(part);
                    if (
                      part.type.startsWith("tool-") ||
                      part.type === "tool-call" ||
                      part.type === "tool-result"
                    ) {
                      stepToolBoundary = true;
                    }
                    if (
                      (part.type === "text-delta" ||
                        part.type === "reasoning-delta") &&
                      part.delta
                    ) {
                      stepExposed = true;
                    }
                    for (const h of held.splice(0)) {
                      controller.enqueue(h);
                    }
                    controller.enqueue(part);
                  }
                }
                if (cancelled) {
                  throw new ModelFailure("cancelled");
                }
                if (!finished) {
                  throw new ModelFailure(
                    !stepExposed && !stepToolBoundary
                      ? "transient"
                      : "unavailable",
                    {
                      upstreamCode:
                        !stepExposed && !stepToolBoundary
                          ? "empty_stream"
                          : "stream_incomplete",
                    }
                  );
                }
                if (structured) {
                  try {
                    z.fromJSONSchema(structured).parse(JSON.parse(text));
                  } catch {
                    throw new ModelFailure("structured");
                  }
                  session.exposed = true;
                }
                await session.ledger.settle(
                  id,
                  model,
                  "completed",
                  usage,
                  searches *
                    (isSubscriptionBackedZeroCashModel(model)
                      ? 0
                      : WEB_SEARCH_COST_USD)
                );
                for (const h of held) {
                  controller.enqueue(h);
                }
                controller.close();
                return;
              } catch (error) {
                await currentReader?.cancel().catch(() => {
                  /* Preserve the original failure. */
                });
                if (id) {
                  await session.ledger.settle(
                    id,
                    model,
                    recordedOutcome(model, error),
                    usage,
                    searches *
                      (isSubscriptionBackedZeroCashModel(model)
                        ? 0
                        : WEB_SEARCH_COST_USD)
                  );
                }
                if (cancelled) {
                  return;
                }
                try {
                  const decision = next(
                    model,
                    error,
                    params,
                    visited,
                    retriedModels,
                    {
                      stepExposed,
                      stepToolBoundary,
                    }
                  );
                  if (decision.kind === "retry") {
                    await sleepAbortable(retryDelayMs, params.abortSignal);
                  }
                  reason = decision.reason;
                  model = decision.target;
                } catch (safeError) {
                  controller.error(safeError);
                  return;
                }
              } finally {
                currentReader?.releaseLock();
                currentReader = undefined;
              }
            }
          },
          async cancel() {
            cancelled = true;
            await currentReader?.cancel();
          },
        }),
      });
    },
  };
}
