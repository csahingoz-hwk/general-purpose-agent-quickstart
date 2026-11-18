"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  CheckCircle2Icon,
  EyeIcon,
  MailIcon,
  MessageSquareIcon,
  PencilIcon,
  SendIcon,
  WebhookIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "@/components/chat/toast";
import type { OutboundDraftResult } from "@/lib/ai/tools/draft-outbound";
import type { ChatMessage } from "@/lib/types";
import { getCopy, type UiLocale } from "@/lib/ui-copy";
import type { DraftInputPatch } from "./approval-card";

type DraftInput = {
  channel?: string;
  recipient?: string;
  subject?: string;
  body?: string;
};

const CHANNEL_LABELS: Record<UiLocale, Record<string, string>> = {
  en: {
    email: "Email",
    telegram: "Telegram",
    slack: "Slack",
    webhook: "Webhook",
  },
  tr: {
    email: "E-posta",
    telegram: "Telegram",
    slack: "Slack",
    webhook: "Webhook",
  },
};

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "email") {
    return <MailIcon className="size-4 shrink-0 text-primary" />;
  }
  if (channel === "webhook") {
    return <WebhookIcon className="size-4 shrink-0 text-primary" />;
  }
  if (channel === "telegram") {
    return <SendIcon className="size-4 shrink-0 text-primary" />;
  }
  return <MessageSquareIcon className="size-4 shrink-0 text-primary" />;
}

export function OutboundDraftCard({
  addToolApprovalResponse,
  approvalId,
  approvalReason,
  approved,
  input,
  isReadonly = false,
  locale = "tr",
  onUpdateDraftInput,
  output,
  state,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  approvalId?: string;
  approvalReason?: string;
  approved?: boolean;
  input?: DraftInput;
  isReadonly?: boolean;
  locale?: UiLocale;
  onUpdateDraftInput?: (patch: DraftInputPatch) => void;
  output?: OutboundDraftResult;
  state: string;
}) {
  const copy = getCopy(locale);
  const { mutate } = useSWRConfig();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  const channel = output?.channel ?? input?.channel ?? "email";
  const initialRecipient = output?.recipient ?? input?.recipient ?? "";
  const initialSubject = output?.subject ?? input?.subject ?? "";
  const initialBody = output?.body ?? input?.body ?? "";

  const [isEditing, setIsEditing] = useState(false);
  const [draftTo, setDraftTo] = useState(initialRecipient);
  const [draftSubject, setDraftSubject] = useState(initialSubject);
  const [draftBody, setDraftBody] = useState(initialBody);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);

  useEffect(() => {
    if (!hasUserEdited) {
      setDraftTo(initialRecipient);
      setDraftSubject(initialSubject);
      setDraftBody(initialBody);
    }
  }, [hasUserEdited, initialRecipient, initialSubject, initialBody]);

  const isPending = state === "approval-requested" && Boolean(approvalId);
  const isDenied =
    state === "output-denied" ||
    (state === "approval-responded" && approved === false);
  const isExpired = approvalReason === "expired_by_new_message";
  const isCompleted = state === "output-available" && Boolean(output);

  function handleSave() {
    if (!approvalId) {
      return;
    }
    const cleanTo = draftTo.trim();
    const cleanSubject = draftSubject.trim();
    const editedChanged =
      cleanTo !== initialRecipient.trim() ||
      cleanSubject !== initialSubject.trim() ||
      draftBody !== initialBody;
    setIsEditing(false);
    if (editedChanged) {
      onUpdateDraftInput?.({
        recipient: cleanTo,
        subject: cleanSubject,
        body: draftBody,
      });
    }
    addToolApprovalResponse({
      id: approvalId,
      approved: true,
      ...(editedChanged && channel === "email"
        ? {
            options: {
              body: {
                editedDraftApproval: {
                  approvalId,
                  recipient: cleanTo,
                  subject: cleanSubject,
                  body: draftBody,
                },
              },
            },
          }
        : {}),
    });
  }

  async function handlePersistRule(decision: "always_allow" | "never_allow") {
    if (!approvalId || ruleBusy) {
      return;
    }
    setRuleBusy(true);
    try {
      await fetch(`${basePath}/api/settings/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName: "draftOutboundMessage", decision }),
      }).catch(() => null);
      mutate(`${basePath}/api/settings/approvals`);
      if (decision === "always_allow") {
        handleSave();
      } else {
        setIsEditing(false);
        addToolApprovalResponse({
          id: approvalId,
          approved: false,
          reason: "Blocked by owner Never allow rule",
        });
      }
    } finally {
      setRuleBusy(false);
      toast({
        type: "success",
        description:
          decision === "always_allow"
            ? `draftOutboundMessage: ${copy.alwaysAllow}`
            : `draftOutboundMessage: ${copy.neverAllow}`,
      });
    }
  }

  return (
    <section
      className="w-[min(100%,40rem)] rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-foreground"
      data-testid="outbound-draft-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChannelIcon channel={channel} />
          <h3 className="font-semibold text-[15px] leading-snug">
            {locale === "tr" ? "Mesaj taslağı kaydet" : "Save message draft"}
          </h3>
          <span className="rounded-full border border-[color:var(--hairline)] bg-muted/50 px-2.5 py-0.5 font-medium text-xs">
            {CHANNEL_LABELS[locale][channel] ?? channel}
          </span>
        </div>
        <span
          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-300"
          data-testid="approval-never-sends-badge"
        >
          {copy.badgeNeverSends}
        </span>
      </div>

      {isEditing && isPending && !isReadonly ? (
        <div className="mt-3 space-y-3 rounded-2xl border border-[color:var(--hairline)] bg-muted/20 p-3.5">
          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {copy.fieldTo}
            </span>
            <input
              className="w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="draft-edit-to"
              onChange={(e) => {
                setHasUserEdited(true);
                setDraftTo(e.target.value);
              }}
              type="text"
              value={draftTo}
            />
          </label>
          {(channel === "email" || draftSubject) && (
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {copy.fieldSubject}
              </span>
              <input
                className="w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="draft-edit-subject"
                onChange={(e) => {
                  setHasUserEdited(true);
                  setDraftSubject(e.target.value);
                }}
                type="text"
                value={draftSubject}
              />
            </label>
          )}
          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {copy.fieldMessage}
            </span>
            <textarea
              className="w-full rounded-xl border border-[color:var(--hairline)] bg-background px-3 py-2 text-base text-foreground leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="draft-edit-body"
              onChange={(e) => {
                setHasUserEdited(true);
                setDraftBody(e.target.value);
              }}
              rows={5}
              value={draftBody}
            />
          </label>
        </div>
      ) : (
        <div className="mt-3 divide-y divide-[color:var(--hairline)] rounded-2xl border border-[color:var(--hairline)] bg-muted/20 text-[14px]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
            <span className="w-12 shrink-0 font-medium text-muted-foreground text-xs">
              {copy.fieldTo}
            </span>
            <span className="min-w-0 flex-1 break-all text-foreground">
              {draftTo || "—"}
            </span>
          </div>
          {draftSubject ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
              <span className="w-12 shrink-0 font-medium text-muted-foreground text-xs">
                {copy.fieldSubject}
              </span>
              <span className="min-w-0 flex-1 break-words font-medium text-foreground">
                {draftSubject}
              </span>
            </div>
          ) : null}
          <div className="whitespace-pre-wrap break-words px-3.5 py-3 text-[15px] text-foreground leading-relaxed">
            {draftBody}
          </div>
        </div>
      )}

      {isPending && !isReadonly && approvalId && (
        <div className="mt-4 space-y-2.5 border-[color:var(--hairline)] border-t pt-3">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <button
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-[13px] text-foreground transition-colors hover:bg-muted motion-reduce:transition-none"
              data-testid="draft-edit-button"
              onClick={() => setIsEditing((prev) => !prev)}
              type="button"
            >
              {isEditing ? (
                <>
                  <EyeIcon className="size-3.5 shrink-0" />
                  <span>{copy.preview}</span>
                </>
              ) : (
                <>
                  <PencilIcon className="size-3.5 shrink-0" />
                  <span>{copy.edit}</span>
                </>
              )}
            </button>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-[13px] text-foreground transition-colors hover:bg-muted motion-reduce:transition-none"
                data-testid="draft-deny-button"
                onClick={() => {
                  setIsEditing(false);
                  addToolApprovalResponse({
                    id: approvalId,
                    approved: false,
                    reason: "Draft cancelled by owner",
                  });
                }}
                type="button"
              >
                {copy.cancel}
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 font-medium text-[13px] text-primary-foreground transition-colors hover:bg-primary/90 motion-reduce:transition-none"
                data-testid="draft-approve-button"
                onClick={handleSave}
                type="button"
              >
                {copy.save}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-muted/40 px-3 font-medium text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              data-testid="approval-always-allow-button"
              disabled={ruleBusy}
              onClick={() => handlePersistRule("always_allow")}
              type="button"
            >
              {copy.alwaysAllow}
            </button>
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-muted/40 px-3 font-medium text-[12px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              data-testid="approval-never-allow-button"
              disabled={ruleBusy}
              onClick={() => handlePersistRule("never_allow")}
              type="button"
            >
              {copy.neverAllow}
            </button>
          </div>
        </div>
      )}

      {isDenied && (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground"
          data-testid={
            isExpired ? "approval-expired-notice" : "approval-denied-notice"
          }
        >
          <XCircleIcon className="size-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span>
            {isExpired
              ? copy.approvalExpiredNotice
              : copy.approvalDeclinedNotice}
          </span>
        </div>
      )}

      {isCompleted && output && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-300">
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>{copy.approvalSavedGeneric}</span>
        </div>
      )}

      {(input || output) && (
        <details
          className="mt-3 rounded-xl border border-[color:var(--hairline)] bg-muted/20 px-3 py-2 text-xs"
          data-testid="approval-technical-details"
        >
          <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
            {copy.technicalDetails}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {JSON.stringify(output ?? input, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
