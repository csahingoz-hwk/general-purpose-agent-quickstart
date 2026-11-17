"use client";

import {
  CheckCircle2Icon,
  CloudIcon,
  DownloadIcon,
  GlobeIcon,
  ShieldAlertIcon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function CloudComputerCard({
  toolName,
  output,
  locale = "en",
}: {
  toolName: string;
  output: Record<string, unknown>;
  locale?: "en" | "tr";
}) {
  const [openStdout, setOpenStdout] = useState(false);
  const status = String(output.status ?? "ok");

  if (toolName === "cloudExportFileToChat" && status === "ok") {
    const filename = String(output.filename ?? "file");
    const downloadUrl =
      typeof output.downloadUrl === "string" ? output.downloadUrl : null;
    const sizeKb = Math.max(
      1,
      Math.round(Number(output.sizeBytes ?? 0) / 1024)
    );
    return (
      <div
        className="flex w-[min(100%,450px)] items-center justify-between gap-3 rounded-2xl border border-[color:var(--hairline)] bg-card px-4 py-3 text-sm"
        data-testid="cloud-export-card"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{filename}</p>
          <p className="text-muted-foreground text-xs">
            Cloud VM · {sizeKb} KB
          </p>
        </div>
        {downloadUrl ? (
          <a
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
            download={filename}
            href={downloadUrl}
          >
            <DownloadIcon className="size-3.5" />
            {locale === "tr" ? "İndir" : "Download"}
          </a>
        ) : null}
      </div>
    );
  }

  if (toolName === "cloudBrowseUrl") {
    const title = String(output.title ?? output.url ?? "Cloud Browser");
    const screenshotUrl =
      typeof output.screenshotUrl === "string" ? output.screenshotUrl : null;
    return (
      <div
        className="w-[min(100%,450px)] space-y-2.5 rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm"
        data-testid="cloud-browse-card"
      >
        <div className="flex items-center gap-2 font-medium text-foreground text-xs">
          <GlobeIcon className="size-3.5 text-primary" />
          <span className="truncate">{title}</span>
        </div>
        {screenshotUrl ? (
          // biome-ignore lint/performance/noImgElement: authenticated private /api/files proxy image
          <img
            alt={title}
            className="max-h-56 w-full rounded-xl border border-[color:var(--hairline)] object-cover object-top"
            src={screenshotUrl}
          />
        ) : null}
        {typeof output.message === "string" ? (
          <p className="text-muted-foreground text-xs">{output.message}</p>
        ) : null}
      </div>
    );
  }

  const command = String(output.command ?? output.path ?? "");
  const stdout = typeof output.stdout === "string" ? output.stdout.trim() : "";
  const stderr = typeof output.stderr === "string" ? output.stderr.trim() : "";
  const message =
    typeof output.message === "string" ? output.message : undefined;
  const exitCode =
    typeof output.exitCode === "number" ? output.exitCode : undefined;

  return (
    <div
      className="w-[min(100%,460px)] rounded-2xl border border-[color:var(--hairline)] bg-card p-3.5 text-sm"
      data-status={status}
      data-testid="cloud-computer-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <CloudIcon className="size-3.5 shrink-0 text-primary" />
          <span className="font-medium text-foreground">Cloud Computer</span>
          {typeof output.durationMs === "number" ? (
            <span className="text-muted-foreground">
              · {output.durationMs}ms
            </span>
          ) : null}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px]",
            status === "ok"
              ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
              : status === "awaiting_approval"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-destructive/12 text-destructive"
          )}
        >
          {status === "ok" ? (
            <>
              <CheckCircle2Icon className="size-3" />
              {exitCode !== undefined ? `exit ${exitCode}` : "Done"}
            </>
          ) : status === "awaiting_approval" ? (
            <>
              <ShieldAlertIcon className="size-3" />
              Needs approval
            </>
          ) : (
            <>
              <XCircleIcon className="size-3" />
              {status}
            </>
          )}
        </span>
      </div>

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
            onClick={() => setOpenStdout((p) => !p)}
            type="button"
          >
            {openStdout ? "Hide terminal output" : "Show terminal output"}
          </button>
          {openStdout ? (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/60 p-2.5 font-mono text-[11px] text-foreground">
              {[stdout, stderr].filter(Boolean).join("\n")}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
