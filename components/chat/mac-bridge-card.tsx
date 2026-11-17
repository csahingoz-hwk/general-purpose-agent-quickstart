"use client";

import {
  CheckCircle2Icon,
  ClipboardCopyIcon,
  GitBranchIcon,
  LaptopIcon,
  ShieldAlertIcon,
  SquareIcon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "@/components/chat/toast";
import { cn } from "@/lib/utils";

export function MacBridgeCard({
  output,
  locale = "en",
}: {
  output: Record<string, unknown>;
  locale?: "en" | "tr";
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [expanded, setExpanded] = useState(false);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = localStatus ?? String(output.status ?? "ok");
  const cli = typeof output.cli === "string" ? output.cli : null;
  const branch = typeof output.branch === "string" ? output.branch : null;
  const tmuxSession =
    typeof output.tmuxSession === "string" ? output.tmuxSession : null;
  const command = typeof output.command === "string" ? output.command : null;
  const digest = typeof output.digest === "string" ? output.digest : null;
  const taskId = typeof output.taskId === "string" ? output.taskId : null;
  const stdout = typeof output.stdout === "string" ? output.stdout.trim() : "";
  const stderr = typeof output.stderr === "string" ? output.stderr.trim() : "";
  const message =
    typeof output.message === "string" ? output.message : undefined;

  async function handleApprovalAction(action: "approve" | "cancel") {
    if (busy) {
      return;
    }
    if (!taskId) {
      setLocalStatus(action === "approve" ? "ok" : "cancelled");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setLocalStatus(action === "approve" ? "ok" : "cancelled");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCopySetupCommand() {
    const setupCmd =
      "brew install tailscale && sudo brew services start tailscale && sudo tailscale up --ssh --advertise-tags=tag:mac --accept-routes=false && zsh ops/mac-bridge/setup-mac-bridge.sh";
    try {
      await navigator.clipboard.writeText(setupCmd);
      toast({
        type: "success",
        description:
          locale === "tr"
            ? "Mac köprüsü kurulum komutu panoya kopyalandı."
            : "Copied Mac bridge setup command to clipboard.",
      });
    } catch {
      /* ignore clipboard restrictions */
    }
  }

  return (
    <div
      className="w-[min(100%,460px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm shadow-2xs"
      data-status={status}
      data-testid="mac-bridge-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <LaptopIcon className="size-3.5 shrink-0 text-primary" />
          <span className="font-semibold text-foreground">
            Mac mini · Tailscale SSH
          </span>
          {cli ? (
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-[11px] uppercase">
              {cli}
            </span>
          ) : null}
          {tmuxSession ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {tmuxSession}
            </span>
          ) : null}
          {digest ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              #{digest.slice(0, 8)}
            </span>
          ) : null}
        </div>

        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 font-medium text-[11px]",
            status === "ok"
              ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
              : status === "awaiting_approval" || status === "setup_required"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : status === "cancelled"
                  ? "bg-muted text-muted-foreground"
                  : "bg-destructive/12 text-destructive"
          )}
          data-testid="mac-bridge-status"
        >
          {status === "ok" ? (
            <>
              <CheckCircle2Icon className="size-3" />
              {locale === "tr" ? "Tamamlandı" : "Done"}
            </>
          ) : status === "awaiting_approval" ? (
            <>
              <ShieldAlertIcon className="size-3" />
              {locale === "tr" ? "Onay bekliyor" : "Needs approval"}
            </>
          ) : status === "setup_required" ? (
            <>
              <ShieldAlertIcon className="size-3" />
              {locale === "tr" ? "Tailscale eşleşmesi" : "Pair Tailscale"}
            </>
          ) : status === "cancelled" ? (
            <>
              <XCircleIcon className="size-3" />
              {locale === "tr" ? "Durduruldu" : "Stopped"}
            </>
          ) : (
            <>
              <XCircleIcon className="size-3" />
              {status}
            </>
          )}
        </span>
      </div>

      {branch ? (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-0.5 font-mono text-[11px] text-foreground">
          <GitBranchIcon className="size-3 text-muted-foreground" />
          {branch}
        </div>
      ) : null}

      {command ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-muted/70 px-2.5 py-1.5 font-mono text-foreground text-xs">
          <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{command}</span>
        </div>
      ) : null}

      {message ? (
        <p className="mt-2 break-words text-muted-foreground text-xs leading-relaxed">
          {message}
        </p>
      ) : null}

      {status === "setup_required" && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--hairline)] bg-background/70 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {locale === "tr"
              ? "Standalone Tailscale + botrunner kurulumu (1 kez)"
              : "One-time standalone Tailscale + botrunner setup"}
          </span>
          <button
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-card px-3 font-medium text-foreground text-xs hover:bg-muted"
            data-testid="mac-bridge-copy-setup"
            onClick={handleCopySetupCommand}
            type="button"
          >
            <ClipboardCopyIcon className="size-3.5" />
            <span>{locale === "tr" ? "Komutu kopyala" : "Copy setup"}</span>
          </button>
        </div>
      )}

      {stdout || stderr ? (
        <div className="mt-2">
          <button
            className="text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
            data-testid="mac-bridge-toggle-log"
            onClick={() => setExpanded((p) => !p)}
            type="button"
          >
            {expanded
              ? locale === "tr"
                ? "tmux çıktısını gizle"
                : "Hide tmux log"
              : locale === "tr"
                ? "tmux çıktısını göster"
                : "Show tmux log"}
          </button>
          {expanded ? (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/60 p-2.5 font-mono text-[11px] text-foreground">
              {[stdout, stderr].filter(Boolean).join("\n")}
            </pre>
          ) : null}
        </div>
      ) : null}

      {status === "awaiting_approval" && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-[color:var(--hairline)] border-t pt-3">
          <button
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] px-4 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            data-testid="mac-bridge-deny"
            disabled={busy}
            onClick={() => handleApprovalAction("cancel")}
            type="button"
          >
            <SquareIcon className="size-3 fill-current" />
            {locale === "tr" ? "Vazgeç" : "Deny"}
          </button>
          <button
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
            data-testid="mac-bridge-approve"
            disabled={busy}
            onClick={() => handleApprovalAction("approve")}
            type="button"
          >
            {locale === "tr" ? "Onayla ve Çalıştır" : "Approve & Run"}
          </button>
        </div>
      )}
    </div>
  );
}
