import { ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  toUIMessageStream,
  streamText,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth } from "@/app/(auth)/auth";
import {
  budgetModelMessages,
  DEFAULT_REPLY_TOKENS,
} from "@/lib/ai/context/budget";
import { safeModelError } from "@/lib/ai/context/errors";
import {
  needsArtifactInstructions,
  selectActiveTools,
} from "@/lib/ai/context/select-tools";
import { parseVerification } from "@/lib/ai/groq-verification";
import { chatModels, getCapabilities } from "@/lib/ai/models";
import { systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { cancelSchedule } from "@/lib/ai/tools/cancel-schedule";
import { createDocument } from "@/lib/ai/tools/create-document";
import { demoInbox } from "@/lib/ai/tools/demo-inbox";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { listMySchedules } from "@/lib/ai/tools/list-my-schedules";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { setSoul } from "@/lib/ai/tools/set-soul";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessagesByChatId,
  getUserSoul,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";
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

  try {
    const {
      id,
      message,
      messages,
      selectedChatModel,
      selectedVisibilityType,
      retry,
    } = requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    // The verified allowlist already exists in protected environment settings.
    // Never make an 8-second live model-catalogue request on every chat turn.
    const verified = parseVerification(process.env.VERIFIED_GROQ_MODELS);
    if (!process.env.GROQ_API_KEY || verified.status !== "ready") {
      return new ChatbotError("offline:model_setup").toResponse();
    }
    if (!verified.modelIds.includes(selectedChatModel)) {
      return new ChatbotError("bad_request:api").toResponse();
    }
    const chatModel = selectedChatModel;

    await checkIpRateLimit(ipAddress(request));

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

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
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        // The retry target is already in the database. Don't repeat the user
        // turn in model context, even though no new DB row will be inserted.
        ...(retryAlreadyPersisted ? [] : [message as ChatMessage]),
      ];
    }

    if (retryAlreadyPersisted) {
      // Only retry the latest unanswered saved user turn.
      const lastSaved = messagesFromDb.at(-1);
      if (
        !chat ||
        !message ||
        lastSaved?.role !== "user" ||
        lastSaved.id !== message.id
      ) {
        return new ChatbotError("bad_request:api").toResponse();
      }
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
    const needsOnboarding = !soul && session.user.type !== "guest";
    const requestedTools = supportsTools
      ? selectActiveTools(uiMessages, session.user.type !== "guest")
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
    });
    // A single text step may use most of the budget; a tool call and a
    // follow-up must share a minute on Groq's limited free account.
    const requestBudget = requestedTools.length > 0 ? 3400 : 7000;

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        const localTools = {
          demoInbox,
          getWeather,
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
          listMySchedules: listMySchedules({ session }),
          cancelSchedule: cancelSchedule({ session }),
          ...(session.user.type !== "guest"
            ? { setSoul: setSoul({ userId: session.user.id }) }
            : {}),
        };

        // Only reviewed local tools are available. External integrations stay disconnected.
        const tools = localTools;
        const activeTools = requestedTools.filter(
          (name) => name in tools
        ) as Array<keyof typeof tools>;
        const convertedMessages = await convertToModelMessages(
          sanitizeToolCallIds(uiMessages),
          { tools, ignoreIncompleteToolCalls: true }
        );
        const prepared = budgetModelMessages({
          messages: convertedMessages,
          instructions: replySystemPrompt,
          toolCount: activeTools.length,
          maxOutputTokens: DEFAULT_REPLY_TOKENS,
          requestBudget,
        });
        if (prepared.tooLarge) {
          throw new Error("chat_context_budget");
        }
        const result = streamText({
          model: getLanguageModel(chatModel),
          system: replySystemPrompt,
          messages: prepared.messages,
          stopWhen: isStepCount(activeTools.length > 0 ? 2 : 1),
          maxOutputTokens: DEFAULT_REPLY_TOKENS,
          maxRetries: 0,
          activeTools,
          prepareStep: ({ messages: stepMessages }) => {
            const next = budgetModelMessages({
              messages: stepMessages,
              system: replySystemPrompt,
              toolCount: activeTools.length,
              maxOutputTokens: DEFAULT_REPLY_TOKENS,
              requestBudget,
            });
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
            functionId: "stream-text",
          },
        });

        dataStream.merge(
          toUIMessageStream({
            stream: result.stream,
            sendReasoning: false,
            onError: (error) => safeModelError(error, finalUserText),
          })
        );

        if (titlePromise) {
          const title = await titlePromise;
          dataStream.write({ type: "data-chat-title", data: title });
          updateChatTitleById({ chatId: id, title });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else {
          // Failed/aborted generations must not persist empty assistant rows.
          const meaningfulMessages = finishedMessages.filter(
            (msg) =>
              msg.role !== "assistant" ||
              msg.parts.some(
                (part) =>
                  (part.type === "text" && part.text.trim().length > 0) ||
                  part.type.startsWith("tool-")
              )
          );
          if (meaningfulMessages.length > 0) {
            await saveMessages({
              messages: meaningfulMessages.map((currentMessage) => ({
                id: currentMessage.id,
                role: currentMessage.role,
                parts: currentMessage.parts,
                createdAt: new Date(),
                attachments: [],
                chatId: id,
              })),
            });
          }
        }
      },
      onError: (error) => safeModelError(error, finalUserText),
    });

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
