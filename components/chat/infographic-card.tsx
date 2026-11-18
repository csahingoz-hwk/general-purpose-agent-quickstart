"use client";

import { DownloadIcon, ExpandIcon, ImageIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

export type InfographicCardPayload = {
  status: "ok";
  kind: "infographic";
  title: string;
  subtitle?: string | null;
  filename: string;
  mediaType: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  imageUrl: string;
  downloadUrl: string;
  renderedVia?: string;
  usedVertexHeroImage?: boolean;
};

export function isInfographicPayload(
  value: unknown
): value is InfographicCardPayload {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { status?: string }).status === "ok" &&
    (value as { kind?: string }).kind === "infographic" &&
    typeof (value as { imageUrl?: unknown }).imageUrl === "string"
  );
}

export function InfographicCard({
  payload,
  locale = "en",
}: {
  payload: InfographicCardPayload;
  locale?: "en" | "tr";
}) {
  const [fullScreen, setFullScreen] = useState(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const isTr = locale === "tr";

  const withBase = (u: string) =>
    u.startsWith("/") && basePath && !u.startsWith(basePath)
      ? `${basePath}${u}`
      : u;

  const imgSrc = withBase(payload.imageUrl);
  const dlHref = withBase(payload.downloadUrl);

  return (
    <>
      <div
        className="w-[min(100%,460px)] overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-card text-sm shadow-[var(--shadow-card)]"
        data-testid="infographic-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ImageIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">
                {payload.title}
              </p>
              <p className="truncate text-muted-foreground text-xs">
                {isTr ? "İnfografik" : "Infographic"} ·{" "}
                {payload.mediaType === "image/png" ? "PNG" : "SVG"}
                {payload.renderedVia === "cloud_chromium" ? " · Cloud VM" : ""}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs transition-colors hover:bg-muted"
              data-testid="infographic-fullscreen-btn"
              onClick={() => setFullScreen(true)}
              type="button"
            >
              <ExpandIcon className="size-3.5" />
              <span>{isTr ? "Tam ekran" : "Full screen"}</span>
            </button>
            <a
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
              data-testid="infographic-download-btn"
              download={payload.filename}
              href={dlHref}
            >
              <DownloadIcon className="size-3.5" />
              <span>{isTr ? "İndir" : "Download"}</span>
            </a>
          </div>
        </div>

        <div className="border-[color:var(--hairline)] border-t bg-muted/30 p-3">
          <button
            className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-background"
            onClick={() => setFullScreen(true)}
            type="button"
          >
            {/* biome-ignore lint/performance/noImgElement: signed private /api/files infographic image */}
            <img
              alt={payload.title}
              className="max-h-[460px] w-full object-contain"
              src={imgSrc}
            />
          </button>
        </div>
      </div>

      {fullScreen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-label={payload.title}
            aria-modal="true"
            className="fixed inset-0 z-50 flex flex-col bg-background/95 p-4 backdrop-blur-sm"
            data-testid="infographic-fullscreen-modal"
            role="dialog"
          >
            <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 pb-3">
              <p className="truncate font-semibold text-base text-foreground">
                {payload.title}
              </p>
              <div className="flex items-center gap-2">
                <a
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                  download={payload.filename}
                  href={dlHref}
                >
                  <DownloadIcon className="size-3.5" />
                  <span>{isTr ? "İndir" : "Download"}</span>
                </a>
                <button
                  aria-label={isTr ? "Kapat" : "Close"}
                  className="inline-flex size-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-card text-foreground hover:bg-muted"
                  onClick={() => setFullScreen(false)}
                  type="button"
                >
                  <XIcon className="size-5" />
                </button>
              </div>
            </div>
            <div className="mx-auto flex flex-1 items-center justify-center overflow-auto">
              {/* biome-ignore lint/performance/noImgElement: signed private /api/files infographic image */}
              <img
                alt={payload.title}
                className="max-h-full max-w-full rounded-xl object-contain shadow-lg"
                src={imgSrc}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
