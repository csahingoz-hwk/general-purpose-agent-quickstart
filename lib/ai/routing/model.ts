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
  LUNA,
  type PremiumModelId,
  premiumModels,
  TERRA,
  WEB_SEARCH_COST_USD,
  WEB_SEARCH_MAX_CALLS,
  WEB_SEARCH_TOOL_ID,
} from "./catalog";
import { inputTokenBound, reserveCost } from "./cost";
import { gatewaySlug } from "./gateway";
import { failureKind, ModelFailure, mayFallback } from "./policy";
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

/** One request shares its exposure/tool/fallback boundary across all SDK steps and artifacts. */
export function createRoutedModel(
  initial: PremiumModelId,
  session: InferenceSession,
  factory: (id: PremiumModelId) => LanguageModelV4,
  { gateway = false }: { gateway?: boolean } = {}
): LanguageModelV4 {
  function options(
    model: PremiumModelId,
    params: LanguageModelV4CallOptions
  ): LanguageModelV4CallOptions {
    const maxOutputTokens = Math.min(
      params.maxOutputTokens ?? premiumModels[model].outputLimit,
      premiumModels[model].outputLimit
    );
    return {
      ...params,
      maxOutputTokens,
      providerOptions: {
        openai: {
          // Deliberately override arbitrary provider options; no paid hosted tools,
          // persistence, premium tiers, 12h cache writes or unbounded reasoning.
          reasoningEffort: model === LUNA ? "low" : "medium",
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
    if (model === LUNA && !session.available.includes(TERRA)) {
      return `${failure}_terra_unavailable`;
    }
    if (session.fallbackUsed) {
      return `${failure}_fallback_used`;
    }
    return failure;
  }
  function next(
    model: PremiumModelId,
    error: unknown,
    params: LanguageModelV4CallOptions
  ) {
    const failure = failureKind(error);
    if (
      model !== LUNA ||
      !mayFallback({
        failure,
        exposed: session.exposed,
        toolBoundary: session.toolBoundary,
        used: session.fallbackUsed,
        available: session.available.includes(TERRA),
        cancelled: params.abortSignal?.aborted ?? false,
      })
    ) {
      throw new ModelFailure(failure);
    }
    session.fallbackUsed = true;
    return failure;
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
    // The only provider-executed tool ever allowed is AI Gateway web search,
    // and only on the Gateway lane. Anything else (OpenAI hosted tools, etc.) fails.
    const searchTools =
      params.tools?.filter(
        (tool) => tool.type === "provider" && tool.id === WEB_SEARCH_TOOL_ID
      ).length ?? 0;
    if (
      params.tools?.some(
        (tool) =>
          tool.type !== "function" &&
          !(
            gateway &&
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
      // Search is billed outside token usage: reserve the capped worst case so a
      // call whose token usage is never reported cannot under-count it.
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
        searchTools * WEB_SEARCH_MAX_CALLS * WEB_SEARCH_COST_USD,
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
      for (;;) {
        const opts = options(model, params);
        const id = await reserve(model, opts, reason);
        let usage: LanguageModelV4Usage | undefined;
        let searches = 0;
        try {
          const result = await factory(model).doGenerate(opts);
          usage = result.usage;
          searches = searchCalls(result.content);
          if (searches > WEB_SEARCH_MAX_CALLS) {
            throw new ModelFailure("tool");
          }
          if (
            result.finishReason.unified === "length" ||
            result.finishReason.unified === "error"
          ) {
            throw new ModelFailure(
              params.responseFormat?.type === "json"
                ? "structured"
                : "unavailable"
            );
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
            searches * WEB_SEARCH_COST_USD
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
            searches * WEB_SEARCH_COST_USD
          );
          reason = next(model, error, params);
          model = TERRA;
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
            for (;;) {
              const opts = options(model, params);
              let id: string | undefined;
              let usage: LanguageModelV4Usage | undefined;
              let searches = 0;
              try {
                id = await reserve(model, opts, reason);
                const result = await factory(model).doStream(opts);
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
                    if (
                      part.finishReason.unified === "length" ||
                      part.finishReason.unified === "error"
                    ) {
                      throw new ModelFailure(
                        structured ? "structured" : "unavailable"
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
                  throw new ModelFailure("unavailable");
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
                  searches * WEB_SEARCH_COST_USD
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
                    searches * WEB_SEARCH_COST_USD
                  );
                }
                if (cancelled) {
                  return;
                }
                try {
                  reason = next(model, error, params);
                  model = TERRA;
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
