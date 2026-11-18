"use client";

import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  KeyRoundIcon,
  MonitorIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import type { ScreenHandoffPayload } from "@/lib/cloud-computer/screen-handoff";
import { getCopy, type UiLocale } from "@/lib/ui-copy";

export function ScreenHandoffCard({
  payload,
  locale = "en",
  isReadonly = false,
  onRespond,
}: {
  payload: ScreenHandoffPayload;
  locale?: UiLocale;
  isReadonly?: boolean;
  onRespond?: (decision: "im_here" | "not_now") => void;
}) {
  const copy = getCopy(locale);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [decision, setDecision] = useState<"pending" | "im_here" | "not_now">(
    payload.decision ?? "pending"
  );
  const [busy, setBusy] = useState(false);

  const reasonLabel =
    payload.reason === "two_factor"
      ? copy.screenHandoffReasonTwoFactor
      : payload.reason === "captcha"
        ? copy.screenHandoffReasonCaptcha
        : copy.screenHandoffReasonLogin;

  async function handleChoice(next: "im_here" | "not_now") {
    if (busy || decision !== "pending") {
      return;
    }
    setBusy(true);
    try {
      await fetch(`${basePath}/api/cloud-computer/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoffId: payload.handoffId,
          decision: next,
        }),
      }).catch(() => null);
      setDecision(next);
      onRespond?.(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="w-[min(100%,28rem)] rounded-2xl border border-[color:var(--hairline)] bg-card p-4 text-foreground"
      data-reason={payload.reason}
      data-testid="screen-handoff-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MonitorIcon className="size-4 shrink-0 text-primary" />
          <h3 className="font-semibold text-[15px] leading-snug">
            {copy.screenHandoffTitle}
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-medium text-amber-800 text-xs dark:text-amber-300">
          <KeyRoundIcon className="size-3" />
          {reasonLabel}
        </span>
      </div>

      <div className="mt-2.5 rounded-xl border border-[color:var(--hairline)] bg-muted/30 px-3 py-2 text-xs">
        <p className="font-medium text-foreground">{payload.serviceName}</p>
        {payload.url ? (
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {payload.url}
          </p>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-amber-900 text-xs dark:text-amber-200">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
        <p data-testid="screen-handoff-safety-note">
          {copy.screenHandoffSafetyNote}
        </p>
      </div>

      {payload.screenUrl && (
        <div className="mt-3">
          <a
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-background px-3.5 font-medium text-foreground text-xs hover:bg-muted"
            href={payload.screenUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon className="size-3.5" />
            {copy.screenHandoffOpenScreen}
          </a>
        </div>
      )}

      {decision === "pending" && !isReadonly ? (
        <div className="mt-3.5 flex items-center justify-end gap-2 border-[color:var(--hairline)] border-t pt-3">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-background px-4 font-medium text-[13px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            data-testid="screen-handoff-not-now"
            disabled={busy}
            onClick={() => handleChoice("not_now")}
            type="button"
          >
            {copy.screenHandoffNotNow}
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 font-medium text-[13px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            data-testid="screen-handoff-im-here"
            disabled={busy}
            onClick={() => handleChoice("im_here")}
            type="button"
          >
            {copy.screenHandoffImHere}
          </button>
        </div>
      ) : decision === "im_here" ? (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-300"
          data-testid="screen-handoff-confirmed"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>{copy.screenHandoffConfirmed}</span>
        </div>
      ) : decision === "not_now" ? (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground"
          data-testid="screen-handoff-deferred"
        >
          <XCircleIcon className="size-4 shrink-0" />
          <span>{copy.screenHandoffDeferred}</span>
        </div>
      ) : null}
    </section>
  );
}
