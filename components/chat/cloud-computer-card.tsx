"use client";

import {
  CheckCircle2Icon,
  CloudIcon,
  DownloadIcon,
  ExpandIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileCode2Icon,
  GlobeIcon,
  ShieldAlertIcon,
  TerminalIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { getCopy } from "@/lib/ui-copy";
import { cn } from "@/lib/utils";

export function resolveCloudFileUrls(output: Record<string, unknown>): {
  filename: string;
  previewUrl: string | null;
  downloadUrl: string | null;
  isHtml: boolean;
  isImage: boolean;
  isBinaryArchive: boolean;
  textPreview: string | null;
} {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const rawPath = typeof output.path === "string" ? output.path.trim() : "";
  const fallbackName = rawPath.split(/[\\/]/).pop()?.trim() || "file";
  const filename =
    typeof output.filename === "string" && output.filename.trim()
      ? output.filename.trim()
      : fallbackName;

  const rawDownload =
    typeof output.downloadUrl === "string" && output.downloadUrl.trim()
      ? output.downloadUrl.trim()
      : null;
  const rawPreview =
    typeof output.previewUrl === "string" && output.previewUrl.trim()
      ? output.previewUrl.trim()
      : null;

  const withBase = (u: string) =>
    u.startsWith("/") && basePath && !u.startsWith(basePath)
      ? `${basePath}${u}`
      : u;

  const canUseCloudFallbackPath =
    output.savedToCloudWorkspace !== false &&
    (rawPath.startsWith("/workspace") || rawPath.length > 0);

  let downloadUrl: string | null = null;
  let previewUrl: string | null = null;

  if (rawDownload) {
    const dl = withBase(rawDownload);
    downloadUrl = dl.includes("disposition=")
      ? dl
      : `${dl}${dl.includes("?") ? "&" : "?"}disposition=attachment`;
  } else if (canUseCloudFallbackPath) {
    downloadUrl = `${basePath}/api/cloud-computer/files?path=${encodeURIComponent(rawPath)}&disposition=attachment`;
  }

  if (rawPreview) {
    previewUrl = withBase(rawPreview);
  } else if (rawDownload) {
    const dl = withBase(rawDownload);
    previewUrl = dl.includes("disposition=")
      ? dl.replace(/disposition=attachment/g, "disposition=inline")
      : `${dl}${dl.includes("?") ? "&" : "?"}disposition=inline`;
  } else if (canUseCloudFallbackPath) {
    previewUrl = `${basePath}/api/cloud-computer/files?path=${encodeURIComponent(rawPath)}&disposition=inline`;
  }

  const lower = filename.toLowerCase();
  const mediaType =
    typeof output.mediaType === "string" ? output.mediaType.toLowerCase() : "";
  const isHtml =
    mediaType === "text/html" ||
    lower.endsWith(".html") ||
    lower.endsWith(".htm");
  const isImage =
    mediaType.startsWith("image/") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg");
  const isBinaryArchive =
    mediaType === "application/zip" ||
    mediaType === "application/gzip" ||
    mediaType === "application/octet-stream" ||
    lower.endsWith(".zip") ||
    lower.endsWith(".gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".tar") ||
    lower.endsWith(".bin");
  const textPreview =
    typeof output.textPreview === "string" && output.textPreview.length > 0
      ? output.textPreview
      : null;

  return {
    filename,
    previewUrl: isBinaryArchive ? null : previewUrl,
    downloadUrl,
    isHtml,
    isImage,
    isBinaryArchive,
    textPreview,
  };
}

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
  const [openPreview, setOpenPreview] = useState(() =>
    Boolean(
      output.autoOpenPreview === true || toolName === "buildHtmlPageOrDashboard"
    )
  );
  const [fullScreenPreview, setFullScreenPreview] = useState(false);
  const copy = getCopy(locale);
  const isTr = locale === "tr";
  const status = String(output.status ?? "ok");

  if (
    (toolName === "cloudExportFileToChat" ||
      toolName === "cloudWriteFile" ||
      toolName === "buildHtmlPageOrDashboard") &&
    status === "ok"
  ) {
    const {
      filename,
      previewUrl,
      downloadUrl,
      isHtml,
      isImage,
      isBinaryArchive,
      textPreview,
    } = resolveCloudFileUrls(output);
    const rawBytes = Number(output.sizeBytes ?? output.bytesWritten ?? 0);
    const sizeKb = Math.max(1, Math.round(rawBytes / 1024));
    const canInlinePreview = Boolean(
      !isBinaryArchive && (isHtml || isImage || textPreview || previewUrl)
    );
    const testId =
      toolName === "buildHtmlPageOrDashboard"
        ? "html-dashboard-card"
        : toolName === "cloudExportFileToChat"
          ? "cloud-export-card"
          : "cloud-computer-card";
    const cardDisplayTitle =
      typeof output.title === "string" && output.title.trim()
        ? output.title.trim()
        : filename;

    return (
      <>
        <div
          className={cn(
            "overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-card text-sm shadow-[var(--shadow-card)]",
            toolName === "buildHtmlPageOrDashboard"
              ? "w-[min(100%,640px)]"
              : "w-[min(100%,460px)]"
          )}
          data-status={status}
          data-testid={testId}
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3">
            <button
              aria-expanded={openPreview}
              className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left transition-opacity hover:opacity-85 active:opacity-75"
              data-testid="cloud-file-card-tap"
              onClick={() => {
                if (canInlinePreview) {
                  setOpenPreview((prev) => !prev);
                } else if (downloadUrl && typeof window !== "undefined") {
                  window.location.assign(downloadUrl);
                }
              }}
              type="button"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileCode2Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {cardDisplayTitle}
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  {cardDisplayTitle !== filename ? `${filename} · ` : ""}
                  {toolName === "buildHtmlPageOrDashboard" &&
                  output.savedToCloudWorkspace !== true
                    ? "HTML"
                    : "Cloud VM"}{" "}
                  · {sizeKb} KB
                </span>
              </span>
            </button>

            <div className="flex flex-wrap shrink-0 items-center gap-1.5">
              {canInlinePreview && (
                <button
                  aria-expanded={openPreview}
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs transition-colors hover:bg-muted active:bg-muted"
                  data-testid="cloud-file-preview-toggle"
                  onClick={() => setOpenPreview((prev) => !prev)}
                  type="button"
                >
                  <EyeIcon className="size-3.5" />
                  <span>
                    {openPreview ? copy.cloudClosePreview : copy.preview}
                  </span>
                </button>
              )}
              {isHtml && (
                <button
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs transition-colors hover:bg-muted active:bg-muted"
                  data-testid="cloud-file-fullscreen"
                  onClick={() => setFullScreenPreview(true)}
                  type="button"
                >
                  <ExpandIcon className="size-3.5" />
                  <span>{isTr ? "Tam ekran" : "Open full screen"}</span>
                </button>
              )}
              {previewUrl ? (
                <a
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs transition-colors hover:bg-muted active:bg-muted"
                  data-testid="cloud-file-open"
                  href={previewUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  <span>{copy.cloudOpen}</span>
                </a>
              ) : null}
              {downloadUrl ? (
                <a
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90 active:bg-primary/85"
                  data-testid="cloud-file-download"
                  download={filename}
                  href={downloadUrl}
                >
                  <DownloadIcon className="size-3.5" />
                  <span>{copy.cloudDownload}</span>
                </a>
              ) : null}
            </div>
          </div>

          {openPreview ? (
            <div
              className="border-[color:var(--hairline)] border-t bg-muted/30 p-3"
              data-testid="cloud-file-preview-pane"
            >
              {isHtml ? (
                <iframe
                  className={cn(
                    "w-full rounded-xl border border-[color:var(--hairline)] bg-background",
                    toolName === "buildHtmlPageOrDashboard" ? "h-96" : "h-72"
                  )}
                  sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                  src={textPreview ? undefined : (previewUrl ?? undefined)}
                  srcDoc={textPreview ?? undefined}
                  title={filename}
                />
              ) : isImage && previewUrl ? (
                // biome-ignore lint/performance/noImgElement: authenticated private /api/files or /api/cloud-computer/files image
                <img
                  alt={filename}
                  className="max-h-72 w-full rounded-xl border border-[color:var(--hairline)] object-contain"
                  src={previewUrl}
                />
              ) : textPreview ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background p-3 font-mono text-[11.5px] text-foreground">
                  {textPreview}
                </pre>
              ) : previewUrl ? (
                <iframe
                  className="h-72 w-full rounded-xl border border-[color:var(--hairline)] bg-background"
                  sandbox="allow-scripts"
                  src={previewUrl}
                  title={filename}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {fullScreenPreview &&
          isHtml &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              aria-label={cardDisplayTitle}
              aria-modal="true"
              className="fixed inset-0 z-50 flex flex-col bg-background p-3 sm:p-5"
              data-testid="cloud-html-fullscreen-modal"
              role="dialog"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <p className="truncate font-semibold text-base text-foreground">
                  {cardDisplayTitle}
                </p>
                <div className="flex items-center gap-2">
                  {previewUrl ? (
                    <a
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-card px-3.5 font-medium text-foreground text-xs hover:bg-muted"
                      href={previewUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      <span>{copy.cloudOpen}</span>
                    </a>
                  ) : null}
                  {downloadUrl ? (
                    <a
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                      download={filename}
                      href={downloadUrl}
                    >
                      <DownloadIcon className="size-3.5" />
                      <span>{copy.cloudDownload}</span>
                    </a>
                  ) : null}
                  <button
                    aria-label={isTr ? "Kapat" : "Close"}
                    className="inline-flex size-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
                    onClick={() => setFullScreenPreview(false)}
                    type="button"
                  >
                    <XIcon className="size-5" />
                  </button>
                </div>
              </div>
              <iframe
                className="flex-1 w-full rounded-2xl border border-[color:var(--hairline)] bg-background"
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                src={textPreview ? undefined : (previewUrl ?? undefined)}
                srcDoc={textPreview ?? undefined}
                title={filename}
              />
            </div>,
            document.body
          )}
      </>
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
          <span className="font-medium text-foreground">
            {copy.cloudComputerTitle}
          </span>
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
              {exitCode !== undefined
                ? `exit ${exitCode}`
                : copy.cloudStatusDone}
            </>
          ) : status === "awaiting_approval" ? (
            <>
              <ShieldAlertIcon className="size-3" />
              {copy.cloudNeedsApproval}
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
            {openStdout ? copy.cloudHideTerminal : copy.cloudShowTerminal}
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
