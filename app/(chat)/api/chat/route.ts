import { ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessageStreamOutcome,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";
import { auth } from "@/app/(auth)/auth";
import { resolveLiveCapabilityManifest } from "@/lib/ai/capability-manifest";
import {
  budgetModelMessages,
  DEFAULT_REPLY_TOKENS,
  estimateToolSchemaTokens,
  followUpBudget,
  GROQ_TOOL_TURN_BUDGET,
} from "@/lib/ai/context/budget";
import { safeModelError } from "@/lib/ai/context/errors";
import {
  needsArtifactInstructions,
  selectActiveTools,
  selectToolsWithRanking,
} from "@/lib/ai/context/select-tools";
import {
  applyApprovalResponses,
  prepareRetry,
  replyForStorage,
  safeUIStream,
} from "@/lib/ai/conversation-state";
import { resolveTurnModelAndEffort } from "@/lib/ai/escalation";
import { getRequestModelAvailability } from "@/lib/ai/model-runtime";
import {
  chatModels,
  getCapabilities,
  getModelDisplayName,
  SYNTHETIC_SDK7_FIXTURE_MODELS,
} from "@/lib/ai/models";
import { createMultiSearchRecoveryStream } from "@/lib/ai/multi-search-fallback";
import { systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  COPILOT_HAIKU,
  copilotFallbackEnabled,
  isPremiumModel,
  isSyntheticSdk7FixtureMode,
  premiumModels,
  webSearchLane,
} from "@/lib/ai/routing/catalog";
import { createUsageLedger } from "@/lib/ai/routing/ledger";
import { failureKind } from "@/lib/ai/routing/policy";
import {
  type InferenceSession,
  inferenceSession,
} from "@/lib/ai/routing/session";
import { askUserQuestion } from "@/lib/ai/tools/ask-question";
import { createCalendarAndGithubTools } from "@/lib/ai/tools/calendar-github-connectors";
import { cancelSchedule } from "@/lib/ai/tools/cancel-schedule";
import { createCloudComputerTools } from "@/lib/ai/tools/cloud-computer";
import { createDocument } from "@/lib/ai/tools/create-document";
import { createDelegateTaskTool } from "@/lib/ai/tools/delegate-task";
import { demoInbox } from "@/lib/ai/tools/demo-inbox";
import { draftOutboundMessage } from "@/lib/ai/tools/draft-outbound";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { createMediaTools } from "@/lib/ai/tools/generate-media";
import { getCurrentTime } from "@/lib/ai/tools/get-current-time";
import { getFixtures } from "@/lib/ai/tools/get-fixtures";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { createGoogleConnectorTools } from "@/lib/ai/tools/google-connectors";
import { listMySchedules } from "@/lib/ai/tools/list-my-schedules";
import { createMacBridgeTools } from "@/lib/ai/tools/mac-bridge";
import { createMemoryTools } from "@/lib/ai/tools/memory-tools";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { scheduleTask } from "@/lib/ai/tools/schedule-task";
import { setHomeLocation } from "@/lib/ai/tools/set-home-location";
import { setSoul } from "@/lib/ai/tools/set-soul";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { webSearch } from "@/lib/ai/tools/web-search";
import {
  composeTeammateSoul,
  createPostgresBotRosterStore,
  extractRequestedBotSlug,
  filterFactsForBot,
} from "@/lib/bots/roster";
import { isCloudComputerConfigured } from "@/lib/cloud-computer/client";
import { isGithubConnectorEnabled } from "@/lib/connectors/calendar-and-github";
import { isGoogleConnectorsEnabled } from "@/lib/connectors/google-vault-auth";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { isProductionEnvironment } from "@/lib/constants";
import { isRoutinesEnabled } from "@/lib/cron/routine-presets";
import { acquireChatLock } from "@/lib/db/chat-lock";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessagesByChatId,
  getUserHomeLocation,
  getUserSoul,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { prepareMessagesWithAttachments } from "@/lib/files/parse-attachment";
import { isMacBridgeConfigured } from "@/lib/mac-bridge/client";
import { isMediaStudioEnabled } from "@/lib/media/media-studio";
import {
  buildGroupedMemoryPromptBlock,
  extractExplicitRememberFact,
  isAllowedShortKornFerryContextFact,
} from "@/lib/memory/bulk-import";
import {
  createPostgresMemoryStore,
  isMemoryToolsEnabled,
  type ProfileFact,
} from "@/lib/memory/store";
import { attachOpenUiPart } from "@/lib/openui/attach";
import { isVisualCandidateTurn } from "@/lib/openui/structured-answer";
import { checkIpRateLimit } from "@/lib/ratelimit";
import {
  createPostgresSkillStore,
  extractRequestedSkillSlug,
  formatSkillPromptBlock,
} from "@/lib/skills/library";
import { contextBlock, validTimeZone } from "@/lib/temporal";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 180;

// When using Model = Sonnet 4.6 we get a bug: ""
// Composio generates tool call IDs that can contain characters outside the
// pattern Anthropic (and some other providers) require: ^[a-zA-Z0-9_-]+$
// We sanitize all toolCallIds in message history before sending to the model.
const TOOL_ID_INVALID_CHARS = /[^a-zA-Z0-9_-]/g;

function sanitizeToolCallIds(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (
        "toolCallId" in part &&
        typeof part.toolCallId === "string" &&
        part.toolCallId.length > 0
      ) {
        return {
          ...part,
          toolCallId: part.toolCallId.replace(TOOL_ID_INVALID_CHARS, "_"),
        };
      }
      return part;
    }),
  }));
}

/**
 * Earlier web-search results are untrusted, can be large and are provider-
 * executed (AI Gateway ran them), so they are never replayed to the model: the
 * assistant's own cited answer in the same message carries what mattered. The
 * stored parts stay complete for the UI.
 */
function dropWebSearchHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter(
      (part) =>
        (part.type as string) !== "tool-webSearch" &&
        part.type !== "data-openui" &&
        part.type !== "data-turn-status" &&
        part.type !== "data-task-step" &&
        part.type !== "data-model-used"
    ),
  }));
}

let globalStreamContext: ResumableStreamContext | null = null;

function getStreamContext() {
  if (!process.env.REDIS_URL?.trim()) {
    return null;
  }
  if (!globalStreamContext) {
    try {
      // Ephemeral Pub/Sub + sentinel only (eph-stream:*); chat history stays in Postgres.
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
        keyPrefix: "eph-stream",
      });
    } catch (_) {
      return null;
    }
  }
  return globalStreamContext;
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  let releaseLock: (() => Promise<void>) | null = null;
  let streamOwnsLock = false;
  try {
    const {
      id,
      message,
      messages,
      editedDraftApproval,
      selectedChatModel,
      selectedBotSlug,
      selectedVisibilityType,
      timeZone,
      retry,
    } = requestBody;

    const [, session, availability] = await Promise.all([
      Promise.race([
        checkBotId().catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 200)),
      ]),
      auth(),
      getRequestModelAvailability(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    if (availability.status !== "ready") {
      return new ChatbotError("offline:model_setup").toResponse();
    }
    if (!availability.models.some((model) => model.id === selectedChatModel)) {
      return new ChatbotError("bad_request:api").toResponse();
    }
    let chatModel = selectedChatModel;

    const memoryStore =
      session.user.type !== "guest" && isMemoryToolsEnabled()
        ? createPostgresMemoryStore()
        : null;
    const [
      ,
      acquiredLock,
      chat,
      soul,
      homeLocation,
      storedFacts,
      storedJournalEntries,
      capabilityManifest,
    ] = await Promise.all([
      checkIpRateLimit(ipAddress(request)),
      acquireChatLock(id),
      getChatById({ id }),
      getUserSoul({ userId: session.user.id }),
      getUserHomeLocation({ userId: session.user.id }),
      memoryStore
        ? memoryStore
            .listProfileFacts({ userId: session.user.id })
            .catch(() => [])
        : Promise.resolve([]),
      memoryStore
        ? memoryStore
            .listJournalEntries({ userId: session.user.id, limit: 25 })
            .catch(() => [])
        : Promise.resolve([]),
      isSyntheticSdk7FixtureMode()
        ? Promise.resolve(undefined)
        : resolveLiveCapabilityManifest({
            userId: session.user.id,
            isGuest: session.user.type === "guest",
            webSearchAvailable: webSearchLane(chatModel),
          }),
    ]);
    const googleConnectedAndHealthy =
      capabilityManifest?.entries.find((e) => e.id === "gmail")?.state ===
      "connected_and_healthy";

    releaseLock = acquiredLock;
    if (!releaseLock) {
      return new ChatbotError("rate_limit:chat_busy").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;
    let replacementReplyId: string | undefined;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    // Retry can happen before or after the server accepted the original turn.
    // Reuse an existing persisted user turn, or save it exactly once if the
    // earlier request failed before persistence.
    const retryAlreadyPersisted = Boolean(
      retry &&
        message?.role === "user" &&
        messagesFromDb.some(
          (saved) => saved.role === "user" && saved.id === message.id
        )
    );

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      try {
        uiMessages = applyApprovalResponses(
          convertToUIMessages(messagesFromDb),
          messages as ChatMessage[],
          editedDraftApproval
        );
      } catch {
        return new ChatbotError("bad_request:api").toResponse();
      }
    } else if (retryAlreadyPersisted && message) {
      try {
        const preparedRetry = prepareRetry(
          convertToUIMessages(messagesFromDb),
          message.id
        );
        uiMessages = preparedRetry.messages;
        replacementReplyId = preparedRetry.replaceId;
      } catch {
        return new ChatbotError("bad_request:api").toResponse();
      }
    } else {
      // Replayed submits must use Retry; never insert or model-feed the same turn twice.
      if (messagesFromDb.some((saved) => saved.id === message?.id)) {
        return new ChatbotError("bad_request:api").toResponse();
      }
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const modelConfig =
      chatModels.find((m) => m.id === chatModel) ??
      SYNTHETIC_SDK7_FIXTURE_MODELS.find((m) => m.id === chatModel);
    const modelCapabilities = getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const supportsTools = capabilities?.tools === true;

    const requestTimeZone = validTimeZone(timeZone);
    const requestNow = new Date();
    const searchLane = supportsTools && webSearchLane(chatModel);
    const toolSelectOptions = {
      googleConnectedAndHealthy,
      capabilityManifest:
        isPremiumModel(chatModel) && session.user.type !== "guest"
          ? capabilityManifest
          : undefined,
    };
    const requestedTools = supportsTools
      ? selectActiveTools(
          uiMessages,
          session.user.type !== "guest",
          searchLane,
          toolSelectOptions
        )
      : [];
    const { intentMatchedTools } = supportsTools
      ? selectToolsWithRanking(
          uiMessages,
          session.user.type !== "guest",
          searchLane,
          toolSelectOptions
        )
      : { intentMatchedTools: [] as typeof requestedTools };
    const finalUserText =
      [...uiMessages]
        .reverse()
        .find((item) => item.role === "user")
        ?.parts.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ") ?? "";
    const turnEscalation = resolveTurnModelAndEffort({
      selectedModelId: chatModel,
      availableModelIds: availability.models.map((model) => model.id),
      userText: finalUserText,
      requestedTools: intentMatchedTools,
      baseEffort: modelConfig?.reasoningEffort,
    });
    chatModel = turnEscalation.modelId;
    const effectiveReasoningEffort = turnEscalation.reasoningEffort;
    const requestedBotSlug =
      extractRequestedBotSlug(finalUserText) ??
      (selectedBotSlug?.trim() || null);

    const explicitRemember =
      session.user.type !== "guest" &&
      isMemoryToolsEnabled() &&
      !containsRestrictedWorkData(finalUserText)
        ? extractExplicitRememberFact(finalUserText)
        : null;

    const [, activeTeammate, explicitSavedFact] = await Promise.all([
      message?.role === "user" && !retryAlreadyPersisted
        ? saveMessages({
            messages: [
              {
                chatId: id,
                id: message.id,
                role: "user",
                parts: message.parts,
                attachments: [],
                createdAt: new Date(),
              },
            ],
          })
        : Promise.resolve(),
      requestedBotSlug
        ? createPostgresBotRosterStore()
            .getBotBySlug(session.user.id, requestedBotSlug)
            .catch(() => null)
        : Promise.resolve(null),
      explicitRemember?.kind === "ok"
        ? createPostgresMemoryStore()
            .upsertProfileFact({
              userId: session.user.id,
              category: explicitRemember.category,
              key: explicitRemember.key,
              value: explicitRemember.value,
              source: "chat",
              pinned: explicitRemember.pinned,
              sharedAcrossBots: true,
            })
            .catch((): ProfileFact | null => null)
        : Promise.resolve(null),
    ]);

    const mergedFacts = explicitSavedFact
      ? [
          explicitSavedFact,
          ...storedFacts.filter((f) => f.key !== explicitSavedFact.key),
        ]
      : storedFacts;

    const effectiveSoul = composeTeammateSoul(soul, activeTeammate);
    const requestedSkillSlug =
      extractRequestedSkillSlug(finalUserText) ??
      activeTeammate?.skillSlugs[0] ??
      null;
    const activeSkill = requestedSkillSlug
      ? ((
          await createPostgresSkillStore()
            .listSkills(session.user.id)
            .catch(() => [])
        ).find((s) => s.slug === requestedSkillSlug) ?? null)
      : null;
    const rawBaseContext = contextBlock({
      now: requestNow,
      timeZone: requestTimeZone ?? homeLocation?.timeZone ?? null,
      home: homeLocation,
    });
    const safeBotFacts = filterFactsForBot(
      mergedFacts,
      activeTeammate?.slug ?? "chief-of-staff"
    ).filter(
      (f) =>
        !containsRestrictedWorkData(`${f.key} ${f.value}`) ||
        isAllowedShortKornFerryContextFact(f.value)
    );
    const memoryContextBlock = buildGroupedMemoryPromptBlock(
      safeBotFacts,
      finalUserText,
      { maxFacts: 80, maxChars: 6000, journalEntries: storedJournalEntries }
    );
    const ownerDisplayName =
      session.user.type !== "guest"
        ? session.user.name?.trim() ||
          process.env.APP_OWNER_NAME?.trim() ||
          "Çağlar"
        : null;
    const premium = isPremiumModel(chatModel) ? premiumModels[chatModel] : null;
    const ownerHeader =
      ownerDisplayName && premium ? `Owner: ${ownerDisplayName}` : "";
    const baseContext = [ownerHeader, rawBaseContext, memoryContextBlock]
      .filter(Boolean)
      .join("\n\n");
    const hasOperatorToolOnTurn = requestedTools.some((name) =>
      [
        "gmailReadMessages",
        "driveReadFiles",
        "calendarReadEvents",
        "githubReadPullRequests",
        "gmailCreateDraft",
        "driveCreateDraftDoc",
        "calendarCreateDraftEvent",
        "githubCreateDraftReview",
        "saveProfileFact",
        "addJournalEntry",
        "recallMemories",
        "scheduleTask",
        "listMySchedules",
        "cancelSchedule",
        "draftOutboundMessage",
        "delegateTask",
        "cloudExec",
        "cloudWriteFile",
        "cloudReadFile",
        "cloudExportFileToChat",
        "cloudBrowseUrl",
        "macExec",
        "macRunAgentCli",
      ].includes(name)
    );
    const hasPriorAssistantTurn = uiMessages.some(
      (m) => m.role === "assistant"
    );
    const replySystemPrompt = systemPrompt({
      supportsTools,
      soul: effectiveSoul,
      needsOnboarding:
        !effectiveSoul &&
        session.user.type !== "guest" &&
        intentMatchedTools.length === 0 &&
        !hasPriorAssistantTurn,
      includeArtifacts: needsArtifactInstructions(requestedTools),
      includeWebSearch: searchLane && requestedTools.includes("webSearch"),
      includeFixtures: intentMatchedTools.includes("getFixtures"),
      includeOperatorTools: hasOperatorToolOnTurn || googleConnectedAndHealthy,
      googleConnected: googleConnectedAndHealthy,
      capabilityManifest,
      setupCapabilities:
        Boolean(premium) && session.user.type !== "guest"
          ? {
              googleConnected: googleConnectedAndHealthy,
              githubConnected:
                capabilityManifest?.entries.find((e) => e.id === "github")
                  ?.state === "connected_and_healthy" ||
                (isGithubConnectorEnabled() &&
                  Boolean(process.env.GITHUB_CONNECTOR_PAT?.trim())),
              memoryEnabled: isMemoryToolsEnabled(),
              routinesEnabled: isRoutinesEnabled(),
              cloudComputerConnected: isCloudComputerConfigured(),
              macBridgeConnected: isMacBridgeConfigured(),
            }
          : undefined,
      includeVisual:
        Boolean(premium) &&
        isVisualCandidateTurn(finalUserText, intentMatchedTools),
      context: activeSkill
        ? `${baseContext}\n\n${formatSkillPromptBlock(activeSkill)}`
        : baseContext,
    });
    // A single text step may use most of the budget; a tool call and a
    // follow-up must share a minute on Groq's limited free account.
    const requestBudget =
      premium?.inferenceBudget ??
      (requestedTools.length > 0 ? GROQ_TOOL_TURN_BUDGET : 7000);
    const replyTokens = premium?.outputLimit ?? DEFAULT_REPLY_TOKENS;
    const availablePremium = [
      ...availability.models.map((model) => model.id).filter(isPremiumModel),
      ...(copilotFallbackEnabled() ? [COPILOT_HAIKU] : []),
    ];
    const execution: InferenceSession = {
      ledger: createUsageLedger(session.user.id, message?.id ?? generateUUID()),
      available: [...new Set(availablePremium)],
      exposed: false,
      toolBoundary: false,
      fallbackUsed: false,
      activeModelId: isPremiumModel(chatModel) ? chatModel : undefined,
    };

    const stream = createUIMessageStream<ChatMessage>({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: ({ writer: dataStream }) =>
        inferenceSession.run(execution, async () => {
          execution.onFallback = ({ fromModel, toModel }) => {
            dataStream.write({
              type: "data-turn-status",
              data: { phase: "thinking", model: toModel },
            });
            dataStream.write({
              type: "data-model-used",
              data: {
                modelId: toModel,
                modelName: getModelDisplayName(toModel),
                isFallback: true,
                fallbackFrom: fromModel,
              },
            });
          };
          const initialPhase =
            searchLane && intentMatchedTools.includes("webSearch")
              ? "searching"
              : intentMatchedTools.includes("getWeather")
                ? "weather"
                : intentMatchedTools.includes("getFixtures")
                  ? "fixtures"
                  : intentMatchedTools.length > 0
                    ? "tool"
                    : "thinking";
          dataStream.write({
            type: "data-turn-status",
            data: { phase: initialPhase, model: chatModel },
          });
          dataStream.write({
            type: "data-model-used",
            data: {
              modelId: chatModel,
              modelName: getModelDisplayName(chatModel),
              isFallback: false,
              escalated: turnEscalation.escalated,
            },
          });
          if (explicitSavedFact) {
            const memCallId = `mem-${explicitSavedFact.id.slice(0, 12)}`;
            dataStream.write({
              type: "tool-input-available",
              toolCallId: memCallId,
              toolName: "saveProfileFact",
              input: {
                category: explicitSavedFact.category,
                key: explicitSavedFact.key,
                value: explicitSavedFact.value,
                sharedAcrossBots: true,
              },
              providerExecuted: true,
            });
            dataStream.write({
              type: "tool-output-available",
              toolCallId: memCallId,
              output: {
                saved: true,
                fact: explicitSavedFact,
              },
              providerExecuted: true,
            });
          } else if (explicitRemember?.kind === "sensitive_blocked") {
            const warnCallId = `mem-warn-${generateId().slice(0, 8)}`;
            dataStream.write({
              type: "tool-input-available",
              toolCallId: warnCallId,
              toolName: "saveProfileFact",
              input: { category: "rules", key: "blocked", value: "" },
              providerExecuted: true,
            });
            dataStream.write({
              type: "tool-output-available",
              toolCallId: warnCallId,
              output: {
                saved: false,
                skippedSensitive: true,
                reason: explicitRemember.reason,
                warning:
                  "Passwords, card numbers, and street addresses are never stored in memory.",
              },
              providerExecuted: true,
            });
          }
          const attachmentPrep = await prepareMessagesWithAttachments({
            messages: sanitizeToolCallIds(dropWebSearchHistory(uiMessages)),
            userId: session.user.id,
            visionEnabled: capabilities?.vision === true,
          });
          const localTools = {
            demoInbox,
            getWeather: getWeather({ home: homeLocation }),
            getFixtures: getFixtures({
              now: () => requestNow,
              footballDataKey: process.env.FOOTBALL_DATA_API_KEY ?? null,
            }),
            getCurrentTime: getCurrentTime({
              defaultTimeZone:
                requestTimeZone ?? homeLocation?.timeZone ?? null,
            }),
            createDocument: createDocument({
              session,
              dataStream,
              modelId: chatModel,
            }),
            editDocument: editDocument({ dataStream, session }),
            updateDocument: updateDocument({
              session,
              dataStream,
              modelId: chatModel,
            }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
              modelId: chatModel,
            }),
            ...(searchLane ? { webSearch: webSearch() } : {}),
            askUserQuestion,
            listMySchedules: listMySchedules({ session }),
            cancelSchedule: cancelSchedule({ session }),
            ...(session.user.type !== "guest"
              ? (() => {
                  const hasPriorConnectorReads = uiMessages.some((m) =>
                    m.parts.some(
                      (p) =>
                        (p.type as string) === "tool-gmailReadMessages" ||
                        (p.type as string) === "tool-driveReadFiles" ||
                        (p.type as string) === "tool-calendarReadEvents" ||
                        (p.type as string) === "tool-githubReadPullRequests" ||
                        (p.type as string) === "tool-cloudBrowseUrl"
                    )
                  );
                  const hasUntrusted =
                    intentMatchedTools.includes("webSearch") ||
                    intentMatchedTools.includes("gmailReadMessages") ||
                    intentMatchedTools.includes("driveReadFiles") ||
                    intentMatchedTools.includes("calendarReadEvents") ||
                    intentMatchedTools.includes("githubReadPullRequests") ||
                    intentMatchedTools.includes("cloudBrowseUrl") ||
                    attachmentPrep.hasUntrustedAttachment ||
                    hasPriorConnectorReads;

                  const calGithub = createCalendarAndGithubTools({
                    userId: session.user.id,
                    hasUntrustedContext: hasUntrusted,
                  });

                  return {
                    setSoul: setSoul({ userId: session.user.id }),
                    setHomeLocation: setHomeLocation({
                      userId: session.user.id,
                    }),
                    draftOutboundMessage: draftOutboundMessage({
                      hasUntrustedContext: hasUntrusted,
                    }),
                    delegateTask: createDelegateTaskTool({
                      userId: session.user.id,
                      hasUntrustedContext: hasUntrusted,
                    }),
                    ...createCloudComputerTools({
                      userId: session.user.id,
                      hasUntrustedContext: hasUntrusted,
                    }),
                    ...createMacBridgeTools({
                      userId: session.user.id,
                      hasUntrustedContext: hasUntrusted,
                    }),
                    ...(isRoutinesEnabled()
                      ? { scheduleTask: scheduleTask({ session }) }
                      : {}),
                    ...(isMemoryToolsEnabled()
                      ? createMemoryTools({
                          userId: session.user.id,
                          store: createPostgresMemoryStore(),
                        })
                      : {}),
                    ...(isGoogleConnectorsEnabled()
                      ? {
                          ...createGoogleConnectorTools({
                            userId: session.user.id,
                            hasUntrustedContext: hasUntrusted,
                          }),
                          calendarReadEvents: calGithub.calendarReadEvents,
                          calendarCreateDraftEvent:
                            calGithub.calendarCreateDraftEvent,
                        }
                      : {}),
                    ...(isGithubConnectorEnabled()
                      ? {
                          githubReadPullRequests:
                            calGithub.githubReadPullRequests,
                          githubCreateDraftReview:
                            calGithub.githubCreateDraftReview,
                        }
                      : {}),
                    ...(isMediaStudioEnabled()
                      ? createMediaTools({
                          userId: session.user.id,
                          ledger: execution.ledger,
                          dataStream,
                          hasUntrustedContext: hasUntrusted,
                        })
                      : {}),
                  };
                })()
              : {}),
          };

          // Only reviewed local tools are available. External integrations stay disconnected.
          const tools = localTools;
          // If explicit "remember this: ..." was already handled deterministically above,
          // remove saveProfileFact from activeTools on this turn so we don't render two cards.
          const activeTools = requestedTools.filter(
            (name) =>
              name in tools &&
              !(
                (explicitSavedFact ||
                  explicitRemember?.kind === "sensitive_blocked") &&
                name === "saveProfileFact"
              )
          ) as Array<keyof typeof tools>;
          const toolSchemaTokens = await estimateToolSchemaTokens(
            tools,
            activeTools
          );
          const convertedMessages = await convertToModelMessages(
            attachmentPrep.messages,
            { tools, ignoreIncompleteToolCalls: true }
          );
          const prepared = budgetModelMessages({
            messages: convertedMessages,
            system: replySystemPrompt,
            toolCount: activeTools.length,
            toolSchemaTokens,
            maxOutputTokens: replyTokens,
            requestBudget,
          });
          if (prepared.tooLarge) {
            throw new Error("chat_context_budget");
          }
          let firstCallTokens = 0;
          let stepStartedAtMs = Date.now();
          let emittedTaskStepIndex = 0;
          const stepLabels: Record<string, string> = {
            gmailReadMessages: "Checked Gmail inbox",
            gmailCreateDraft: "Prepared Gmail draft",
            calendarReadEvents: "Checked Google Calendar",
            calendarCreateDraftEvent: "Prepared Calendar draft",
            driveReadFiles: "Searched Google Drive",
            driveCreateDraftDoc: "Prepared Google Drive draft",
            githubReadPullRequests: "Checked GitHub pull requests",
            githubCreateDraftReview: "Prepared GitHub PR review draft",
            recallMemories: "Recalled durable memories",
            saveProfileFact: "Saved fact to memory",
            addJournalEntry: "Logged journal note",
            delegateTask: "Dispatched background task",
            cloudExec: "Ran command on Cloud Computer",
            cloudWriteFile: "Wrote file to /workspace",
            cloudReadFile: "Read file from /workspace",
            cloudExportFileToChat: "Exported /workspace file to chat",
            cloudBrowseUrl: "Opened URL in Cloud Browser",
            macExec: "Ran command on Mac mini (tmux)",
            macRunAgentCli: "Ran coding CLI on Mac mini worktree",
            listMySchedules: "Checked scheduled routines",
            scheduleTask: "Scheduled recurring routine",
            cancelSchedule: "Cancelled routine",
            getWeather: "Fetched weather forecast",
            getFixtures: "Checked match fixtures",
          };
          const result = streamText({
            model: getLanguageModel(chatModel),
            instructions: replySystemPrompt,
            messages: prepared.messages,
            // Multi-step agent loop: 0 tools = 1 step; quick single lookup = 3 steps;
            // webSearch or operator/multi-tool turns = bounded 8-step agent loop.
            stopWhen: isStepCount(
              activeTools.length === 0
                ? 1
                : hasOperatorToolOnTurn ||
                    activeTools.length > 1 ||
                    activeTools.includes("webSearch")
                  ? 8
                  : 3
            ),
            maxOutputTokens: replyTokens,
            maxRetries: 0,
            // Log failureKind(error) only — never upstream request/response bodies, URLs, or secrets.
            onError: ({ error }) => {
              console.error("[chat] stream error", {
                kind: failureKind(error),
              });
            },
            abortSignal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(140_000),
            ]),
            activeTools,
            prepareStep: ({ messages: stepMessages, stepNumber }) => {
              stepStartedAtMs = Date.now();
              const next = budgetModelMessages({
                messages: stepMessages,
                system: replySystemPrompt,
                toolCount: activeTools.length,
                toolSchemaTokens,
                maxOutputTokens: replyTokens,
                // Groq lane: the follow-up shares the minute with the first call.
                requestBudget:
                  !premium && stepNumber > 0 && firstCallTokens > 0
                    ? followUpBudget(firstCallTokens)
                    : requestBudget,
              });
              if (stepNumber === 0) {
                firstCallTokens = next.estimatedRequestTokens;
              }
              if (next.tooLarge) {
                throw new Error("chat_context_budget");
              }
              return { messages: next.messages };
            },
            onStepFinish: ({ toolCalls }) => {
              if (!toolCalls || toolCalls.length === 0) {
                return;
              }
              const elapsedMs = Math.max(1, Date.now() - stepStartedAtMs);
              for (const tc of toolCalls) {
                if (tc.toolName === "webSearch") {
                  continue;
                }
                emittedTaskStepIndex += 1;
                dataStream.write({
                  type: "data-task-step",
                  data: {
                    stepIndex: emittedTaskStepIndex,
                    label: stepLabels[tc.toolName] ?? `Ran ${tc.toolName}`,
                    toolName: tc.toolName,
                    status: "done",
                    elapsedMs,
                  },
                });
              }
            },
            providerOptions: {
              openai: { reasoningEffort: effectiveReasoningEffort },
            },
            tools,
            telemetry: {
              isEnabled: isProductionEnvironment,
              recordInputs: false,
              recordOutputs: false,
              functionId: "stream-text",
            },
          });

          let primaryOutcome: UIMessageStreamOutcome | null = null;
          dataStream.merge(
            toUIMessageStream<typeof tools, ChatMessage>({
              stream: result.stream,
              onEnd: ({ outcome }) => {
                primaryOutcome = outcome;
              },
              sendReasoning: false,
              onError: (error) => {
                console.error("[chat] ui stream error", {
                  kind: failureKind(error),
                });
                return safeModelError(error, finalUserText);
              },
            })
              .pipeThrough(
                createMultiSearchRecoveryStream({
                  userText: finalUserText,
                  synthesize: ({ prompt }) => {
                    if (request.signal.aborted) {
                      return (async function* empty() {
                        /* request already cancelled by client */
                      })();
                    }
                    const synthSession = {
                      ...execution,
                      exposed: false,
                      toolBoundary: false,
                    };
                    return inferenceSession.run(synthSession, () => {
                      const synthResult = streamText({
                        model: getLanguageModel(chatModel),
                        instructions: replySystemPrompt,
                        prompt,
                        maxOutputTokens: Math.min(replyTokens, 2048),
                        maxRetries: 0,
                        providerOptions: {
                          openai: { reasoningEffort: effectiveReasoningEffort },
                        },
                        onError: ({ error }) => {
                          console.error("[chat] synthesis stream error", {
                            kind: failureKind(error),
                          });
                        },
                        abortSignal: AbortSignal.any([
                          request.signal,
                          AbortSignal.timeout(25_000),
                        ]),
                      });
                      return synthResult.textStream;
                    });
                  },
                  onFinalize: (recovered) => {
                    dataStream.setOutcome(
                      recovered
                        ? { status: "completed" }
                        : (primaryOutcome ?? { status: "completed" })
                    );
                  },
                })
              )
              .pipeThrough(safeUIStream(finalUserText))
          );

          if (titlePromise) {
            const title = await titlePromise;
            dataStream.write({ type: "data-chat-title", data: title });
            await updateChatTitleById({ chatId: id, title });
          }
        }),
      generateId: () => replacementReplyId ?? generateUUID(),
      onEnd: async ({ responseMessage, outcome, isAborted, isCancelled }) => {
        try {
          const reply = replyForStorage(
            responseMessage,
            outcome.status === "completed" && !isAborted && !isCancelled
          );
          if (!reply) {
            return;
          }
          const resolvedModelId = execution.activeModelId ?? chatModel;
          const ensuredModelParts = [
            ...reply.parts.filter((p) => p.type !== "data-model-used"),
            {
              type: "data-model-used" as const,
              data: {
                modelId: resolvedModelId,
                modelName: getModelDisplayName(resolvedModelId),
                isFallback: execution.fallbackUsed,
                ...(execution.fallbackUsed ? { fallbackFrom: chatModel } : {}),
                escalated: turnEscalation.escalated,
              },
            },
          ];
          const withVisual = attachOpenUiPart(
            { ...reply, parts: ensuredModelParts },
            resolvedModelId
          );
          const saved = messagesFromDb.find((m) => m.id === withVisual.id);
          if (saved) {
            await updateMessage({ id: withVisual.id, parts: withVisual.parts });
          } else {
            await saveMessages({
              messages: [
                {
                  id: withVisual.id,
                  role: withVisual.role,
                  parts: withVisual.parts,
                  createdAt: new Date(),
                  attachments: [],
                  chatId: id,
                },
              ],
            });
          }
        } finally {
          await releaseLock?.();
        }
      },
      onError: (error) => {
        console.error("[chat] ui stream error", {
          kind: failureKind(error),
        });
        return safeModelError(error, finalUserText);
      },
    });

    streamOwnsLock = true;
    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          /* non-critical */
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Chat request failed", { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  } finally {
    if (!streamOwnsLock) {
      await releaseLock?.();
    }
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
