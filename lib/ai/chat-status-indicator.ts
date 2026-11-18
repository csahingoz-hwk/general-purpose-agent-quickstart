import type { UseChatHelpers } from "@ai-sdk/react";
import type { UiLocalePreference } from "@/hooks/use-ui-locale";
import { safeModelError } from "@/lib/ai/context/errors";
import {
  hasNonRetryableToolExecution,
  interruptedReply,
} from "@/lib/ai/conversation-state";
import { textLocale } from "@/lib/fixtures";
import type { ChatMessage } from "@/lib/types";
import { getCopy, type UiLocale } from "@/lib/ui-copy";

export type ChatStreamStatus = UseChatHelpers<ChatMessage>["status"];

export function resolveEffectiveChatLocale(opts: {
  preference: UiLocalePreference;
  detectedUiLocale: UiLocale;
  userText?: string;
}): UiLocale {
  if (opts.preference === "tr" || opts.preference === "en") {
    return opts.preference;
  }
  if (opts.detectedUiLocale === "tr") {
    return "tr";
  }
  const sample = opts.userText?.trim() ?? "";
  if (sample.length > 0 && textLocale(sample) === "tr") {
    return "tr";
  }
  return "en";
}

export type ResolvedReplyIndicator = {
  locale: UiLocale;
  showStandaloneThinkingBubble: boolean;
  assistantBubbleIsThinking: boolean;
  replyStatus: { text: string; visible: boolean } | null;
  liveRegionText: string;
};

/**
 * Resolves the single active turn indicator for a chat transcript:
 * - Shows at most ONE thinking label (matching `locale`, never EN + TR together).
 * - Clears `"Replying…"` / `"Yanıt yazıyor…"` immediately when the turn finishes
 *   (`status === "ready"`), errors (`status === "error"`), aborts (`aborted === true`),
 *   or receives a terminal `data-turn-status` (`phase === "done"`) / `data-reply-status` (`complete`).
 */
export function resolveChatReplyIndicatorState(opts: {
  status: ChatStreamStatus;
  messages: readonly ChatMessage[];
  preference: UiLocalePreference;
  detectedUiLocale: UiLocale;
  error?: Error;
  aborted?: boolean;
}): ResolvedReplyIndicator {
  const lastMessage = opts.messages.at(-1);
  const lastUserText =
    [...opts.messages]
      .reverse()
      .find((item) => item.role === "user")
      ?.parts.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ") ?? "";

  const locale = resolveEffectiveChatLocale({
    preference: opts.preference,
    detectedUiLocale: opts.detectedUiLocale,
    userText: lastUserText,
  });
  const localCopy = getCopy(locale);

  const interrupted = interruptedReply(lastMessage);
  const lastTurnPhase =
    lastMessage?.role === "assistant"
      ? [...lastMessage.parts]
          .reverse()
          .find((p) => p.type === "data-turn-status")?.data.phase
      : undefined;

  const hasAssistantContent =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some(
      (part) =>
        (part.type === "text" && part.text?.trim().length > 0) ||
        (part.type === "reasoning" &&
          "text" in part &&
          part.text?.trim().length > 0) ||
        part.type.startsWith("tool-")
    );

  const turnFinished =
    opts.aborted === true ||
    (opts.status !== "submitted" && opts.status !== "streaming") ||
    lastTurnPhase === "done" ||
    interrupted?.status === "complete" ||
    interrupted?.status === "interrupted";

  const showStandaloneThinkingBubble =
    !turnFinished &&
    opts.status === "submitted" &&
    lastMessage?.role !== "assistant";

  const assistantBubbleIsThinking =
    !turnFinished &&
    opts.status === "streaming" &&
    lastMessage?.role === "assistant" &&
    !hasAssistantContent;

  const hasPartialAssistantText =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some(
      (p) => p.type === "text" && p.text.trim().length > 0
    );
  const hasBlockingTool = hasNonRetryableToolExecution(lastMessage);

  const toolRunning =
    !turnFinished &&
    opts.status === "streaming" &&
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some(
      (p) =>
        p.type.startsWith("tool-") &&
        "state" in p &&
        (p.state === "input-streaming" || p.state === "input-available")
    );

  let replyStatus: { text: string; visible: boolean } | null = null;
  if (!turnFinished && opts.status === "submitted") {
    replyStatus = { text: localCopy.statusThinking, visible: false };
  } else if (toolRunning) {
    replyStatus = { text: localCopy.statusWorking, visible: true };
  } else if (!turnFinished && opts.status === "streaming") {
    replyStatus = { text: localCopy.statusReplying, visible: false };
  } else if (interrupted?.status === "interrupted") {
    replyStatus = {
      text: interrupted.retryable
        ? localCopy.statusInterrupted
        : localCopy.interruptedAfterTool,
      visible: true,
    };
  } else if (opts.status === "error" && hasPartialAssistantText) {
    replyStatus = {
      text: hasBlockingTool
        ? localCopy.interruptedAfterTool
        : localCopy.statusInterrupted,
      visible: true,
    };
  } else if (opts.status === "error") {
    replyStatus = {
      text: opts.error
        ? safeModelError(opts.error, lastUserText)
        : localCopy.statusError,
      visible: true,
    };
  }

  // Never duplicate "Thinking…" / "Düşünüyor…" in the sr-only live region when
  // ThinkingMessage or the empty assistant bubble is already rendering it.
  const liveRegionText =
    showStandaloneThinkingBubble || assistantBubbleIsThinking
      ? ""
      : (replyStatus?.text ?? "");

  return {
    locale,
    showStandaloneThinkingBubble,
    assistantBubbleIsThinking,
    replyStatus,
    liveRegionText,
  };
}
