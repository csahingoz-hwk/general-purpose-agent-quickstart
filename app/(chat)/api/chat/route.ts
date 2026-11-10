import { ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth } from "@/app/(auth)/auth";
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
} from "@/lib/ai/context/select-tools";
import {
  applyApprovalResponses,
  prepareRetry,
  replyForStorage,
  safeUIStream,
} from "@/lib/ai/conversation-state";
import { getRequestModelAvailability } from "@/lib/ai/model-runtime";
import { chatModels, getCapabilities } from "@/lib/ai/models";
import { systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  isPremiumModel,
  premiumModels,
  webSearchLane,
} from "@/lib/ai/routing/catalog";
import { createUsageLedger } from "@/lib/ai/routing/ledger";
import { inferenceSession } from "@/lib/ai/routing/session";
import { cancelSchedule } from "@/lib/ai/tools/cancel-schedule";
import { createDocument } from "@/lib/ai/tools/create-document";
import { demoInbox } from "@/lib/ai/tools/demo-inbox";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { getCurrentTime } from "@/lib/ai/tools/get-current-time";
import { getFixtures } from "@/lib/ai/tools/get-fixtures";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { listMySchedules } from "@/lib/ai/tools/list-my-schedules";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { setHomeLocation } from "@/lib/ai/tools/set-home-location";
import { setSoul } from "@/lib/ai/tools/set-soul";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { webSearch } from "@/lib/ai/tools/web-search";
import { isProductionEnvironment } from "@/lib/constants";
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
import { attachOpenUiPart } from "@/lib/openui/attach";
import { checkIpRateLimit } from "@/lib/ratelimit";
import { contextBlock, validTimeZone } from "@/lib/temporal";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

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
        part.type !== "data-openui"
    ),
  }));
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
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
      selectedChatModel,
      selectedVisibilityType,
      timeZone,
      retry,
    } = requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const availability = await getRequestModelAvailability();
    if (availability.status !== "ready") {
      return new ChatbotError("offline:model_setup").toResponse();
    }
    if (!availability.models.some((model) => model.id === selectedChatModel)) {
      return new ChatbotError("bad_request:api").toResponse();
    }
    const chatModel = selectedChatModel;

    await checkIpRateLimit(ipAddress(request));

    releaseLock = await acquireChatLock(id);
    if (!releaseLock) {
      return new ChatbotError("rate_limit:chat_busy").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
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
          messages as ChatMessage[]
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

    if (message?.role === "user" && !retryAlreadyPersisted) {
      await saveMessages({
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
      });
    }

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const supportsTools = capabilities?.tools === true;

    const soul = await getUserSoul({ userId: session.user.id });
    const homeLocation = await getUserHomeLocation({ userId: session.user.id });
    const requestTimeZone = validTimeZone(timeZone);
    const requestNow = new Date();
    const needsOnboarding = !soul && session.user.type !== "guest";
    // Web search exists only when this request is served by the AI Gateway lane.
    const searchLane = supportsTools && webSearchLane(chatModel);
    const requestedTools = supportsTools
      ? selectActiveTools(uiMessages, session.user.type !== "guest", searchLane)
      : [];
    const finalUserText =
      [...uiMessages]
        .reverse()
        .find((item) => item.role === "user")
        ?.parts.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ") ?? "";
    const replySystemPrompt = systemPrompt({
      supportsTools,
      soul,
      needsOnboarding,
      includeArtifacts: needsArtifactInstructions(requestedTools),
      includeWebSearch: searchLane && requestedTools.includes("webSearch"),
      includeFixtures: requestedTools.includes("getFixtures"),
      includeVisual: requestedTools.some(
        (name) => name === "webSearch" || name === "getWeather"
      ),
      context: contextBlock({
        now: requestNow,
        timeZone: requestTimeZone ?? homeLocation?.timeZone ?? null,
        home: homeLocation,
      }),
    });
    // A single text step may use most of the budget; a tool call and a
    // follow-up must share a minute on Groq's limited free account.
    const premium = isPremiumModel(chatModel) ? premiumModels[chatModel] : null;
    const requestBudget =
      premium?.inferenceBudget ??
      (requestedTools.length > 0 ? GROQ_TOOL_TURN_BUDGET : 7000);
    const replyTokens = premium?.outputLimit ?? DEFAULT_REPLY_TOKENS;
    const execution = {
      ledger: createUsageLedger(session.user.id, message?.id ?? generateUUID()),
      available: availability.models
        .map((model) => model.id)
        .filter(isPremiumModel),
      exposed: false,
      toolBoundary: false,
      fallbackUsed: false,
    };

    const stream = createUIMessageStream<ChatMessage>({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: ({ writer: dataStream }) =>
        inferenceSession.run(execution, async () => {
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
            listMySchedules: listMySchedules({ session }),
            cancelSchedule: cancelSchedule({ session }),
            ...(session.user.type !== "guest"
              ? {
                  setSoul: setSoul({ userId: session.user.id }),
                  setHomeLocation: setHomeLocation({ userId: session.user.id }),
                }
              : {}),
          };

          // Only reviewed local tools are available. External integrations stay disconnected.
          const tools = localTools;
          const activeTools = requestedTools.filter(
            (name) => name in tools
          ) as Array<keyof typeof tools>;
          const toolSchemaTokens = await estimateToolSchemaTokens(
            tools,
            activeTools
          );
          const convertedMessages = await convertToModelMessages(
            sanitizeToolCallIds(dropWebSearchHistory(uiMessages)),
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
          const result = streamText({
            model: getLanguageModel(chatModel),
            instructions: replySystemPrompt,
            messages: prepared.messages,
            // Step 1 = tool call(s); step 2 = the written answer. AI Gateway runs
            // webSearch inside step 1's model call (provider-executed), so the
            // search result and the answer need no extra step. The number of
            // searches is capped in the routed model (WEB_SEARCH_MAX_CALLS).
            stopWhen: isStepCount(
              activeTools.length === 0
                ? 1
                : activeTools.includes("getFixtures") &&
                    activeTools.includes("webSearch")
                  ? 3
                  : 2
            ),
            maxOutputTokens: replyTokens,
            maxRetries: 0,
            // The SDK default logs raw upstream errors, including request content.
            onError: () => {
              /* Ledger and UI handle safe errors; never log upstream request bodies. */
            },
            abortSignal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(50_000),
            ]),
            activeTools,
            prepareStep: ({ messages: stepMessages, stepNumber }) => {
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
            providerOptions: {
              ...(modelConfig?.reasoningEffort && {
                openai: { reasoningEffort: modelConfig.reasoningEffort },
              }),
            },
            tools,
            telemetry: {
              isEnabled: isProductionEnvironment,
              recordInputs: false,
              recordOutputs: false,
              functionId: "stream-text",
            },
          });

          dataStream.merge(
            toUIMessageStream<typeof tools, ChatMessage>({
              stream: result.stream,
              onEnd: ({ outcome }) => dataStream.setOutcome(outcome),
              sendReasoning: false,
              onError: (error) => safeModelError(error, finalUserText),
            }).pipeThrough(safeUIStream(finalUserText))
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
          const withVisual = attachOpenUiPart(reply, chatModel);
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
      onError: (error) => safeModelError(error, finalUserText),
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
