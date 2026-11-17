"use client";

import {
  CheckCircle2Icon,
  GitBranchIcon,
  LaptopIcon,
  ShieldAlertIcon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function MacBridgeCard({
  output,
  locale = "en",
}: {
  output: Record<string, unknown>;
  locale?: "en" | "tr";
}) {
  const [expanded, setExpanded] = useState(false);
  const status = String(output.status ?? "ok");
  const cli = typeof output.cli === "string" ? output.cli : null;
  const branch = typeof output.branch === "string" ? output.branch : null;
  const tmuxSession =
    typeof output.tmuxSession === "string" ? output.tmuxSession : null;
  const command = typeof output.command === "string" ? output.command : null;
  const stdout = typeof output.stdout === "string" ? output.stdout.trim() : "";
  const stderr = typeof output.stderr === "string" ? output.stderr.trim() : "";
  const message =
    typeof output.message === "string" ? output.message : undefined;

  return (
    <div
      className="w-[min(100%,460px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm shadow-2xs"
      data-status={status}
      data-testid="mac-bridge-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
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
        </div>

        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium text-[11px]",
            status === "ok"
              ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
              : status === "awaiting_approval" || status === "setup_required"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-destructive/12 text-destructive"
          )}
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
        <p className="mt-2 text-muted-foreground text-xs">{message}</p>
      ) : null}

      {stdout || stderr ? (
        <div className="mt-2">
          <button
            className="text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
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
    </div>
  );
}
