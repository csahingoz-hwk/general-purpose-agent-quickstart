"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import { isScreenHandoffPayload } from "@/lib/cloud-computer/screen-handoff";
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
import { ApprovalCard } from "./approval-card";
import { CloudComputerCard } from "./cloud-computer-card";
import {
  ConnectorConnectCard,
  ConnectorSummaryCard,
  getDisabledApiNeutralMessage,
  isDisabledApiOutput,
  isSetupRequiredOutput,
} from "./connector-connect-card";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { FictionalInboxCard } from "./fictional-inbox-card";
import { FixtureCard } from "./fixture-card";
import { MacBridgeCard } from "./mac-bridge-card";
import { useMascotPreference } from "./mascot-preference";
import { isMediaPreviewPayload, MediaPreviewCard } from "./media-preview-card";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { OpenUiCard } from "./openui-card";
import { OutboundDraftCard } from "./outbound-draft-card";
import { PreviewAttachment } from "./preview-attachment";
import { QuestionCard } from "./question-card";
import { SavedMemoryCard } from "./saved-memory-card";
import { ScreenHandoffCard } from "./screen-handoff-card";
import {
  type AgentLoopStepItem,
  AgentLoopStepStrip,
  isTaskCardPayload,
  TaskCard,
} from "./task-card";
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
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
  onSelectQuestionOption,
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
  onSelectQuestionOption?: (answer: string) => void;
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
  const turnStatus = isAssistant
    ? [...message.parts].reverse().find((p) => p.type === "data-turn-status")
        ?.data
    : undefined;
  const modelUsed = isAssistant
    ? [...message.parts].reverse().find((p) => p.type === "data-model-used")
        ?.data
    : undefined;
  const agentSteps: AgentLoopStepItem[] = isAssistant
    ? message.parts
        .filter((p) => p.type === "data-task-step")
        .map((p) => p.data)
    : [];

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;
  if (isAssistant && !isLoading && !hasAnyContent && !fixture && !visual) {
    return null;
  }

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

  const hasExclusiveConnectorCard =
    isAssistant &&
    Boolean(
      message.parts?.some((p) => {
        if (!p.type.startsWith("tool-")) {
          return false;
        }
        const tName = p.type.slice(5);
        if (
          !(
            tName.startsWith("gmail") ||
            tName.startsWith("calendar") ||
            tName.startsWith("drive") ||
            tName.startsWith("github")
          )
        ) {
          return false;
        }
        const st = (p as { state?: string }).state;
        const out = "output" in p ? p.output : undefined;
        return (
          (st === "output-available" || st === "output-error") &&
          (isSetupRequiredOutput(out) ||
            isDisabledApiOutput(out) ||
            st === "output-error")
        );
      })
    ) &&
    !message.parts?.some((p) => {
      if (!p.type.startsWith("tool-")) {
        return false;
      }
      const out = "output" in p ? p.output : undefined;
      return (
        out &&
        typeof out === "object" &&
        (out as { status?: string }).status === "ok"
      );
    });

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
      if (hasExclusiveConnectorCard) {
        return null;
      }
      const cleanedText = sanitizeText(part.text);
      if (!cleanedText.trim()) {
        return null;
      }
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
            {cleanedText}
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
            <Tool className="w-full" defaultOpen={false}>
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

      if (state === "approval-requested" || state === "approval-responded") {
        return (
          <ApprovalCard
            addToolApprovalResponse={addToolApprovalResponse}
            approvalId={approvalId}
            approved={
              (part as { approval?: { approved?: boolean } }).approval?.approved
            }
            input={part.input}
            isReadonly={isReadonly}
            key={toolCallId}
            locale={locale}
            state={state}
            title={getCopy(locale).titleWeatherApproval}
            toolName="getWeather"
          />
        );
      }

      return (
        <div className={widthClass} key={toolCallId}>
          <Tool className="w-full" defaultOpen={false}>
            <ToolHeader state={state} type="tool-getWeather" />
            <ToolContent>
              {state === "input-available" && <ToolInput input={part.input} />}
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
          defaultOpen={false}
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

    if (type === "tool-draftOutboundMessage") {
      const approval = (
        part as {
          approval?: { id?: string; approved?: boolean; reason?: string };
        }
      ).approval;
      return (
        <OutboundDraftCard
          addToolApprovalResponse={addToolApprovalResponse}
          approvalId={approval?.id}
          approvalReason={approval?.reason}
          approved={approval?.approved}
          input={"input" in part ? part.input : undefined}
          isReadonly={isReadonly}
          key={part.toolCallId}
          locale={locale}
          onUpdateDraftInput={(patch) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id !== message.id
                  ? m
                  : {
                      ...m,
                      parts: m.parts.map((p) =>
                        "toolCallId" in p && p.toolCallId === part.toolCallId
                          ? ({
                              ...p,
                              input: {
                                ...("input" in p &&
                                typeof p.input === "object" &&
                                p.input !== null
                                  ? p.input
                                  : {}),
                                ...patch,
                              },
                            } as typeof p)
                          : p
                      ),
                    }
              )
            );
          }}
          output={
            part.state === "output-available" && "output" in part
              ? part.output
              : undefined
          }
          state={part.state}
        />
      );
    }

    if (type === "tool-askUserQuestion") {
      if (
        part.state === "output-available" &&
        "output" in part &&
        part.output
      ) {
        return (
          <QuestionCard
            isReadonly={isReadonly}
            key={part.toolCallId}
            locale={locale}
            onSelectOption={onSelectQuestionOption}
            payload={part.output}
          />
        );
      }
      return null;
    }

    if (type.startsWith("tool-")) {
      const { toolCallId, state } = part as {
        toolCallId: string;
        state: string;
      };
      const toolName = type.slice(5);
      const approval = (
        part as {
          approval?: { id?: string; approved?: boolean; reason?: string };
        }
      ).approval;
      const input =
        "input" in part ? (part.input as Record<string, unknown>) : undefined;
      const output = "output" in part ? part.output : undefined;
      const errorText =
        "errorText" in part
          ? "This tool could not finish. Please try again later."
          : undefined;

      const isDraftApprovalTool =
        toolName === "gmailCreateDraft" ||
        toolName === "driveCreateDraftDoc" ||
        toolName === "calendarCreateDraftEvent" ||
        toolName === "githubCreateDraftReview" ||
        toolName === "scheduleTask";
      const isPolicyReceipt =
        output &&
        typeof output === "object" &&
        ((output as { status?: string }).status === "blocked_by_owner_rule" ||
          (output as { status?: string }).status === "interrupted_on_restart");

      if (
        state === "approval-requested" ||
        state === "approval-responded" ||
        state === "output-denied" ||
        (state === "output-available" &&
          (isDraftApprovalTool || isPolicyReceipt) &&
          !isDisabledApiOutput(output) &&
          !isSetupRequiredOutput(output))
      ) {
        const cardCopy = getCopy(locale);
        const friendlyTitles: Record<string, string> = {
          gmailCreateDraft: cardCopy.titleGmailDraft,
          driveCreateDraftDoc: cardCopy.titleDriveDraft,
          calendarCreateDraftEvent: cardCopy.titleCalendarDraft,
          githubCreateDraftReview: cardCopy.titleGithubDraft,
          generateVideoClip: cardCopy.titleVideoClip,
          scheduleTask: cardCopy.titleScheduleTask,
        };
        return (
          <ApprovalCard
            addToolApprovalResponse={addToolApprovalResponse}
            approvalId={approval?.id}
            approvalReason={approval?.reason}
            approved={approval?.approved}
            input={input}
            isReadonly={isReadonly}
            key={toolCallId}
            locale={locale}
            onUpdateDraftInput={(patch) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id !== message.id
                    ? m
                    : {
                        ...m,
                        parts: m.parts.map((p) =>
                          "toolCallId" in p && p.toolCallId === toolCallId
                            ? ({
                                ...p,
                                input: {
                                  ...(input ?? {}),
                                  ...patch,
                                },
                              } as typeof p)
                            : p
                        ),
                      }
                )
              );
            }}
            output={state === "output-available" ? output : undefined}
            state={state}
            title={friendlyTitles[toolName] ?? toolName}
            toolName={toolName}
          />
        );
      }

      if (
        toolName === "delegateTask" ||
        (state === "output-available" && isTaskCardPayload(output))
      ) {
        return (
          <TaskCard
            input={input}
            isReadonly={isReadonly}
            key={toolCallId}
            locale={locale}
            payload={isTaskCardPayload(output) ? output : undefined}
            state={state}
          />
        );
      }

      if (
        state === "output-available" &&
        isDisabledApiOutput(output) &&
        (toolName.startsWith("gmail") ||
          toolName.startsWith("calendar") ||
          toolName.startsWith("drive"))
      ) {
        return (
          <MessageContent
            className="w-fit max-w-[min(85%,40rem)] overflow-hidden break-words rounded-[22px] bg-bubble-assistant px-4 py-2.5 text-[17px] text-foreground leading-[1.45]"
            data-testid="connector-disabled-message"
            key={toolCallId}
          >
            <MessageResponse className="text-inherit">
              {getDisabledApiNeutralMessage(toolName)}
            </MessageResponse>
          </MessageContent>
        );
      }

      if (
        (state === "output-available" || state === "output-error") &&
        (isSetupRequiredOutput(output) || state === "output-error") &&
        (toolName.startsWith("gmail") ||
          toolName.startsWith("calendar") ||
          toolName.startsWith("drive") ||
          toolName.startsWith("github"))
      ) {
        const provider =
          (isSetupRequiredOutput(output)
            ? output.connectProvider
            : undefined) ??
          (toolName.startsWith("github") ? "github" : "google");
        const mode =
          isSetupRequiredOutput(output) && output.status === "setup_required"
            ? "connect"
            : "reconnect";
        return (
          <ConnectorConnectCard
            chatId={chatId}
            key={toolCallId}
            locale={locale}
            mode={mode}
            onRetry={
              isReadonly
                ? undefined
                : () => {
                    regenerate({ body: { retry: true } });
                  }
            }
            provider={provider}
            reasonMessage={
              isSetupRequiredOutput(output) ? output.message : undefined
            }
          />
        );
      }

      if (
        state === "output-available" &&
        output &&
        typeof output === "object" &&
        (output as { status?: string }).status === "ok" &&
        (toolName === "gmailReadMessages" ||
          toolName === "calendarReadEvents" ||
          toolName === "driveReadFiles" ||
          toolName === "githubReadPullRequests")
      ) {
        return (
          <ConnectorSummaryCard
            key={toolCallId}
            locale={locale}
            output={output as Record<string, unknown>}
            toolName={toolName}
          />
        );
      }

      if (
        state === "output-available" &&
        output &&
        typeof output === "object" &&
        (toolName === "macExec" || toolName === "macRunAgentCli")
      ) {
        return (
          <MacBridgeCard
            key={toolCallId}
            locale={locale}
            output={output as Record<string, unknown>}
          />
        );
      }

      if (state === "output-available" && isScreenHandoffPayload(output)) {
        return (
          <ScreenHandoffCard
            isReadonly={isReadonly}
            key={toolCallId}
            locale={locale}
            onRespond={(decision) => {
              if (decision === "im_here" && onSelectQuestionOption) {
                onSelectQuestionOption(
                  locale === "tr"
                    ? "Bulut Bilgisayar ekranındayım, devam edebilirsin."
                    : "I'm on the Cloud Computer screen — go ahead and continue."
                );
              }
            }}
            payload={output}
          />
        );
      }

      if (
        state === "output-available" &&
        output &&
        typeof output === "object" &&
        (toolName === "cloudExec" ||
          toolName === "cloudWriteFile" ||
          toolName === "cloudReadFile" ||
          toolName === "cloudExportFileToChat" ||
          toolName === "cloudBrowseUrl")
      ) {
        return (
          <CloudComputerCard
            key={toolCallId}
            locale={locale}
            output={output as Record<string, unknown>}
            toolName={toolName}
          />
        );
      }

      if (toolName === "saveProfileFact" || toolName === "addJournalEntry") {
        return (
          <SavedMemoryCard
            input={input}
            key={toolCallId}
            locale={locale}
            output={output}
            state={state}
          />
        );
      }

      if (
        (toolName === "generateImageAsset" ||
          toolName === "generateVideoClip") &&
        state === "output-available" &&
        isMediaPreviewPayload(output)
      ) {
        return (
          <MediaPreviewCard key={toolCallId} locale={locale} payload={output} />
        );
      }

      const isToolError =
        state === "output-error" ||
        Boolean(errorText) ||
        (Boolean(output) &&
          typeof output === "object" &&
          ((output as { status?: string }).status === "error" ||
            (output as { status?: string }).status === "connector_error" ||
            "error" in (output as Record<string, unknown>)));

      return (
        <Tool
          className="w-[min(100%,450px)]"
          defaultOpen={false}
          key={toolCallId}
        >
          <ToolHeader
            state={isToolError ? "output-error" : (state as any)}
            type={type as any}
          />
          <ToolContent>
            {isToolError ? (
              <>
                <ToolOutput errorText={errorText} output={output} />
                {input && (
                  <details
                    className="rounded-lg border border-[color:var(--hairline)] bg-muted/20 px-3 py-2 text-xs"
                    data-testid="tool-input-details"
                  >
                    <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
                      {getCopy(locale).parameterDetails}
                    </summary>
                    <div className="mt-2">
                      <ToolInput input={input} />
                    </div>
                  </details>
                )}
              </>
            ) : (
              <>
                {input && <ToolInput input={input} />}
                {state === "output-available" && (
                  <ToolOutput errorText={errorText} output={output} />
                )}
              </>
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
    turnStatus?.phase === "searching" &&
    turnStatus?.model !== "claude-haiku-5.5" ? (
      <WebSearchCard
        locale={locale}
        output={undefined}
        state="input-available"
      />
    ) : (
      <div className="w-fit rounded-[22px] bg-bubble-assistant px-4 py-2.5 text-[17px] leading-[1.45]">
        <Shimmer className="font-medium" duration={1}>
          {turnStatus?.model === "claude-haiku-5.5"
            ? locale === "tr"
              ? "Claude Haiku 5.5 (Copilot) yanıtlıyor…"
              : "Answering with Claude Haiku 5.5 (Copilot)…"
            : turnStatus?.phase === "weather"
              ? locale === "tr"
                ? "Hava durumu kontrol ediliyor…"
                : "Checking the weather…"
              : turnStatus?.phase === "fixtures"
                ? locale === "tr"
                  ? "Fikstür bakılıyor…"
                  : "Checking the fixture list…"
                : turnStatus?.phase === "tool"
                  ? locale === "tr"
                    ? "Araç çalıştırılıyor…"
                    : "Running tool…"
                  : copy.statusThinking}
        </Shimmer>
      </div>
    )
  ) : (
    <>
      {attachments}
      {modelUsed && (
        <div
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-[12px] leading-tight",
            modelUsed.isFallback
              ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-[color:var(--hairline)] bg-muted/60 text-muted-foreground"
          )}
          data-fallback={modelUsed.isFallback ? "true" : "false"}
          data-model-id={modelUsed.modelId}
          data-testid="message-model-badge"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              modelUsed.isFallback ? "bg-amber-500" : "bg-emerald-500"
            )}
          />
          <span className="truncate">
            {modelUsed.isFallback
              ? locale === "tr"
                ? `${modelUsed.modelName} · Copilot yedek`
                : `${modelUsed.modelName} · Copilot fallback`
              : modelUsed.modelName}
          </span>
        </div>
      )}
      {agentSteps.length >= 2 && (
        <AgentLoopStepStrip locale={locale} steps={agentSteps} />
      )}
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
      data-message-id={message.id}
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
            "flex min-w-0 flex-1 flex-col gap-2",
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
