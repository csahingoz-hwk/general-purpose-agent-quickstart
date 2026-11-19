import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowDownIcon, HistoryIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/hooks/use-messages";
import { useUiLocale } from "@/hooks/use-ui-locale";
import {
  resolveChatReplyIndicatorState,
  resolveEffectiveChatLocale,
} from "@/lib/ai/chat-status-indicator";
import { buildEarlierInChatSummary } from "@/lib/ai/context/thread-summary-shared";
import {
  canRetryReply,
  hasNonRetryableToolExecution,
  interruptedReply,
} from "@/lib/ai/conversation-state";
import type { Vote } from "@/lib/db/schema";
import type { MascotState } from "@/lib/mascot";
import { dedupeTurnMemoryCardsAcrossMessages } from "@/lib/memory/bulk-import";
import type { ChatMessage } from "@/lib/types";
import { getCopy } from "@/lib/ui-copy";
import { cn } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";
import { SuggestedActions } from "./suggested-actions";
import type { VisibilityType } from "./visibility-selector";

type MessagesProps = {
  activity: MascotState;
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  earlierSummary?: string | null;
  error?: Error;
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
  earlierSummary,
  error,
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

  const { dataStream } = useDataStream();

  const effectiveEarlierSummary = useMemo(() => {
    const streamed = [...(dataStream ?? [])]
      .reverse()
      .find((part) => part.type === "data-earlier-summary");
    if (streamed && typeof streamed.data === "string" && streamed.data.trim()) {
      return streamed.data;
    }
    if (earlierSummary?.trim()) {
      return earlierSummary.trim();
    }
    return buildEarlierInChatSummary(messages)?.summaryText ?? null;
  }, [dataStream, earlierSummary, messages]);

  const { preference: uiLocalePref, locale: detectedUiLocale } = useUiLocale();
  const lastMessage = messages.at(-1);
  const indicator = resolveChatReplyIndicatorState({
    status,
    messages,
    preference: uiLocalePref,
    detectedUiLocale,
    error,
  });
  const activeLocale = indicator.locale;
  const localCopy = getCopy(activeLocale);
  const interrupted = interruptedReply(lastMessage);
  const hasBlockingTool = hasNonRetryableToolExecution(lastMessage);
  const showRetry =
    !isReadonly &&
    status !== "submitted" &&
    status !== "streaming" &&
    (canRetryReply(messages) ||
      (status === "error" &&
        lastMessage?.role === "assistant" &&
        !hasBlockingTool));
  const replyStatus = indicator.replyStatus;

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

  const displayMessages = useMemo(
    () => dedupeTurnMemoryCardsAcrossMessages(messages),
    [messages]
  );
  const latestMessage = displayMessages.at(-1);
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
          {effectiveEarlierSummary && (
            <details
              className="rounded-2xl border border-[color:var(--hairline)] bg-card/80 px-4 py-3 text-sm"
              data-testid="earlier-in-chat-summary"
            >
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2 font-medium text-foreground text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <HistoryIcon className="size-3.5 text-primary" />
                  {localCopy.earlierInChatTitle}
                </span>
                <span className="font-normal text-[11px] text-muted-foreground">
                  {localCopy.earlierInChatSubtitle}
                </span>
              </summary>
              <pre className="mt-2.5 whitespace-pre-wrap break-words font-sans text-[13px] text-muted-foreground leading-relaxed">
                {effectiveEarlierSummary}
              </pre>
            </details>
          )}
          {displayMessages.map((message, index) => (
            <PreviewMessage
              addToolApprovalResponse={addToolApprovalResponse}
              animateMascot={message.id === animatedMessageId}
              chatId={chatId}
              isLoading={
                status === "streaming" && displayMessages.length - 1 === index
              }
              isReadonly={isReadonly}
              key={message.id}
              locale={resolveEffectiveChatLocale({
                preference: uiLocalePref,
                detectedUiLocale,
                userText:
                  displayMessages
                    .slice(0, index + 1)
                    .reverse()
                    .find((item) => item.role === "user")
                    ?.parts.filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join(" ") ?? "",
              })}
              mascotState={message.id === animatedMessageId ? activity : "idle"}
              message={message}
              onEdit={onEditMessage}
              onSelectQuestionOption={(answer) => {
                sendMessage({
                  role: "user",
                  parts: [{ type: "text", text: answer }],
                });
              }}
              regenerate={regenerate}
              requiresScrollPadding={
                hasSentMessage && index === displayMessages.length - 1
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
            <div className="px-10">
              <p
                aria-hidden="true"
                className={cn(
                  "text-sm",
                  status === "error" || interrupted?.status === "interrupted"
                    ? "rounded-xl border border-border bg-card/80 px-3.5 py-2.5 text-foreground"
                    : "text-muted-foreground"
                )}
                data-testid="reply-status-text"
              >
                {replyStatus.text}
              </p>
            </div>
          )}

          {showRetry && (
            <div className="flex justify-start pl-10">
              <button
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 font-medium text-sm transition-colors hover:bg-muted motion-reduce:transition-none"
                data-testid="retry-response"
                onClick={() => regenerate({ body: { retry: true } })}
                type="button"
              >
                <RotateCcwIcon className="size-4" />
                {localCopy.retryResponse}
              </button>
            </div>
          )}

          {indicator.showStandaloneThinkingBubble && (
            <ThinkingMessage locale={activeLocale} state={activity} />
          )}

          <output
            aria-live="polite"
            className="sr-only"
            data-testid="reply-status"
          >
            {indicator.liveRegionText}
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
          {localCopy.jumpToLatest}
        </button>
      </div>
    </div>
  );
}

export const Messages = PureMessages;
