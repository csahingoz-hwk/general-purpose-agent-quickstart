import { generateText } from "ai";
import type { Session } from "next-auth";
import { HYDROGEN, NEON, vertexEnabled } from "@/lib/ai/routing/catalog";
import { createCalendarAndGithubTools } from "@/lib/ai/tools/calendar-github-connectors";
import { createCloudComputerTools } from "@/lib/ai/tools/cloud-computer";
import {
  createDelegateTaskTool,
  resolveTaskStore,
} from "@/lib/ai/tools/delegate-task";
import { draftOutboundMessage } from "@/lib/ai/tools/draft-outbound";
import { createExcalidrawDiagramTool } from "@/lib/ai/tools/excalidraw-diagram";
import { createFirecrawlTools } from "@/lib/ai/tools/firecrawl";
import { getCurrentTime } from "@/lib/ai/tools/get-current-time";
import { getFixtures } from "@/lib/ai/tools/get-fixtures";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { createGoogleConnectorTools } from "@/lib/ai/tools/google-connectors";
import { createMacBridgeTools } from "@/lib/ai/tools/mac-bridge";
import { createMemoryTools } from "@/lib/ai/tools/memory-tools";
import { createVisualStudioTools } from "@/lib/ai/tools/visual-studio";
import { webSearch } from "@/lib/ai/tools/web-search";
import { isGithubConnectorEnabled } from "@/lib/connectors/calendar-and-github";
import {
  isFirecrawlConfigured,
  runFirecrawlSearch,
} from "@/lib/connectors/firecrawl";
import { isGoogleConnectorsEnabled } from "@/lib/connectors/google-vault-auth";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { isRoutinesEnabled } from "@/lib/cron/routine-presets";
import {
  createInMemoryMemoryStore,
  createPostgresMemoryStore,
  isMemoryToolsEnabled,
  type MemoryStore,
} from "@/lib/memory/store";
import { reviewActionRisk } from "@/lib/safety/action-review";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";
import type { BackgroundTaskStore } from "@/lib/tasks/runner";
import type { HomeLocation } from "@/lib/temporal";
import { generateUUID } from "@/lib/utils";
import type { SecretVaultStore } from "@/lib/vault/secret-vault";
import { APPROVAL_REQUIRED_VOICE_TOOLS } from "@/lib/voice/live-protocol";

export {
  APPROVAL_REQUIRED_VOICE_TOOLS,
  fillerPhraseForTool,
  LIVE_VOICE_TOOL_DECLARATIONS,
  type LiveToolDeclaration as LiveRealtimeToolDeclaration,
} from "@/lib/voice/live-protocol";

let fallbackMemoryStore: MemoryStore | null = null;
function resolveMemoryStore(override?: MemoryStore): MemoryStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresMemoryStore();
  }
  fallbackMemoryStore ??= createInMemoryMemoryStore();
  return fallbackMemoryStore;
}

export const LONDON_FALLBACK_HOME: HomeLocation = {
  label: "London",
  latitude: 51.5074,
  longitude: -0.1278,
  timeZone: "Europe/London",
  source: "city",
};

/**
 * Core personal/operator tools without `server-only` Drizzle imports so they
 * execute cleanly in both Next.js routes and Node security test suites.
 */
export function buildCoreSharedTools(opts: {
  userId: string;
  homeLocation: HomeLocation | null;
  defaultTimeZone: string | null;
  now?: Date;
  hasUntrustedContext?: boolean;
  vaultStore?: SecretVaultStore;
  memoryStore?: MemoryStore;
  memorySource?: "chat" | "voice";
  taskStore?: BackgroundTaskStore;
  fetchImpl?: typeof fetch;
}) {
  const {
    userId,
    homeLocation,
    defaultTimeZone,
    now = new Date(),
    hasUntrustedContext = false,
    vaultStore,
    fetchImpl,
  } = opts;

  const calGithub = createCalendarAndGithubTools({
    userId,
    vaultStore,
    hasUntrustedContext,
    fetchImpl,
  });

  return {
    getWeather: getWeather({ home: homeLocation }),
    getFixtures: getFixtures({
      now: () => now,
      footballDataKey: process.env.FOOTBALL_DATA_API_KEY ?? null,
    }),
    getCurrentTime: getCurrentTime({ defaultTimeZone }),
    draftOutboundMessage: draftOutboundMessage({ hasUntrustedContext }),
    delegateTask: createDelegateTaskTool({
      userId,
      store: opts.taskStore,
      hasUntrustedContext,
    }),
    ...createCloudComputerTools({
      userId,
      hasUntrustedContext,
      fetchImpl,
    }),
    ...createMacBridgeTools({
      userId,
      hasUntrustedContext,
      fetchImpl,
    }),
    ...createFirecrawlTools({ fetchImpl }),
    ...createVisualStudioTools({
      userId,
      fetchImpl,
    }),
    createExcalidrawDiagram: createExcalidrawDiagramTool(),
    ...(isMemoryToolsEnabled()
      ? createMemoryTools({
          userId,
          store: resolveMemoryStore(opts.memoryStore),
          defaultSource: opts.memorySource ?? "chat",
          dedupePerTurn: true,
        })
      : {}),
    ...(isGoogleConnectorsEnabled()
      ? {
          ...createGoogleConnectorTools({
            userId,
            vaultStore,
            hasUntrustedContext,
            fetchImpl,
          }),
          calendarReadEvents: calGithub.calendarReadEvents,
          calendarCreateDraftEvent: calGithub.calendarCreateDraftEvent,
        }
      : {}),
    ...(isGithubConnectorEnabled()
      ? {
          githubReadPullRequests: calGithub.githubReadPullRequests,
          githubCreateDraftReview: calGithub.githubCreateDraftReview,
        }
      : {}),
  };
}

export type ServerWebSearchSource = {
  title: string;
  url: string;
  snippet?: string;
};

export type ServerWebSearchResult = {
  status: "ok" | "blocked_data_boundary" | "empty" | "error";
  summary: string;
  sources: ServerWebSearchSource[];
  reason?: string;
};

export type GroundedSearchFn = (args: {
  modelId: typeof HYDROGEN | typeof NEON;
  query: string;
  prompt: string;
  timeoutMs: number;
}) => Promise<{
  text: string;
  sources: ServerWebSearchSource[];
}>;

export type ServerWebSearchDeps = {
  fetchImpl?: typeof fetch;
  firecrawlSearch?: typeof runFirecrawlSearch;
  firecrawlConfigured?: boolean;
  vertexEnabledOverride?: boolean;
  groundedSearch?: GroundedSearchFn;
};

function formatProviderErrorReason(err: unknown): string {
  if (err && typeof err === "object") {
    const rec = err as {
      statusCode?: unknown;
      status?: unknown;
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };
    const name = typeof rec.name === "string" ? rec.name : "";
    const msg = typeof rec.message === "string" ? rec.message : "";
    const code = typeof rec.code === "string" ? rec.code : "";
    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      name === "VertexTimeoutError" ||
      code === "vertex_timeout" ||
      /timeout|timed out|aborted/i.test(msg)
    ) {
      return "timeout";
    }
    const statusCode =
      typeof rec.statusCode === "number"
        ? rec.statusCode
        : typeof rec.status === "number"
          ? rec.status
          : undefined;
    if (statusCode !== undefined) {
      return String(statusCode);
    }
    const httpMatch = msg.match(/\bHTTP\s+(\d{3})\b/i);
    if (httpMatch?.[1]) {
      return `HTTP ${httpMatch[1]}`;
    }
    const vertexHttpMatch = msg.match(/\bvertex_http_(\d{3})\b/i);
    if (vertexHttpMatch?.[1]) {
      return vertexHttpMatch[1];
    }
    const bareStatusMatch = msg.match(/\b(429|4\d\d|5\d\d)\b/);
    if (bareStatusMatch?.[1]) {
      return bareStatusMatch[1];
    }
    if (code) {
      return code.slice(0, 60);
    }
    if (msg) {
      return msg
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/fc-[A-Za-z0-9_-]{8,}/g, "[redacted]")
        .replace(/AIza[A-Za-z0-9_-]{8,}/g, "[redacted]")
        .slice(0, 80);
    }
  }
  return "request failed";
}

function buildVertexGroundingPrompt(query: string): string {
  return [
    `Search the web for: ${query}`,
    "Answer ONLY about the exact subject named in the query — never substitute a different league, team, country, or topic.",
    "Give a concise factual 2-sentence summary in the same language as the query.",
  ].join("\n");
}

export async function runServerWebSearch(
  opts: { query: string } & ServerWebSearchDeps
): Promise<ServerWebSearchResult> {
  const query = opts.query.trim().slice(0, 300);
  if (!query) {
    return { status: "empty", summary: "Empty search query.", sources: [] };
  }
  if (containsRestrictedWorkData(query)) {
    return {
      status: "blocked_data_boundary",
      summary:
        "Blocked: employer/Korn Ferry material cannot be sent to external web search.",
      sources: [],
    };
  }

  const failureReasons: string[] = [];
  let primaryAttempted = 0;
  let anyPrimarySucceeded = false;
  let ddgSucceeded = false;

  const recordFailure = (provider: string, detail: string) => {
    const safeDetail = detail.trim().slice(0, 80) || "failed";
    failureReasons.push(`${provider}: ${safeDetail}`);
    console.warn(`[web-search] provider failed: ${provider} (${safeDetail})`);
  };

  // a) Firecrawl search first when configured (limit 5, short timeout)
  const canUseFirecrawl =
    opts.firecrawlConfigured ??
    (Boolean(opts.firecrawlSearch) || isFirecrawlConfigured());

  if (canUseFirecrawl) {
    const fcFn = opts.firecrawlSearch ?? runFirecrawlSearch;
    try {
      const fc = await fcFn({
        query,
        limit: 5,
        fetchImpl: opts.fetchImpl,
        timeoutMs: 10_000,
      });
      if (fc.status === "blocked_data_boundary") {
        return {
          status: "blocked_data_boundary",
          summary: fc.message,
          sources: [],
        };
      }
      if (fc.status === "setup_required") {
        failureReasons.push("firecrawl: not configured");
      } else if (fc.status === "error") {
        primaryAttempted += 1;
        recordFailure(
          "firecrawl",
          formatProviderErrorReason({ message: fc.message })
        );
      } else if (fc.status === "ok") {
        primaryAttempted += 1;
        anyPrimarySucceeded = true;
        const sources: ServerWebSearchSource[] = fc.results
          .slice(0, 5)
          .map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.description,
          }));
        if (sources.length > 0) {
          const rawSummary = sources
            .slice(0, 3)
            .map((s) => (s.snippet ? `${s.title}: ${s.snippet}` : s.title))
            .join(" ");
          return {
            status: "ok",
            summary: fenceUntrustedContent({
              text: rawSummary,
              source: "webSearch",
            }).fencedText,
            sources,
          };
        }
      }
    } catch (err) {
      primaryAttempted += 1;
      recordFailure("firecrawl", formatProviderErrorReason(err));
    }
  } else {
    failureReasons.push("firecrawl: not configured");
  }

  // b) Vertex Google-grounded search: Hydrogen, and on failure retry once with NEON
  const canUseVertex =
    opts.vertexEnabledOverride ??
    (Boolean(opts.groundedSearch) || (vertexEnabled() && !opts.fetchImpl));

  if (canUseVertex) {
    primaryAttempted += 1;
    const groundingPrompt = buildVertexGroundingPrompt(query);
    const vertexTimeoutMs = 12_000;
    const runGrounded: GroundedSearchFn =
      opts.groundedSearch ??
      (async ({ modelId, prompt, timeoutMs }) => {
        const model = (
          await import("@/lib/ai/vertex-model")
        ).createVertexGeminiAdapter(modelId, { timeoutMs });
        const res = await generateText({
          model,
          prompt,
          tools: { webSearch: webSearch() },
          maxOutputTokens: 280,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(timeoutMs),
        });
        const sources: ServerWebSearchSource[] = [];
        for (const s of res.sources ?? []) {
          if ("url" in s && typeof s.url === "string") {
            sources.push({
              title:
                ("title" in s && typeof s.title === "string" && s.title) ||
                s.url,
              url: s.url,
            });
          }
        }
        return { text: res.text || "", sources };
      });

    const vertexAttempts: Array<{
      modelId: typeof HYDROGEN | typeof NEON;
      label: string;
    }> = [
      { modelId: HYDROGEN, label: "vertex hydrogen" },
      { modelId: NEON, label: "vertex neon" },
    ];

    for (const attempt of vertexAttempts) {
      try {
        const res = await runGrounded({
          modelId: attempt.modelId,
          query,
          prompt: groundingPrompt,
          timeoutMs: vertexTimeoutMs,
        });
        anyPrimarySucceeded = true;
        const sources = res.sources.slice(0, 5);
        if (sources.length > 0) {
          const rawSummary =
            res.text.trim() ||
            sources
              .slice(0, 3)
              .map((s) => (s.snippet ? `${s.title}: ${s.snippet}` : s.title))
              .join(" ");
          const fenced = fenceUntrustedContent({
            text: rawSummary,
            source: "webSearch",
          });
          return {
            status: "ok",
            summary: fenced.fencedText,
            sources,
          };
        }
        // Answered cleanly with 0 results — do not burn a Neon retry on an empty response.
        break;
      } catch (err) {
        recordFailure(attempt.label, formatProviderErrorReason(err));
      }
    }
  } else {
    failureReasons.push("vertex: not configured");
  }

  // c) DuckDuckGo instant answer as last resort
  const fetchFn = opts.fetchImpl ?? fetch;
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetchFn(ddgUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      ddgSucceeded = true;
      const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };
      const sources: ServerWebSearchSource[] = [];
      if (data.AbstractURL && data.AbstractText) {
        sources.push({
          title: data.Heading || query,
          url: data.AbstractURL,
          snippet: data.AbstractText.slice(0, 240),
        });
      }
      for (const topic of (data.RelatedTopics ?? []).slice(0, 4)) {
        if (topic.FirstURL && topic.Text) {
          sources.push({
            title: topic.Text.slice(0, 90),
            url: topic.FirstURL,
            snippet: topic.Text.slice(0, 200),
          });
        }
      }
      if (sources.length > 0) {
        const rawSummary = sources
          .slice(0, 3)
          .map((s) => s.snippet || s.title)
          .join(" ");
        return {
          status: "ok",
          summary: fenceUntrustedContent({
            text: rawSummary,
            source: "webSearch",
          }).fencedText,
          sources,
        };
      }
    } else {
      recordFailure("duckduckgo", `HTTP ${res.status}`);
    }
  } catch (err) {
    recordFailure("duckduckgo", formatProviderErrorReason(err));
  }

  if (anyPrimarySucceeded || (primaryAttempted === 0 && ddgSucceeded)) {
    return {
      status: "empty",
      summary: `No verified web results came back right now for "${query}".`,
      sources: [],
    };
  }

  return {
    status: "error",
    summary: `Web search failed right now for "${query}".`,
    sources: [],
    reason: failureReasons.join("; ") || "all search providers failed",
  };
}

export type ExecutedVoiceToolOutcome = {
  toolPart: Record<string, unknown>;
  voiceResult: Record<string, unknown>;
  blocked?: boolean;
};

type ExecutableTool = {
  execute?: (
    input: unknown,
    ctx: { toolCallId: string; messages: never[] }
  ) => Promise<unknown>;
};

async function resolveLazyDbTool(
  toolName: string,
  session: Session,
  userId: string
): Promise<ExecutableTool | undefined> {
  if (toolName === "listMySchedules") {
    const mod = await import("@/lib/ai/tools/list-my-schedules");
    return mod.listMySchedules({ session }) as unknown as ExecutableTool;
  }
  if (toolName === "scheduleTask" && isRoutinesEnabled()) {
    const mod = await import("@/lib/ai/tools/schedule-task");
    return mod.scheduleTask({ session }) as unknown as ExecutableTool;
  }
  if (toolName === "cancelSchedule") {
    const mod = await import("@/lib/ai/tools/cancel-schedule");
    return mod.cancelSchedule({ session }) as unknown as ExecutableTool;
  }
  if (toolName === "setHomeLocation") {
    const mod = await import("@/lib/ai/tools/set-home-location");
    return mod.setHomeLocation({ userId }) as unknown as ExecutableTool;
  }
  if (toolName === "setSoul") {
    const mod = await import("@/lib/ai/tools/set-soul");
    return mod.setSoul({ userId }) as unknown as ExecutableTool;
  }
  return undefined;
}

export async function executeSharedVoiceToolCall(opts: {
  session: Session;
  userId: string;
  timeZone: string;
  homeLocation: HomeLocation | null;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  vaultStore?: SecretVaultStore;
  memoryStore?: MemoryStore;
  memorySource?: "chat" | "voice";
  taskStore?: BackgroundTaskStore;
  fetchImpl?: typeof fetch;
  firecrawlSearch?: typeof runFirecrawlSearch;
  firecrawlConfigured?: boolean;
  vertexEnabledOverride?: boolean;
  groundedSearch?: GroundedSearchFn;
}): Promise<ExecutedVoiceToolOutcome> {
  const { toolCallId, toolName, args } = opts;
  const serializedArgs = JSON.stringify(args ?? {});
  if (containsRestrictedWorkData(serializedArgs)) {
    return {
      blocked: true,
      toolPart: {
        type: `tool-${toolName}`,
        toolCallId,
        state: "output-error",
        input: args,
        errorText:
          "Employer work material cannot be handled on the personal voice lane.",
      },
      voiceResult: {
        status: "blocked_data_boundary",
        spokenInstruction:
          "Politely tell the owner in one sentence that employer-confidential work material can't be handled in personal voice mode.",
      },
    };
  }

  if (APPROVAL_REQUIRED_VOICE_TOOLS.has(toolName)) {
    const review = reviewActionRisk({
      toolName,
      input: args,
      hasUntrustedContext: true,
    });
    const approvalId = `voice-approval-${generateUUID()}`;
    return {
      toolPart: {
        type: `tool-${toolName}`,
        toolCallId,
        state: "approval-requested",
        input: args,
        approval: { id: approvalId },
      },
      voiceResult: {
        status: "awaiting_approval",
        approvalId,
        digest: review.digest,
        riskLevel: review.riskLevel,
        spokenInstruction:
          "Tell the owner in ONE concise sentence that you placed an approval card in the chat so they can review and tap Allow before anything is saved or sent.",
      },
    };
  }

  if (toolName === "webSearch") {
    const query = typeof args.query === "string" ? args.query : "";
    const searchRes = await runServerWebSearch({
      query,
      fetchImpl: opts.fetchImpl,
      firecrawlSearch: opts.firecrawlSearch,
      firecrawlConfigured: opts.firecrawlConfigured,
      vertexEnabledOverride: opts.vertexEnabledOverride,
      groundedSearch: opts.groundedSearch,
    });
    if (searchRes.status === "error") {
      return {
        blocked: false,
        toolPart: {
          type: "tool-webSearch",
          toolCallId,
          state: "output-available",
          input: { query },
          output: {
            results: [],
            searchUnavailable: true,
            ...(searchRes.reason ? { reason: searchRes.reason } : {}),
          },
        },
        voiceResult: {
          status: "error",
          summary: searchRes.summary,
          sources: [],
          ...(searchRes.reason ? { reason: searchRes.reason } : {}),
          spokenInstruction:
            "Tell the owner in one short sentence, in the owner's language, that web search failed right now and offer to retry — never answer about a different league, team, or topic.",
        },
      };
    }
    return {
      blocked: searchRes.status === "blocked_data_boundary",
      toolPart: {
        type: "tool-webSearch",
        toolCallId,
        state: "output-available",
        input: { query },
        output: {
          results: searchRes.sources.map((s) => ({
            title: s.title,
            url: s.url,
            snippet: s.snippet ?? "",
          })),
        },
      },
      voiceResult: {
        status: searchRes.status,
        summary: searchRes.summary,
        sources: searchRes.sources.map((s) => ({ title: s.title, url: s.url })),
        ...(searchRes.status === "empty"
          ? {
              spokenInstruction:
                "Tell the owner in one short sentence, in the owner's language, that no web results came back right now and offer to retry — never answer about a different league, team, or topic.",
            }
          : {}),
      },
    };
  }

  const core = buildCoreSharedTools({
    userId: opts.userId,
    homeLocation: opts.homeLocation ?? LONDON_FALLBACK_HOME,
    defaultTimeZone: opts.timeZone || "Europe/London",
    vaultStore: opts.vaultStore,
    memoryStore: opts.memoryStore,
    memorySource: "voice",
    taskStore: resolveTaskStore(opts.taskStore),
    fetchImpl: opts.fetchImpl,
  });

  const targetTool =
    ((core as Record<string, unknown>)[toolName] as
      | ExecutableTool
      | undefined) ??
    (await resolveLazyDbTool(toolName, opts.session, opts.userId));

  if (!targetTool || typeof targetTool.execute !== "function") {
    return {
      toolPart: {
        type: `tool-${toolName}`,
        toolCallId,
        state: "output-error",
        input: args,
        errorText: "This tool is not available right now.",
      },
      voiceResult: {
        status: "unavailable",
        spokenInstruction:
          "Briefly tell the owner that capability isn't switched on right now.",
      },
    };
  }

  const rawOutput = await targetTool.execute(args, {
    toolCallId,
    messages: [],
  });

  if (
    toolName === "getWeather" &&
    rawOutput &&
    typeof rawOutput === "object" &&
    "current" in rawOutput
  ) {
    const forecast = rawOutput as {
      cityName?: string;
      current?: { temperature_2m?: number };
      current_units?: { temperature_2m?: string };
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: Array<number | null>;
      };
    };
    return {
      toolPart: {
        type: "tool-getWeather",
        toolCallId,
        state: "output-available",
        input: args,
        output: rawOutput,
      },
      voiceResult: {
        status: "ok",
        city: forecast.cityName ?? "London",
        currentTemperature: forecast.current?.temperature_2m,
        unit: forecast.current_units?.temperature_2m ?? "°C",
        todayHigh: forecast.daily?.temperature_2m_max?.[0],
        todayLow: forecast.daily?.temperature_2m_min?.[0],
        rainChancePercent:
          forecast.daily?.precipitation_probability_max?.[0] ?? 0,
        tomorrowHigh: forecast.daily?.temperature_2m_max?.[1],
        tomorrowLow: forecast.daily?.temperature_2m_min?.[1],
      },
    };
  }

  if (
    rawOutput &&
    typeof rawOutput === "object" &&
    (rawOutput as { status?: string }).status === "setup_required"
  ) {
    const isFirecrawl = toolName.startsWith("firecrawl");
    const isGithub = toolName.startsWith("github");
    const provider = isFirecrawl ? "firecrawl" : isGithub ? "github" : "google";
    const enrichedOutput = {
      ...(rawOutput as Record<string, unknown>),
      connectProvider: provider,
    };
    return {
      toolPart: {
        type: `tool-${toolName}`,
        toolCallId,
        state: "output-available",
        input: args,
        output: enrichedOutput,
      },
      voiceResult: {
        status: "setup_required",
        provider,
        spokenInstruction: isFirecrawl
          ? "Tell the owner in ONE sentence that Firecrawl isn't connected yet and point them to the Setup checklist card you placed in the chat (/setup#setup-firecrawl)."
          : isGithub
            ? "Tell the owner in ONE sentence that GitHub isn't connected yet and they can tap the Connect GitHub button you just placed in the chat. Never say 'I don't have access'."
            : "Tell the owner in ONE sentence that Google isn't connected yet and they can tap the Connect Google button you just placed in the chat. Never say 'I don't have access'.",
      },
    };
  }

  return {
    toolPart: {
      type: `tool-${toolName}`,
      toolCallId,
      state: "output-available",
      input: args,
      output: rawOutput,
    },
    voiceResult:
      rawOutput && typeof rawOutput === "object"
        ? (rawOutput as Record<string, unknown>)
        : { result: rawOutput },
  };
}
