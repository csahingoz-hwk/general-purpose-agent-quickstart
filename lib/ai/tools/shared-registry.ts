import { generateText } from "ai";
import type { Session } from "next-auth";
import { HYDROGEN, vertexEnabled } from "@/lib/ai/routing/catalog";
import { createCalendarAndGithubTools } from "@/lib/ai/tools/calendar-github-connectors";
import { createCloudComputerTools } from "@/lib/ai/tools/cloud-computer";
import {
  createDelegateTaskTool,
  resolveTaskStore,
} from "@/lib/ai/tools/delegate-task";
import { draftOutboundMessage } from "@/lib/ai/tools/draft-outbound";
import { getCurrentTime } from "@/lib/ai/tools/get-current-time";
import { getFixtures } from "@/lib/ai/tools/get-fixtures";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { createGoogleConnectorTools } from "@/lib/ai/tools/google-connectors";
import { createMacBridgeTools } from "@/lib/ai/tools/mac-bridge";
import { createMemoryTools } from "@/lib/ai/tools/memory-tools";
import { webSearch } from "@/lib/ai/tools/web-search";
import { isGithubConnectorEnabled } from "@/lib/connectors/calendar-and-github";
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

export async function runServerWebSearch(opts: {
  query: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  status: "ok" | "blocked_data_boundary" | "empty";
  summary: string;
  sources: Array<{ title: string; url: string; snippet?: string }>;
}> {
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

  const canUseVertex = vertexEnabled();

  if (canUseVertex && !opts.fetchImpl) {
    try {
      const model = (
        await import("@/lib/ai/vertex-model")
      ).createVertexGeminiAdapter(HYDROGEN);
      const res = await generateText({
        model,
        prompt: `Search the web for: ${query}\nGive a concise factual 2-sentence summary.`,
        tools: { webSearch: webSearch() },
        maxOutputTokens: 280,
        abortSignal: AbortSignal.timeout(12_000),
      });
      const sources: Array<{ title: string; url: string; snippet?: string }> =
        [];
      for (const s of res.sources ?? []) {
        if ("url" in s && typeof s.url === "string") {
          sources.push({
            title:
              ("title" in s && typeof s.title === "string" && s.title) || s.url,
            url: s.url,
          });
        }
      }
      const fenced = fenceUntrustedContent({
        text: res.text || "",
        source: "webSearch",
      });
      return {
        status: "ok",
        summary: fenced.fencedText,
        sources: sources.slice(0, 5),
      };
    } catch {
      /* fall through to lightweight public search fallback */
    }
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetchFn(ddgUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };
      const sources: Array<{ title: string; url: string; snippet?: string }> =
        [];
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
    }
  } catch {
    /* ignore */
  }

  return {
    status: "empty",
    summary: `No verified web results came back right now for "${query}".`,
    sources: [],
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
    });
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
    const isGithub = toolName.startsWith("github");
    const provider = isGithub ? "github" : "google";
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
        spokenInstruction: isGithub
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
