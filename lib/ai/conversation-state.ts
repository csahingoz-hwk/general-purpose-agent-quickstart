import type { InferUIMessageChunk } from "ai";
import type { ChatMessage } from "../types";
import { safeModelError } from "./context/errors";

export function interruptedReply(message: ChatMessage | undefined) {
  return message?.parts.find((part) => part.type === "data-reply-status")?.data;
}

export function canRetryReply(messages: ChatMessage[]) {
  const last = messages.at(-1);
  return (
    last?.role === "user" ||
    (last?.role === "assistant" && interruptedReply(last)?.retryable === true)
  );
}

/** Reuse canonical saved input; a client cannot rewrite a persisted retry. */
export function prepareRetry(messages: ChatMessage[], targetId: string) {
  const last = messages.at(-1);
  const removable =
    last?.role === "assistant" && interruptedReply(last)?.retryable === true
      ? last
      : undefined;
  const history = removable ? messages.slice(0, -1) : messages;
  if (history.at(-1)?.role !== "user" || history.at(-1)?.id !== targetId) {
    throw new Error("invalid_retry_target");
  }
  return { messages: history, replaceId: removable?.id };
}

/** Only a persisted pending approval may be changed, never its input/output. */
export function applyApprovalResponses(
  saved: ChatMessage[],
  submitted: ChatMessage[]
) {
  let count = 0;
  const messages = saved.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!("state" in part) || part.state !== "approval-requested") {
        return part;
      }
      const update = submitted
        .find((m) => m.id === message.id)
        ?.parts.find(
          (p) =>
            "toolCallId" in p &&
            p.toolCallId === part.toolCallId &&
            "state" in p &&
            p.state === "approval-responded"
        );
      if (
        !update ||
        !("approval" in update) ||
        update.approval?.id !== part.approval.id ||
        typeof update.approval.approved !== "boolean"
      ) {
        return part;
      }
      count++;
      return {
        ...part,
        state: "approval-responded" as const,
        approval: { id: part.approval.id, approved: update.approval.approved },
      };
    }),
  }));
  if (!count) {
    throw new Error("invalid_approval_response");
  }
  return messages as ChatMessage[];
}

/** Sanitize tool failures too: SDK tool errors are UI chunks, not fatal errors. */
export function safeUIStream(userText: string) {
  return new TransformStream<
    InferUIMessageChunk<ChatMessage>,
    InferUIMessageChunk<ChatMessage>
  >({
    transform(chunk, controller) {
      controller.enqueue(
        chunk.type === "tool-output-error" || chunk.type === "error"
          ? { ...chunk, errorText: safeModelError(chunk.errorText, userText) }
          : chunk
      );
    },
  });
}

export function replyForStorage(
  message: ChatMessage,
  completed: boolean
): ChatMessage | null {
  const meaningful = message.parts.some(
    (part) =>
      (part.type === "text" && part.text.trim()) ||
      part.type.startsWith("tool-")
  );
  if (!meaningful) {
    return null;
  }
  // Retrying a side-effecting tool could repeat a write. Preserve and explain it.
  const hadTools = message.parts.some((part) => part.type.startsWith("tool-"));
  return {
    ...message,
    parts: [
      ...message.parts.filter((p) => p.type !== "data-reply-status"),
      {
        type: "data-reply-status",
        data: {
          status: completed ? "complete" : "interrupted",
          retryable: !completed && !hadTools,
        },
      },
    ],
  };
}
