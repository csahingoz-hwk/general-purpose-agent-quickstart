import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowDownIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMessages } from "@/hooks/use-messages";
import { canRetryReply, interruptedReply } from "@/lib/ai/conversation-state";
import type { Vote } from "@/lib/db/schema";
import type { MascotState } from "@/lib/mascot";
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
  activity: MascotState;
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
  activity,
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
    showJumpToLatest,
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

  // When the transcript scroller starts underneath the fixed header, pad by
  // that overlap so the first card is fully visible at the top of the scroll.
  const [headerClearance, setHeaderClearance] = useState(0);
  useLayoutEffect(() => {
    const scroller = messagesContainerRef.current;
    const header = document.querySelector("[data-chat-header]");
    if (!scroller || !(header instanceof HTMLElement)) {
      return;
    }
    const measure = () => {
      const overlap = Math.ceil(
        header.getBoundingClientRect().bottom -
          scroller.getBoundingClientRect().top
      );
      const next = Math.max(0, overlap);
      setHeaderClearance((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [messagesContainerRef]);

  const latestMessage = messages.at(-1);
  const animatedMessageId =
    latestMessage?.role === "assistant" ? latestMessage.id : null;

  return (
    <div className="relative z-20 flex min-h-0 flex-1 flex-col bg-background">
      {messages.length === 0 && !isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-6">
            <Greeting activity={activity} />
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
          "min-h-0 flex-1 touch-pan-y overflow-y-auto",
          messages.length > 0 ? "bg-background" : "bg-transparent"
        )}
        ref={messagesContainerRef}
        style={{
          ...(isArtifactVisible ? { scrollbarWidth: "none" as const } : {}),
          ...(headerClearance > 0 ? { scrollPaddingTop: headerClearance } : {}),
        }}
      >
        <div
          className="mx-auto flex min-h-full min-w-0 max-w-[760px] flex-col gap-4 px-4 py-4 md:px-6"
          style={
            headerClearance > 0
              ? {
                  paddingTop: `calc(1rem + ${headerClearance}px)`,
                  scrollMarginTop: headerClearance,
                }
              : undefined
          }
        >
          {messages.map((message, index) => (
            <PreviewMessage
              addToolApprovalResponse={addToolApprovalResponse}
              animateMascot={message.id === animatedMessageId}
              chatId={chatId}
              isLoading={
                status === "streaming" && messages.length - 1 === index
              }
              isReadonly={isReadonly}
              key={message.id}
              mascotState={message.id === animatedMessageId ? activity : "idle"}
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
            <ThinkingMessage state={activity} />
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

      <div
        className={cn(
          "flex shrink-0 justify-center bg-background",
          showJumpToLatest ? "px-4 pt-3 pb-2" : "h-0 overflow-hidden p-0"
        )}
      >
        <button
          aria-hidden={!showJumpToLatest}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]",
            showJumpToLatest ? "pointer-events-auto" : "pointer-events-none"
          )}
          data-testid="jump-to-latest"
          data-visible={showJumpToLatest}
          onClick={() => scrollToBottom("smooth")}
          tabIndex={showJumpToLatest ? 0 : -1}
          type="button"
        >
          <ArrowDownIcon className="size-4" />
          {copy.jumpToLatest}
        </button>
      </div>
    </div>
  );
}

export const Messages = PureMessages;
