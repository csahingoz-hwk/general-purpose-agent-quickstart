import {
  generateText,
  isStepCount,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { Session } from "next-auth";
import { selectToolsWithRanking } from "@/lib/ai/context/select-tools";
import { systemPrompt } from "@/lib/ai/prompts";
import {
  COPILOT_HAIKU,
  copilotFallbackEnabled,
  HYDROGEN,
} from "@/lib/ai/routing/catalog";
import { createUsageLedger } from "@/lib/ai/routing/ledger";
import {
  type InferenceSession,
  inferenceSession,
} from "@/lib/ai/routing/session";
import {
  createMemoryTurnState,
  dedupeAssistantMemoryParts,
} from "@/lib/ai/tools/memory-tools";
import {
  buildCoreSharedTools,
  LONDON_FALLBACK_HOME,
} from "@/lib/ai/tools/shared-registry";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { textLocale } from "@/lib/fixtures";
import {
  buildGroupedMemoryPromptBlock,
  isAllowedShortKornFerryContextFact,
} from "@/lib/memory/bulk-import";
import {
  createInMemoryMemoryStore,
  createPostgresMemoryStore,
  type MemoryStore,
} from "@/lib/memory/store";
import {
  type ApprovalPreferencesStore,
  applyOwnerPoliciesToToolSet,
  resolveApprovalPreferencesStore,
  type ToolExecutionJournalStore,
} from "@/lib/safety/approval-preferences";
import type { BackgroundTaskStore } from "@/lib/tasks/runner";
import { contextBlock, type HomeLocation, validTimeZone } from "@/lib/temporal";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import type { SecretVaultStore } from "@/lib/vault/secret-vault";
import {
  formatVoiceRecentContextBlock,
  type VoiceRecentTurn,
} from "./live-session";

export function stripMarkdownForSpeech(raw: string): string {
  return raw
    .replace(/<\/?untrusted_content[^>]*>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function buildFallbackSpokenSummary(
  toolParts: readonly Record<string, unknown>[],
  locale: "en" | "tr"
): string {
  const hasApproval = toolParts.some((p) => p.state === "approval-requested");
  const hasDraftSaved = toolParts.some((p) => {
    const out = p.output as { status?: string } | undefined;
    return (
      out?.status === "draft_created_unsent" ||
      out?.status === "draft_event_created" ||
      out?.status === "draft_doc_created"
    );
  });
  const hasSetupRequired = toolParts.some((p) => {
    const out = p.output as { status?: string } | undefined;
    return (
      out?.status === "setup_required" || out?.status === "reconnect_required"
    );
  });

  if (hasSetupRequired) {
    return locale === "tr"
      ? "Google hesabın henüz bağlı değil; sohbete tek dokunuşla bağlama kartı ekledim."
      : "Your Google account isn't connected yet — I placed a one-tap Connect card in the chat.";
  }
  if (hasApproval) {
    return locale === "tr"
      ? "İstediğin taslak için onay kartını sohbete ekledim; inceleyip kaydedebilirsin."
      : "I checked that and placed the draft approval card in the chat so you can review and save it.";
  }
  if (hasDraftSaved) {
    return locale === "tr"
      ? "Taslağı hazırlayıp taslaklar klasörüne kaydettim, henüz gönderilmedi."
      : "I prepared and saved the unsent draft for you.";
  }
  return locale === "tr"
    ? "İsteğini kontrol edip sonucu sohbete ekledim."
    : "I checked that with the text assistant and added the details to the chat.";
}

export type VoiceTextAgentHandoffResult = {
  blocked: boolean;
  locale: "en" | "tr";
  spokenSummary: string;
  parts: Record<string, unknown>[];
  toolPart: Record<string, unknown>;
  voiceResult: Record<string, unknown>;
};

function resolveVoiceMemoryStore(override?: MemoryStore): MemoryStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresMemoryStore();
  }
  return createInMemoryMemoryStore();
}

/**
 * Item 8: Hands real personal operator work (Gmail inbox, reply drafts,
 * Google Calendar, Drive, routines, memory) from a Live Voice call directly
 * to the SAME text agent pipeline — sharing tool selection, memory auto-recall,
 * approval modes/rules, and multi-step execution — and returns a natural
 * spoken summary for the voice session to speak aloud.
 */
export async function executeVoiceTextAgentHandoff(opts: {
  session: Session;
  userId: string;
  chatId: string;
  request: string;
  locale?: "en" | "tr";
  timeZone?: string | null;
  homeLocation?: HomeLocation | null;
  recentTurns?: VoiceRecentTurn[];
  vaultStore?: SecretVaultStore;
  memoryStore?: MemoryStore;
  approvalPrefsStore?: ApprovalPreferencesStore;
  journalStore?: ToolExecutionJournalStore;
  taskStore?: BackgroundTaskStore;
  fetchImpl?: typeof fetch;
  modelOverride?: LanguageModel;
  getLanguageModelImpl?: (modelId: string) => LanguageModel;
}): Promise<VoiceTextAgentHandoffResult> {
  const cleanRequest = opts.request.trim();
  const detectedLocale = opts.locale ?? textLocale(cleanRequest);

  if (!cleanRequest) {
    const emptyMsg =
      detectedLocale === "tr"
        ? "Ne yapmamı istediğini tekrar söyler misin?"
        : "Could you repeat what you'd like me to check?";
    const part = { type: "text", text: emptyMsg };
    return {
      blocked: false,
      locale: detectedLocale,
      spokenSummary: emptyMsg,
      parts: [part],
      toolPart: part,
      voiceResult: { status: "empty", spokenSummary: emptyMsg },
    };
  }

  if (containsRestrictedWorkData(cleanRequest)) {
    const blockedMsg =
      detectedLocale === "tr"
        ? "İşveren gizli verileri kişisel ses modunda işlenemiyor."
        : "Employer-confidential work material can't be handled in personal voice mode.";
    const toolPart = {
      type: "tool-handOffToTextAgent",
      toolCallId: `voice-handoff-${generateUUID()}`,
      state: "output-error",
      input: { request: cleanRequest },
      errorText: blockedMsg,
    };
    return {
      blocked: true,
      locale: detectedLocale,
      spokenSummary: blockedMsg,
      parts: [toolPart],
      toolPart,
      voiceResult: {
        status: "blocked_data_boundary",
        spokenInstruction: `Say in one short sentence: ${blockedMsg}`,
      },
    };
  }

  const memStore = resolveVoiceMemoryStore(opts.memoryStore);
  const prefsStore = resolveApprovalPreferencesStore(opts.approvalPrefsStore);
  const explicitTz = validTimeZone(opts.timeZone);
  const homeTz = validTimeZone(opts.homeLocation?.timeZone);
  const resolvedTz = explicitTz ?? homeTz ?? "Europe/London";

  const [facts, journalEntries, approvalSettings, toolRules] =
    await Promise.all([
      memStore.listProfileFacts({ userId: opts.userId }).catch(() => []),
      memStore
        .listJournalEntries({ userId: opts.userId, limit: 20 })
        .catch(() => []),
      prefsStore.getSettings(opts.userId).catch(() => ({
        userId: opts.userId,
        approvalMode: "ask_every_time" as const,
        uiLocale: "auto" as const,
        updatedAt: new Date(0).toISOString(),
      })),
      prefsStore.listToolRules(opts.userId).catch(() => []),
    ]);

  const safeFacts = facts.filter(
    (f) =>
      !containsRestrictedWorkData(`${f.key} ${f.value}`) ||
      isAllowedShortKornFerryContextFact(f.value)
  );
  const memoryBlock = buildGroupedMemoryPromptBlock(safeFacts, cleanRequest, {
    maxFacts: 60,
    maxChars: 4500,
    journalEntries,
  });

  const userMessage: ChatMessage = {
    id: generateUUID(),
    role: "user",
    parts: [{ type: "text", text: cleanRequest }],
  };

  const { activeTools: selectedToolNames } = selectToolsWithRanking(
    [userMessage],
    true,
    false,
    { googleConnectedAndHealthy: true }
  );

  const coreTools = buildCoreSharedTools({
    userId: opts.userId,
    homeLocation: opts.homeLocation ?? LONDON_FALLBACK_HOME,
    defaultTimeZone: resolvedTz,
    fixtureTimeZone: explicitTz ?? homeTz ?? null,
    locale: detectedLocale,
    hasUntrustedContext:
      selectedToolNames.includes("gmailReadMessages") ||
      selectedToolNames.includes("calendarReadEvents") ||
      selectedToolNames.includes("driveReadFiles"),
    vaultStore: opts.vaultStore,
    memoryStore: memStore,
    memorySource: "voice",
    taskStore: opts.taskStore,
    fetchImpl: opts.fetchImpl,
  });

  const governedTools = applyOwnerPoliciesToToolSet(
    coreTools as Record<string, unknown>,
    {
      userId: opts.userId,
      chatId: opts.chatId,
      approvalMode: approvalSettings.approvalMode,
      rules: toolRules,
      journalStore: opts.journalStore,
    }
  ) as ToolSet;

  const activeTools = selectedToolNames.filter((name) => name in governedTools);

  const temporalContext = contextBlock({
    now: new Date(),
    timeZone: resolvedTz,
    home: opts.homeLocation ?? LONDON_FALLBACK_HOME,
  });
  const recentContextBlock = formatVoiceRecentContextBlock(opts.recentTurns, {
    maxTurns: 20,
    maxChars: 6000,
  });

  const instructions = `${systemPrompt({
    supportsTools: true,
    includeArtifacts: false,
    includeFixtures: activeTools.includes("getFixtures"),
    includeOperatorTools: true,
    googleConnected: true,
    context: [temporalContext, memoryBlock, recentContextBlock]
      .filter(Boolean)
      .join("\n\n"),
  })}\n\n## Voice Handoff Output Rule\nYour final reply will be spoken aloud on a live voice call (${detectedLocale === "tr" ? "Turkish" : "English"}): keep it warm, plain-spoken, 1–3 concise sentences, with zero markdown or raw URLs.`;

  const availableModels = [
    HYDROGEN,
    ...(copilotFallbackEnabled() ? [COPILOT_HAIKU] : []),
  ];
  const execution: InferenceSession = {
    ledger: createUsageLedger(opts.userId, userMessage.id),
    available: availableModels,
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    activeModelId: HYDROGEN,
    memoryTurnState: createMemoryTurnState(),
  };

  const agentRun = await inferenceSession.run(execution, async () => {
    const model =
      opts.modelOverride ??
      (opts.getLanguageModelImpl
        ? opts.getLanguageModelImpl(HYDROGEN)
        : (await import("@/lib/ai/providers")).getLanguageModel(HYDROGEN));

    return generateText({
      model,
      system: instructions,
      prompt: cleanRequest,
      tools: governedTools,
      ...(activeTools.length > 0 ? { activeTools } : {}),
      stopWhen: isStepCount(6),
      maxOutputTokens: 512,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(45_000),
    });
  });

  const rawToolParts: (Record<string, unknown> & { type: string })[] = [];
  for (const step of agentRun.steps ?? []) {
    const resultByCallId = new Map<string, unknown>();
    for (const tr of step.toolResults ?? []) {
      resultByCallId.set(tr.toolCallId, tr.output);
    }
    for (const tc of step.toolCalls ?? []) {
      const safeCallId = tc.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_");
      if (resultByCallId.has(tc.toolCallId)) {
        const out = resultByCallId.get(tc.toolCallId);
        const enrichedOut =
          out &&
          typeof out === "object" &&
          (out as { status?: string }).status === "setup_required"
            ? {
                ...(out as Record<string, unknown>),
                connectProvider: tc.toolName.startsWith("github")
                  ? "github"
                  : "google",
              }
            : out;
        rawToolParts.push({
          type: `tool-${tc.toolName}`,
          toolCallId: safeCallId,
          state: "output-available",
          input: tc.input,
          output: enrichedOut,
        });
      } else {
        // Tool paused at approval gate (`needsApproval: true`)
        rawToolParts.push({
          type: `tool-${tc.toolName}`,
          toolCallId: safeCallId,
          state: "approval-requested",
          input: tc.input,
          approval: { id: `voice-approval-${generateUUID()}` },
        });
      }
    }
  }
  const toolParts = dedupeAssistantMemoryParts(rawToolParts);

  const cleanedSpoken = stripMarkdownForSpeech(agentRun.text ?? "");
  const spokenSummary =
    cleanedSpoken || buildFallbackSpokenSummary(toolParts, detectedLocale);

  const parts: Record<string, unknown>[] = [...toolParts];
  if (spokenSummary) {
    parts.push({ type: "text", text: spokenSummary });
  }
  const primaryPart =
    toolParts[0] ??
    ({ type: "text", text: spokenSummary } as Record<string, unknown>);

  return {
    blocked: false,
    locale: detectedLocale,
    spokenSummary,
    parts,
    toolPart: primaryPart,
    voiceResult: {
      status: toolParts.some((p) => p.state === "approval-requested")
        ? "awaiting_approval"
        : "ok",
      spokenSummary,
      cardsPlaced: toolParts.map((p) => String(p.type).replace(/^tool-/, "")),
      spokenInstruction: `Speak this result naturally to the owner in ${detectedLocale === "tr" ? "Turkish" : "English"}: ${spokenSummary}`,
    },
  };
}
