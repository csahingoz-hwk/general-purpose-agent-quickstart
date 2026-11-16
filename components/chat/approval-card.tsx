"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { CheckCircle2Icon, ShieldAlertIcon, XCircleIcon } from "lucide-react";
import type { RiskLevel } from "@/lib/safety/action-review";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

const RISK_STYLES: Record<RiskLevel, string> = {
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium:
    "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-800 dark:text-orange-300",
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
};

const RISK_LABELS: Record<"en" | "tr", Record<RiskLevel, string>> = {
  en: {
    low: "Low risk",
    medium: "Review",
    high: "High impact",
    critical: "Critical review",
  },
  tr: {
    low: "Düşük risk",
    medium: "İnceleme",
    high: "Yüksek etki",
    critical: "Kritik inceleme",
  },
};

export type ApprovalCardProps = {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  approvalId?: string;
  approved?: boolean;
  input?: unknown;
  isReadonly?: boolean;
  locale?: "en" | "tr";
  reasons?: readonly string[];
  riskLevel?: RiskLevel;
  state: string;
  title: string;
  toolName: string;
};

export function ApprovalCard({
  addToolApprovalResponse,
  approvalId,
  approved,
  input,
  isReadonly = false,
  locale = "en",
  reasons = [],
  riskLevel = "high",
  state,
  title,
  toolName,
}: ApprovalCardProps) {
  const isDenied =
    state === "output-denied" ||
    (state === "approval-responded" && approved === false);
  const isPending = state === "approval-requested" && Boolean(approvalId);
  const isApproved =
    state === "output-available" ||
    (state === "approval-responded" && approved === true);

  return (
    <section
      className="w-[min(100%,40rem)] rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 text-foreground shadow-[var(--shadow-card)]"
      data-testid={`approval-card-${toolName}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlertIcon className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="font-semibold text-[15px] leading-snug">{title}</h3>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium text-xs",
            RISK_STYLES[riskLevel]
          )}
        >
          {RISK_LABELS[locale][riskLevel]}
        </span>
      </div>

      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      )}

      {input !== undefined && (
        <details
          className="mt-3 rounded-2xl border border-[color:var(--hairline)] bg-muted/30 px-3 py-2 text-xs"
          open={isPending}
        >
          <summary className="cursor-pointer select-none font-medium text-muted-foreground">
            {locale === "tr" ? "İşlem ayrıntıları" : "Action parameters"}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] text-foreground">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      )}

      {isPending && !isReadonly && approvalId && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-[color:var(--hairline)] border-t pt-3">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-foreground text-sm transition-colors hover:bg-muted motion-reduce:transition-none"
            data-testid="approval-deny-button"
            onClick={() => {
              addToolApprovalResponse({
                id: approvalId,
                approved: false,
                reason: "Declined by owner",
              });
            }}
            type="button"
          >
            {locale === "tr" ? "Vazgeç" : "Deny"}
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 motion-reduce:transition-none"
            data-testid="approval-allow-button"
            onClick={() => {
              addToolApprovalResponse({
                id: approvalId,
                approved: true,
              });
            }}
            type="button"
          >
            {locale === "tr" ? "Onayla" : "Approve"}
          </button>
        </div>
      )}

      {isDenied && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <XCircleIcon className="size-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span>
            {locale === "tr"
              ? "İptal edildi — hiçbir işlem çalıştırılmadı."
              : "Cancelled — action was not executed."}
          </span>
        </div>
      )}

      {isApproved && state === "approval-responded" && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            {locale === "tr"
              ? "Onaylandı — çalıştırılıyor…"
              : "Approved — completing action…"}
          </span>
        </div>
      )}
    </section>
  );
}
