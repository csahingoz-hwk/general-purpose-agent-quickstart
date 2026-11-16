"use client";

import { Film, ImageIcon, ShieldAlert, Sparkles } from "lucide-react";

type MediaCardOutput = {
  status?: string;
  kind?: "image" | "video";
  title?: string;
  prompt?: string;
  fileUrl?: string;
  taskId?: string;
  operationName?: string;
  model?: string;
  reservedUsd?: number;
  message?: string;
};

export function isMediaPreviewPayload(
  value: unknown
): value is MediaCardOutput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "image" || candidate.kind === "video") &&
    typeof candidate.status === "string"
  );
}

export function MediaPreviewCard({
  payload,
  locale = "en",
}: {
  payload: MediaCardOutput;
  locale?: "en" | "tr";
}) {
  const isImage = payload.kind === "image";
  const isSuccess = payload.status === "ok" || payload.status === "queued";

  return (
    <div
      className="w-[min(100%,440px)] overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      data-testid={`media-preview-${payload.kind ?? "unknown"}`}
    >
      <div className="flex items-center justify-between gap-2 border-border border-b bg-muted/40 px-3.5 py-2.5">
        <div className="flex items-center gap-2 font-medium text-sm">
          {isImage ? (
            <ImageIcon className="size-4 text-primary" />
          ) : (
            <Film className="size-4 text-primary" />
          )}
          <span className="truncate">
            {payload.title ??
              (isImage
                ? locale === "tr"
                  ? "Üretilen Görsel"
                  : "Generated Image"
                : locale === "tr"
                  ? "Veo Video Klibi"
                  : "Veo Video Clip")}
          </span>
        </div>
        {typeof payload.reservedUsd === "number" ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary">
            ${payload.reservedUsd.toFixed(2)} reserved
          </span>
        ) : null}
      </div>

      {isSuccess && isImage && payload.fileUrl ? (
        <div className="space-y-2 p-3">
          <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
            {/* biome-ignore lint/performance/noImgElement: owner-signed /api/files/[token] image preview */}
            <img
              alt={payload.title ?? "Generated image"}
              className="max-h-72 w-full object-contain"
              src={payload.fileUrl}
            />
          </div>
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <Sparkles className="size-3.5" />
              {payload.model ?? "Imagen"}
            </span>
            <span>
              {locale === "tr" ? "Özel imzalı dosya" : "Owner-only signed file"}
            </span>
          </div>
        </div>
      ) : null}

      {isSuccess && !isImage ? (
        <div className="space-y-2 p-3.5 text-sm">
          <p className="text-foreground">
            {locale === "tr"
              ? "Video üretimi bulut iş kuyruğuna alındı (8 GB Mac mini RAM'ini korur)."
              : "Video clip queued on remote Veo worker (keeps 8 GB Mac mini RAM free)."}
          </p>
          <div className="rounded-lg bg-muted/50 p-2.5 font-mono text-muted-foreground text-xs">
            <div>Model: {payload.model ?? "Veo"}</div>
            {payload.taskId ? <div>Task: {payload.taskId}</div> : null}
            {payload.operationName ? (
              <div className="truncate">Op: {payload.operationName}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isSuccess ? null : (
        <div className="flex items-start gap-2.5 p-3.5 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p className="text-muted-foreground">
            {payload.message ??
              (locale === "tr"
                ? "Medya üretimi tamamlanamadı."
                : "Media generation could not complete.")}
          </p>
        </div>
      )}
    </div>
  );
}
