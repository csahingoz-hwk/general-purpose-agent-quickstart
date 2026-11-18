import type { InferUIMessageChunk } from "ai";
import type { ChatMessage } from "../types";
import { safeModelError } from "./context/errors";

export function interruptedReply(message: ChatMessage | undefined) {
  return message?.parts.find((part) => part.type === "data-reply-status")?.data;
}

export function isEmptyAssistantTurnStub(
  message: ChatMessage | undefined
): boolean {
  if (message?.role !== "assistant") {
    return false;
  }
  const hasMeaningfulPart = message.parts.some(
    (part) =>
      (part.type === "text" && part.text.trim().length > 0) ||
      part.type.startsWith("tool-") ||
      part.type === "data-reply-status"
  );
  return !hasMeaningfulPart;
}

export function canRetryReply(messages: ChatMessage[]) {
  const last = messages.at(-1);
  return (
    last?.role === "user" ||
    isEmptyAssistantTurnStub(last) ||
    (last?.role === "assistant" && interruptedReply(last)?.retryable === true)
  );
}

/** Reuse canonical saved input; a client cannot rewrite a persisted retry. */
export function prepareRetry(messages: ChatMessage[], targetId: string) {
  const last = messages.at(-1);
  const removable =
    (last?.role === "assistant" &&
      interruptedReply(last)?.retryable === true) ||
    isEmptyAssistantTurnStub(last)
      ? last
      : undefined;
  const history = removable ? messages.slice(0, -1) : messages;
  if (history.at(-1)?.role !== "user" || history.at(-1)?.id !== targetId) {
    throw new Error("invalid_retry_target");
  }
  return { messages: history, replaceId: removable?.id };
}

export type EditedDraftApproval = {
  approvalId: string;
  recipient: string;
  subject?: string;
  body: string;
};

/**
 * Only a persisted pending approval may be changed; submitted message inputs
 * are never trusted directly. Explicit owner inline draft edits (validated via
 * editedDraftApprovalSchema) may update only the matching email/message draft tool.
 */
export function applyApprovalResponses(
  saved: ChatMessage[],
  submitted: ChatMessage[],
  editedDraft?: EditedDraftApproval
) {
  let count = 0;
  let sawExpiredTarget = false;
  const messages = saved.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if ("state" in part && part.state === "output-denied") {
        const attemptedOnDenied = submitted
          .find((m) => m.id === message.id)
          ?.parts.find(
            (p) =>
              "toolCallId" in p &&
              "toolCallId" in part &&
              p.toolCallId === part.toolCallId &&
              "state" in p &&
              p.state === "approval-responded"
          );
        if (attemptedOnDenied) {
          sawExpiredTarget = true;
        }
        return part;
      }
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
      const partType = String(part.type);
      const dynamicToolName = "toolName" in part ? String(part.toolName) : "";
      const canApplyDraftEdit =
        Boolean(editedDraft) &&
        update.approval.approved === true &&
        editedDraft?.approvalId === part.approval.id &&
        (partType === "tool-gmailCreateDraft" ||
          partType === "tool-draftOutboundMessage" ||
          dynamicToolName === "gmailCreateDraft" ||
          dynamicToolName === "draftOutboundMessage");
      const baseInput =
        "input" in part && typeof part.input === "object" && part.input !== null
          ? (part.input as Record<string, unknown>)
          : {};
      const nextInput =
        canApplyDraftEdit && editedDraft
          ? {
              ...baseInput,
              recipient: editedDraft.recipient.trim(),
              ...(editedDraft.subject !== undefined
                ? { subject: editedDraft.subject.trim() }
                : {}),
              body: editedDraft.body,
            }
          : "input" in part
            ? part.input
            : undefined;
      return {
        ...part,
        ...(nextInput !== undefined ? { input: nextInput } : {}),
        state: "approval-responded" as const,
        approval: { id: part.approval.id, approved: update.approval.approved },
      };
    }),
  }));
  if (!count) {
    if (sawExpiredTarget) {
      throw new Error("approval_expired");
    }
    throw new Error("invalid_approval_response");
  }
  return messages as ChatMessage[];
}

/**
 * Item 7: When the user sends a new message while one or more tool approvals
 * are still waiting (`state === "approval-requested"`), expire those pending
 * approvals immediately (`state: "output-denied"`, `reason: "expired_by_new_message"`).
 */
export function expirePendingApprovalsOnNewUserTurn(
  savedMessages: ChatMessage[]
): {
  messages: ChatMessage[];
  expiredMessages: ChatMessage[];
} {
  const expiredMessages: ChatMessage[] = [];
  const messages = savedMessages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }
    let changed = false;
    const nextParts = message.parts.map((part) => {
      if (
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "approval-requested"
      ) {
        changed = true;
        const existingApprovalId =
          "approval" in part &&
          part.approval &&
          typeof part.approval === "object" &&
          "id" in part.approval
            ? String((part.approval as { id: unknown }).id)
            : "expired";
        return {
          ...part,
          state: "output-denied" as const,
          approval: {
            id: existingApprovalId,
            approved: false,
            reason: "expired_by_new_message",
          },
        } as unknown as ChatMessage["parts"][number];
      }
      return part;
    });
    if (!changed) {
      return message;
    }
    const updatedMessage: ChatMessage = { ...message, parts: nextParts };
    expiredMessages.push(updatedMessage);
    return updatedMessage;
  });

  return { messages, expiredMessages };
}

/**
 * Item 6: After a server restart/redeploy (when no live turn holds the chat lock),
 * mark any mid-flight tool call (`input-streaming`, `input-available`, or
 * `approval-responded` without an output) as interrupted so side-effecting
 * actions (emails, drafts, commands) are NEVER replayed twice.
 */
export function markMidFlightToolsInterrupted(savedMessages: ChatMessage[]): {
  messages: ChatMessage[];
  interruptedMessages: ChatMessage[];
} {
  const interruptedMessages: ChatMessage[] = [];
  const messages = savedMessages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }
    let hadMidFlight = false;
    let hadSideEffectMidFlight = false;
    const nextParts = message.parts.map((part) => {
      if (!part.type.startsWith("tool-") || !("state" in part)) {
        return part;
      }
      const isMidFlight =
        part.state === "input-streaming" ||
        part.state === "input-available" ||
        part.state === "approval-responded";
      if (!isMidFlight) {
        return part;
      }
      hadMidFlight = true;
      if (!SAFE_RETRY_READ_ONLY_TOOL_TYPES.has(String(part.type))) {
        hadSideEffectMidFlight = true;
      }
      return {
        ...part,
        state: "output-error" as const,
        errorText:
          "Interrupted during server restart — mid-flight action was NOT replayed so nothing is sent twice.",
      } as unknown as ChatMessage["parts"][number];
    });

    if (!hadMidFlight) {
      return message;
    }

    const filteredParts = nextParts.filter(
      (p) => p.type !== "data-reply-status" && p.type !== "data-turn-status"
    );
    const updatedMessage: ChatMessage = {
      ...message,
      parts: [
        ...filteredParts,
        {
          type: "data-reply-status",
          data: {
            status: "interrupted",
            retryable:
              !hadSideEffectMidFlight &&
              !hasNonRetryableToolExecution({
                ...message,
                parts: filteredParts,
              }),
          },
        },
      ],
    };
    interruptedMessages.push(updatedMessage);
    return updatedMessage;
  });

  return { messages, interruptedMessages };
}

/** Sanitize tool failures too, and emit at most one fatal `error` chunk per turn. */
export function safeUIStream(userText: string) {
  let fatalErrorEmitted = false;
  return new TransformStream<
    InferUIMessageChunk<ChatMessage>,
    InferUIMessageChunk<ChatMessage>
  >({
    transform(chunk, controller) {
      if (chunk.type === "error") {
        if (fatalErrorEmitted) {
          return;
        }
        fatalErrorEmitted = true;
        controller.enqueue({
          ...chunk,
          errorText: safeModelError(chunk.errorText, userText),
        });
        return;
      }
      controller.enqueue(
        chunk.type === "tool-output-error"
          ? { ...chunk, errorText: safeModelError(chunk.errorText, userText) }
          : chunk
      );
    },
  });
}

const SAFE_RETRY_READ_ONLY_TOOL_TYPES = new Set<string>([
  "tool-webSearch",
  "tool-gmailReadMessages",
  "tool-calendarReadEvents",
  "tool-driveReadFiles",
  "tool-githubReadPullRequests",
  "tool-recallMemories",
  "tool-listMySchedules",
  "tool-getWeather",
  "tool-getCurrentTime",
  "tool-getFixtures",
]);

/**
 * True only when an assistant message executed a tool that could repeat a write
 * or stateful action on retry. Read-only lookups and unexecuted/pending-approval
 * tool calls remain safely retryable if the stream breaks mid-way.
 */
export function hasNonRetryableToolExecution(
  message: ChatMessage | undefined
): boolean {
  if (!message) {
    return false;
  }
  return message.parts.some((part) => {
    if (!part.type.startsWith("tool-")) {
      return false;
    }
    if (SAFE_RETRY_READ_ONLY_TOOL_TYPES.has(part.type as string)) {
      return false;
    }
    if (
      "state" in part &&
      (part.state === "input-streaming" ||
        part.state === "input-available" ||
        part.state === "approval-requested")
    ) {
      return false;
    }
    return true;
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
  const hadSideEffectTool = hasNonRetryableToolExecution(message);
  return {
    ...message,
    parts: [
      ...message.parts.filter(
        (p) => p.type !== "data-reply-status" && p.type !== "data-turn-status"
      ),
      {
        type: "data-reply-status",
        data: {
          status: completed ? "complete" : "interrupted",
          retryable: !completed && !hadSideEffectTool,
        },
      },
    ],
  };
}
