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
import type { OutboundDraftResult } from "@/lib/ai/tools/draft-outbound";
import type { ChatMessage } from "@/lib/types";
import type { DraftInputPatch } from "./approval-card";

type DraftInput = {
  channel?: string;
  recipient?: string;
  subject?: string;
  body?: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "E-posta",
  telegram: "Telegram",
  slack: "Slack",
  webhook: "Webhook",
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
  approved,
  input,
  isReadonly = false,
  onUpdateDraftInput,
  output,
  state,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  approvalId?: string;
  approved?: boolean;
  input?: DraftInput;
  isReadonly?: boolean;
  locale?: "en" | "tr";
  onUpdateDraftInput?: (patch: DraftInputPatch) => void;
  output?: OutboundDraftResult;
  state: string;
}) {
  const channel = output?.channel ?? input?.channel ?? "email";
  const initialRecipient = output?.recipient ?? input?.recipient ?? "";
  const initialSubject = output?.subject ?? input?.subject ?? "";
  const initialBody = output?.body ?? input?.body ?? "";

  const [isEditing, setIsEditing] = useState(false);
  const [draftTo, setDraftTo] = useState(initialRecipient);
  const [draftSubject, setDraftSubject] = useState(initialSubject);
  const [draftBody, setDraftBody] = useState(initialBody);
  const [hasUserEdited, setHasUserEdited] = useState(false);

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

  return (
    <section
      className="w-[min(100%,40rem)] rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-foreground"
      data-testid="outbound-draft-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChannelIcon channel={channel} />
          <h3 className="font-semibold text-[15px] leading-snug">
            Mesaj taslağı kaydet
          </h3>
          <span className="rounded-full border border-[color:var(--hairline)] bg-muted/50 px-2.5 py-0.5 font-medium text-xs">
            {CHANNEL_LABELS[channel] ?? channel}
          </span>
        </div>
        <span
          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-300"
          data-testid="approval-never-sends-badge"
        >
          Asla göndermez
        </span>
      </div>

      {isEditing && isPending && !isReadonly ? (
        <div className="mt-3 space-y-3 rounded-2xl border border-[color:var(--hairline)] bg-muted/20 p-3.5">
          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              Kime
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
                Konu
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
              İleti
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
              Kime
            </span>
            <span className="min-w-0 flex-1 break-all text-foreground">
              {draftTo || "—"}
            </span>
          </div>
          {draftSubject ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2.5">
              <span className="w-12 shrink-0 font-medium text-muted-foreground text-xs">
                Konu
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
        <div className="mt-4 flex flex-wrap items-center justify-between gap-1.5 border-[color:var(--hairline)] border-t pt-3">
          <button
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-[13px] text-foreground transition-colors hover:bg-muted motion-reduce:transition-none"
            data-testid="draft-edit-button"
            onClick={() => setIsEditing((prev) => !prev)}
            type="button"
          >
            {isEditing ? (
              <>
                <EyeIcon className="size-3.5 shrink-0" />
                <span>Önizle</span>
              </>
            ) : (
              <>
                <PencilIcon className="size-3.5 shrink-0" />
                <span>Düzenle</span>
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
              Vazgeç
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 font-medium text-[13px] text-primary-foreground transition-colors hover:bg-primary/90 motion-reduce:transition-none"
              data-testid="draft-approve-button"
              onClick={handleSave}
              type="button"
            >
              Kaydet
            </button>
          </div>
        </div>
      )}

      {isDenied && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <XCircleIcon className="size-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span>Vazgeçildi — hiçbir mesaj gönderilmedi.</span>
        </div>
      )}

      {isCompleted && output && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-300">
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Taslak kaydedildi (gönderilmedi).</span>
        </div>
      )}

      {(input || output) && (
        <details
          className="mt-3 rounded-xl border border-[color:var(--hairline)] bg-muted/20 px-3 py-2 text-xs"
          data-testid="approval-technical-details"
        >
          <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
            Teknik ayrıntı
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {JSON.stringify(output ?? input, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
