import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowDownIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useMessages } from "@/hooks/use-messages";
import { canRetryReply, interruptedReply } from "@/lib/ai/conversation-state";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { getCopy } from "@/lib/ui-copy";
import { cn } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";
import { SuggestedActions } from "./suggested-actions";
import type { VisibilityType } from "./visibility-selector";

const copy = getCopy();

type MessagesProps = {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  status: UseChatHelpers<ChatMessage>["status"];
  votes: Vote[] | undefined;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  isArtifactVisible: boolean;
  isLoading?: boolean;
  selectedModelId: string;
  selectedVisibilityType: VisibilityType;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  onEditMessage?: (message: ChatMessage) => void;
};

function PureMessages({
  addToolApprovalResponse,
  chatId,
  status,
  votes,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  isArtifactVisible,
  isLoading,
  selectedModelId: _selectedModelId,
  selectedVisibilityType,
  sendMessage,
  onEditMessage,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
    reset,
  } = useMessages({
    status,
  });

  useDataStream();

  const lastMessage = messages.at(-1);
  const interrupted = interruptedReply(lastMessage);
  const showRetry =
    !isReadonly &&
    status !== "submitted" &&
    status !== "streaming" &&
    (canRetryReply(messages) ||
      (status === "error" &&
        lastMessage?.role === "assistant" &&
        !lastMessage.parts.some((p) => p.type.startsWith("tool-"))));
  // Existing state only: a tool part that has input but no output yet.
  const toolRunning =
    status === "streaming" &&
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some(
      (p) =>
        p.type.startsWith("tool-") &&
        "state" in p &&
        (p.state === "input-streaming" || p.state === "input-available")
    );
  // `visible` text is shown; the rest is only announced to screen readers
  // (the pending "Thinking…" indicator is already drawn by ThinkingMessage).
  let replyStatus: { text: string; visible: boolean } | null = null;
  if (status === "submitted") {
    replyStatus = { text: copy.statusThinking, visible: false };
  } else if (toolRunning) {
    replyStatus = { text: copy.statusWorking, visible: true };
  } else if (status === "streaming") {
    replyStatus = { text: copy.statusReplying, visible: false };
  } else if (interrupted?.status === "interrupted") {
    replyStatus = {
      text: interrupted.retryable
        ? copy.statusInterrupted
        : copy.interruptedAfterTool,
      visible: true,
    };
  } else if (status === "error") {
    replyStatus = { text: copy.statusError, visible: true };
  }

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      reset();
    }
  }, [chatId, reset]);

  return (
    <div className="relative flex-1 bg-background">
      {messages.length === 0 && !isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-6">
            <Greeting />
            <SuggestedActions
              chatId={chatId}
              selectedVisibilityType={selectedVisibilityType}
              sendMessage={sendMessage}
            />
          </div>
        </div>
      )}
      <div
        className={cn(
          "absolute inset-0 touch-pan-y overflow-y-auto",
          messages.length > 0 ? "bg-background" : "bg-transparent"
        )}
        ref={messagesContainerRef}
        style={isArtifactVisible ? { scrollbarWidth: "none" } : undefined}
      >
        <div className="mx-auto flex min-h-full min-w-0 max-w-[760px] flex-col gap-4 px-4 py-4 md:px-6">
          {messages.map((message, index) => (
            <PreviewMessage
              addToolApprovalResponse={addToolApprovalResponse}
              chatId={chatId}
              isLoading={
                status === "streaming" && messages.length - 1 === index
              }
              isReadonly={isReadonly}
              key={message.id}
              message={message}
              onEdit={onEditMessage}
              regenerate={regenerate}
              requiresScrollPadding={
                hasSentMessage && index === messages.length - 1
              }
              setMessages={setMessages}
              vote={
                votes
                  ? votes.find((vote) => vote.messageId === message.id)
                  : undefined
              }
            />
          ))}

          {replyStatus?.visible && (
            <p
              aria-hidden="true"
              className="px-10 text-sm text-muted-foreground"
              data-testid="reply-status-text"
            >
              {replyStatus.text}
            </p>
          )}

          {showRetry && (
            <div className="flex justify-start pl-10">
              <button
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm transition-colors hover:bg-muted motion-reduce:transition-none"
                data-testid="retry-response"
                onClick={() => regenerate({ body: { retry: true } })}
                type="button"
              >
                <RotateCcwIcon className="size-4" />
                {copy.retryResponse}
              </button>
            </div>
          )}

          {status === "submitted" && messages.at(-1)?.role !== "assistant" && (
            <ThinkingMessage />
          )}

          <output
            aria-live="polite"
            className="sr-only"
            data-testid="reply-status"
          >
            {replyStatus?.text}
          </output>

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </div>
      </div>

      <button
        aria-hidden={isAtBottom}
        className={cn(
          "absolute bottom-4 left-1/2 z-10 inline-flex h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm text-foreground shadow-[var(--shadow-float)] transition-[opacity,transform] duration-150 motion-reduce:transition-none",
          isAtBottom
            ? "pointer-events-none scale-95 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        )}
        data-testid="jump-to-latest"
        data-visible={!isAtBottom}
        onClick={() => scrollToBottom("smooth")}
        tabIndex={isAtBottom ? -1 : 0}
        type="button"
      >
        <ArrowDownIcon className="size-4" />
        {copy.jumpToLatest}
      </button>
    </div>
  );
}

export const Messages = PureMessages;
