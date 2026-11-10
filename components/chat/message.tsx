"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { Vote } from "@/lib/db/schema";
import { readFixturePayload } from "@/lib/fixtures";
import type { MascotState } from "@/lib/mascot";
import { visualPayload } from "@/lib/openui/attach";
import type { ChatMessage } from "@/lib/types";
import { getCopy } from "@/lib/ui-copy";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { AgentMascot } from "./agent-mascot";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { FictionalInboxCard } from "./fictional-inbox-card";
import { FixtureCard } from "./fixture-card";
import { useMascotPreference } from "./mascot-preference";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { OpenUiCard } from "./openui-card";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";
import { WebSearchCard } from "./web-search-card";

const copy = getCopy();

const PurePreviewMessage = ({
  addToolApprovalResponse,
  animateMascot = false,
  chatId,
  mascotState = "idle",
  message,
  vote,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
  locale = "en",
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  animateMascot?: boolean;
  chatId: string;
  mascotState?: MascotState;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  onEdit?: (message: ChatMessage) => void;
  locale?: "en" | "tr";
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  const { variant } = useMascotPreference();
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const fixture = isAssistant ? fixtureFromParts(message.parts) : null;
  const visual = isAssistant && !fixture ? visualPayload(message.parts) : null;

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div
      className="flex flex-row justify-end gap-2"
      data-testid={"message-attachments"}
    >
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            name: attachment.filename ?? "file",
            contentType: attachment.mediaType,
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
        };
      }
      return acc;
    },
    { text: "", isStreaming: false, rendered: false }
  ) ?? { text: "", isStreaming: false, rendered: false };

  const parts = message.parts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return (
          <MessageReasoning
            isLoading={isLoading || mergedReasoning.isStreaming}
            key={key}
            reasoning={mergedReasoning.text}
          />
        );
      }
      return null;
    }

    if (type === "text") {
      return (
        <MessageContent
          className={cn(
            "w-fit max-w-[min(85%,40rem)] overflow-hidden break-words rounded-[22px] px-4 py-2.5 text-[17px] leading-[1.45]",
            message.role === "user"
              ? "bg-bubble-user text-bubble-user-foreground [&_a]:text-bubble-user-foreground [&_a]:underline"
              : "bg-bubble-assistant text-foreground"
          )}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse className="text-inherit">
            {sanitizeText(part.text)}
          </MessageResponse>
        </MessageContent>
      );
    }

    if (type === "tool-demoInbox") {
      if (part.state === "output-available") {
        return (
          <FictionalInboxCard key={part.toolCallId} result={part.output} />
        );
      }

      return (
        <div className="text-muted-foreground text-sm" key={part.toolCallId}>
          {part.state === "output-error"
            ? "The fictional inbox demo could not be loaded."
            : "Preparing fictional inbox demo…"}
        </div>
      );
    }

    if (
      (type as string) === "tool-getCurrentTime" ||
      (type as string) === "tool-setHomeLocation"
    ) {
      // Internal helpers: the assistant states the result in its reply.
      return null;
    }

    if (type === "tool-webSearch") {
      return (
        <WebSearchCard
          key={part.toolCallId}
          locale={locale}
          output={"output" in part ? part.output : undefined}
          state={part.state}
        />
      );
    }

    if (type === "tool-getFixtures") {
      const pending =
        part.state === "input-streaming" || part.state === "input-available";
      if (!pending) {
        return null;
      }
      return (
        <p className="text-[13px] text-muted-foreground" key={part.toolCallId}>
          {locale === "tr"
            ? "Fikstür bakılıyor…"
            : "Checking the fixture list…"}
        </p>
      );
    }

    if (type === "tool-getWeather") {
      const { toolCallId, state } = part;
      const approvalId = (part as { approval?: { id: string } }).approval?.id;
      const isDenied =
        state === "output-denied" ||
        (state === "approval-responded" &&
          (part as { approval?: { approved?: boolean } }).approval?.approved ===
            false);
      const widthClass = "w-[min(100%,450px)]";

      if (state === "output-available" && "error" in part.output) {
        // location_required: the assistant asks which city, so no card is shown.
        return part.output.error === "location_required" ? null : (
          <p
            className={`${widthClass} rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground text-sm`}
            key={toolCallId}
            role="alert"
          >
            The weather forecast could not be loaded. Please try another
            location.
          </p>
        );
      }

      if (state === "output-available") {
        if (visual) {
          return null;
        }
        return (
          <div className={widthClass} key={toolCallId}>
            <Weather weatherAtLocation={part.output} />
          </div>
        );
      }

      if (isDenied) {
        return (
          <div className={widthClass} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state="output-denied" type="tool-getWeather" />
              <ToolContent>
                <div className="px-4 py-3 text-muted-foreground text-sm">
                  Weather lookup was denied.
                </div>
              </ToolContent>
            </Tool>
          </div>
        );
      }

      if (state === "approval-responded") {
        return (
          <div className={widthClass} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state={state} type="tool-getWeather" />
              <ToolContent>
                <ToolInput input={part.input} />
              </ToolContent>
            </Tool>
          </div>
        );
      }

      return (
        <div className={widthClass} key={toolCallId}>
          <Tool className="w-full" defaultOpen={true}>
            <ToolHeader state={state} type="tool-getWeather" />
            <ToolContent>
              {(state === "input-available" ||
                state === "approval-requested") && (
                <ToolInput input={part.input} />
              )}
              {state === "approval-requested" && approvalId && (
                <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                  <button
                    className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      addToolApprovalResponse({
                        id: approvalId,
                        approved: false,
                        reason: "User denied weather lookup",
                      });
                    }}
                    type="button"
                  >
                    Deny
                  </button>
                  <button
                    className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                    onClick={() => {
                      addToolApprovalResponse({
                        id: approvalId,
                        approved: true,
                      });
                    }}
                    type="button"
                  >
                    Allow
                  </button>
                </div>
              )}
            </ToolContent>
          </Tool>
        </div>
      );
    }

    if (type === "tool-createDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={toolCallId}
          >
            Error creating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <DocumentPreview
          isReadonly={isReadonly}
          key={toolCallId}
          result={part.output}
        />
      );
    }

    if (type === "tool-updateDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={toolCallId}
          >
            Error updating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <div className="relative" key={toolCallId}>
          <DocumentPreview
            args={{ ...part.output, isUpdate: true }}
            isReadonly={isReadonly}
            result={part.output}
          />
        </div>
      );
    }

    if (type === "tool-requestSuggestions") {
      const { toolCallId, state } = part;

      return (
        <Tool
          className="w-[min(100%,450px)]"
          defaultOpen={true}
          key={toolCallId}
        >
          <ToolHeader state={state} type="tool-requestSuggestions" />
          <ToolContent>
            {state === "input-available" && <ToolInput input={part.input} />}
            {state === "output-available" && (
              <ToolOutput
                errorText={undefined}
                output={
                  "error" in part.output ? (
                    <div className="rounded border p-2 text-red-500">
                      Error: {String(part.output.error)}
                    </div>
                  ) : (
                    <DocumentToolResult
                      isReadonly={isReadonly}
                      result={part.output}
                      type="request-suggestions"
                    />
                  )
                }
              />
            )}
          </ToolContent>
        </Tool>
      );
    }

    if (type.startsWith("tool-")) {
      const { toolCallId, state } = part as {
        toolCallId: string;
        state: string;
      };
      const input =
        "input" in part ? (part.input as Record<string, unknown>) : undefined;
      const output = "output" in part ? part.output : undefined;
      const errorText =
        "errorText" in part
          ? "This tool could not finish. Please try again later."
          : undefined;

      return (
        <Tool
          className="w-[min(100%,450px)]"
          defaultOpen={false}
          key={toolCallId}
        >
          <ToolHeader state={state as any} type={type as any} />
          <ToolContent>
            {input && <ToolInput input={input} />}
            {(state === "output-available" || state === "output-error") && (
              <ToolOutput
                errorText={errorText}
                output={
                  output ? (
                    <pre className="overflow-x-auto p-3 font-mono text-xs">
                      {JSON.stringify(output, null, 2)}
                    </pre>
                  ) : undefined
                }
              />
            )}
          </ToolContent>
        </Tool>
      );
    }

    return null;
  });

  const actions = !isReadonly && (
    <MessageActions
      chatId={chatId}
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onEdit={onEdit ? () => onEdit(message) : undefined}
      vote={vote}
    />
  );

  const content = isThinking ? (
    <div className="w-fit rounded-[22px] bg-bubble-assistant px-4 py-2.5 text-[17px] leading-[1.45]">
      <Shimmer className="font-medium" duration={1}>
        {copy.statusThinking}
      </Shimmer>
    </div>
  ) : (
    <>
      {attachments}
      {parts}
      {fixture && <FixtureCard locale={locale} payload={fixture} />}
      {actions}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          "flex min-w-0 gap-2",
          isUser ? "justify-end" : "items-start"
        )}
      >
        {isAssistant ? (
          <AgentMascot
            animated={animateMascot}
            className="mt-1"
            size={32}
            state={animateMascot ? mascotState : "idle"}
            variant={variant}
          />
        ) : null}
        <div
          className={cn(
            "flex min-w-0 flex-col gap-2",
            isUser ? "items-end" : "items-start"
          )}
        >
          {content}
          {visual && <OpenUiCard payload={visual} />}
        </div>
      </div>
    </div>
  );
};

function fixtureFromParts(parts: ChatMessage["parts"]) {
  for (const part of parts) {
    if (part.type !== "tool-getFixtures") {
      continue;
    }
    if ("state" in part && part.state && part.state !== "output-available") {
      continue;
    }
    if (!("output" in part)) {
      continue;
    }
    const payload = readFixturePayload(part.output);
    if (payload) {
      return payload;
    }
  }
  return null;
}

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = ({
  state = "thinking",
}: {
  state?: MascotState;
}) => {
  const { variant } = useMascotPreference();

  return (
    <div
      className="group/message w-full"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start gap-2">
        <AgentMascot animated size={32} state={state} variant={variant} />
        <div className="w-fit rounded-[22px] bg-bubble-assistant px-4 py-2.5 text-[17px] leading-[1.45]">
          <Shimmer className="font-medium" duration={1}>
            {copy.statusThinking}
          </Shimmer>
        </div>
      </div>
    </div>
  );
};
