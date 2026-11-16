"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  CheckCircle2Icon,
  MailIcon,
  MessageSquareIcon,
  SendIcon,
  WebhookIcon,
  XCircleIcon,
} from "lucide-react";
import type { OutboundDraftResult } from "@/lib/ai/tools/draft-outbound";
import type { ChatMessage } from "@/lib/types";

type DraftInput = {
  channel?: string;
  recipient?: string;
  subject?: string;
  body?: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  telegram: "Telegram",
  slack: "Slack",
  webhook: "Webhook",
};

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "email") {
    return <MailIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (channel === "webhook") {
    return <WebhookIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (channel === "telegram") {
    return <SendIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
  return (
    <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
  );
}

export function OutboundDraftCard({
  addToolApprovalResponse,
  approvalId,
  approved,
  input,
  isReadonly = false,
  locale = "en",
  output,
  state,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  approvalId?: string;
  approved?: boolean;
  input?: DraftInput;
  isReadonly?: boolean;
  locale?: "en" | "tr";
  output?: OutboundDraftResult;
  state: string;
}) {
  const channel = output?.channel ?? input?.channel ?? "email";
  const recipient = output?.recipient ?? input?.recipient ?? "—";
  const subject = output?.subject ?? input?.subject ?? null;
  const body = output?.body ?? input?.body ?? "";
  const isPending = state === "approval-requested" && Boolean(approvalId);
  const isDenied =
    state === "output-denied" ||
    (state === "approval-responded" && approved === false);
  const isCompleted = state === "output-available" && Boolean(output);

  return (
    <section
      className="w-[min(100%,40rem)] rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 text-foreground shadow-[var(--shadow-card)]"
      data-testid="outbound-draft-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChannelIcon channel={channel} />
          <h3 className="font-semibold text-[15px] leading-snug">
            {locale === "tr" ? "Gönderim öncesi taslak" : "Draft before send"}
          </h3>
          <span className="rounded-full border border-[color:var(--hairline)] bg-muted/50 px-2.5 py-0.5 font-medium text-xs">
            {CHANNEL_LABELS[channel] ?? channel}
          </span>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-medium text-amber-800 text-xs dark:text-amber-300">
          {isCompleted
            ? locale === "tr"
              ? "Kuru çalıştırma onayı"
              : "Dry-run receipt"
            : isDenied
              ? locale === "tr"
                ? "İptal edildi"
                : "Cancelled"
              : locale === "tr"
                ? "Onay bekliyor"
                : "Needs approval"}
        </span>
      </div>

      <div className="mt-3 space-y-2 rounded-2xl border border-[color:var(--hairline)] bg-muted/25 p-3 text-[14px]">
        <div className="flex flex-wrap gap-x-2">
          <span className="font-medium text-muted-foreground">
            {locale === "tr" ? "Alıcı:" : "To:"}
          </span>
          <span className="break-all font-mono text-[13px]">{recipient}</span>
        </div>
        {subject ? (
          <div className="flex flex-wrap gap-x-2">
            <span className="font-medium text-muted-foreground">
              {locale === "tr" ? "Konu:" : "Subject:"}
            </span>
            <span className="font-medium">{subject}</span>
          </div>
        ) : null}
        <div className="border-[color:var(--hairline)] border-t pt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
          {body}
        </div>
      </div>

      {isPending && !isReadonly && approvalId && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {locale === "tr"
              ? "Canlı dış bağlantılar kapalıdır; onay yalnızca doğrulanmış taslak kaydı oluşturur."
              : "Live connectors are disconnected; approving records a verified dry-run draft only."}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-foreground text-sm transition-colors hover:bg-muted motion-reduce:transition-none"
              data-testid="draft-deny-button"
              onClick={() => {
                addToolApprovalResponse({
                  id: approvalId,
                  approved: false,
                  reason: "Draft cancelled by owner",
                });
              }}
              type="button"
            >
              {locale === "tr" ? "İptal et" : "Cancel"}
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 motion-reduce:transition-none"
              data-testid="draft-approve-button"
              onClick={() => {
                addToolApprovalResponse({
                  id: approvalId,
                  approved: true,
                });
              }}
              type="button"
            >
              {locale === "tr" ? "Taslağı onayla" : "Approve draft"}
            </button>
          </div>
        </div>
      )}

      {isDenied && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <XCircleIcon className="size-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span>
            {locale === "tr"
              ? "Taslak iptal edildi — hiçbir dış mesaj gönderilmedi."
              : "Draft cancelled — no external message was sent."}
          </span>
        </div>
      )}

      {isCompleted && output && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {locale === "tr"
              ? "Onaylandı (kuru çalıştırma — dış gönderim kapalı)."
              : "Approved (dry-run — external connectors disconnected)."}
          </span>
          <code className="font-mono text-[11px]">
            sha256:{output.digest.slice(0, 12)}
          </code>
        </div>
      )}
    </section>
  );
}
