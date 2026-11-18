"use client";

import {
  DownloadIcon,
  ExpandIcon,
  FileCode2Icon,
  ImageIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExcalidrawToolPayload } from "@/lib/ai/tools/excalidraw-diagram";
import { MessageResponse } from "../ai-elements/message";
import type { ExcalidrawExportHandle } from "./excalidraw-canvas-inner";

const LazyExcalidrawCanvas = dynamic(
  () => import("./excalidraw-canvas-inner"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[430px] w-full items-center justify-center rounded-xl border border-[color:var(--hairline)] bg-muted/30 text-muted-foreground text-xs">
        Loading interactive diagram…
      </div>
    ),
  }
);

export function isExcalidrawPayload(
  value: unknown
): value is Extract<ExcalidrawToolPayload, { status: "ok" }> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { status?: string }).status === "ok" &&
    (value as { kind?: string }).kind === "excalidraw_diagram"
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export function ExcalidrawCard({
  payload,
  locale = "en",
}: {
  payload: Extract<ExcalidrawToolPayload, { status: "ok" }>;
  locale?: "en" | "tr";
}) {
  const isTr = locale === "tr";
  const [viewMode, setViewMode] = useState<"excalidraw" | "mermaid">(
    payload.mode === "mermaid" || !payload.scene ? "mermaid" : "excalidraw"
  );
  const [fullScreen, setFullScreen] = useState(false);
  const exportRef = useRef<ExcalidrawExportHandle>(null);

  const baseSlug = payload.filename.replace(/\.excalidraw$/i, "") || "diagram";

  async function handleExportPng() {
    const blob = await exportRef.current?.exportPng();
    if (blob) {
      downloadBlob(blob, `${baseSlug}.png`);
    }
  }

  async function handleExportSvg() {
    const svg = await exportRef.current?.exportSvgString();
    if (svg) {
      downloadBlob(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        `${baseSlug}.svg`
      );
    }
  }

  function handleDownloadExcalidraw() {
    const json =
      exportRef.current?.exportSceneJson() ??
      (payload.scene ? JSON.stringify(payload.scene, null, 2) : null);
    if (json) {
      downloadBlob(
        new Blob([json], { type: "application/json;charset=utf-8" }),
        payload.filename
      );
    }
  }

  function handleDownloadMermaid() {
    if (!payload.mermaidFallback) {
      return;
    }
    downloadBlob(
      new Blob([payload.mermaidFallback], {
        type: "text/plain;charset=utf-8",
      }),
      `${baseSlug}.mmd`
    );
  }

  return (
    <>
      <div
        className="w-[min(100%,660px)] overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-card text-sm shadow-[var(--shadow-card)]"
        data-mode={viewMode}
        data-testid="excalidraw-diagram-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <WorkflowIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">
                {payload.title}
              </p>
              <p className="truncate text-muted-foreground text-xs">
                {viewMode === "excalidraw"
                  ? isTr
                    ? "Excalidraw · Düzenlenebilir tuval"
                    : "Excalidraw · Editable canvas"
                  : isTr
                    ? "Mermaid akış şeması"
                    : "Mermaid flow diagram"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {payload.scene && payload.mermaidFallback && (
              <button
                className="inline-flex min-h-10 items-center rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs hover:bg-muted"
                data-testid="excalidraw-toggle-mermaid"
                onClick={() =>
                  setViewMode((m) =>
                    m === "excalidraw" ? "mermaid" : "excalidraw"
                  )
                }
                type="button"
              >
                {viewMode === "excalidraw" ? "Mermaid" : "Excalidraw"}
              </button>
            )}
            {viewMode === "excalidraw" && payload.scene ? (
              <>
                <button
                  className="inline-flex min-h-10 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs hover:bg-muted"
                  data-testid="excalidraw-export-png"
                  onClick={handleExportPng}
                  type="button"
                >
                  <ImageIcon className="size-3.5" />
                  <span>PNG</span>
                </button>
                <button
                  className="inline-flex min-h-10 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-background px-3 font-medium text-foreground text-xs hover:bg-muted"
                  data-testid="excalidraw-export-svg"
                  onClick={handleExportSvg}
                  type="button"
                >
                  <FileCode2Icon className="size-3.5" />
                  <span>SVG</span>
                </button>
                <button
                  className="inline-flex min-h-10 items-center gap-1 rounded-full bg-primary px-3.5 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                  data-testid="excalidraw-download-scene"
                  onClick={handleDownloadExcalidraw}
                  type="button"
                >
                  <DownloadIcon className="size-3.5" />
                  <span>.excalidraw</span>
                </button>
                <button
                  aria-label={isTr ? "Tam ekran" : "Full screen"}
                  className="inline-flex min-h-10 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-background px-2.5 font-medium text-foreground text-xs hover:bg-muted"
                  data-testid="excalidraw-fullscreen"
                  onClick={() => setFullScreen(true)}
                  type="button"
                >
                  <ExpandIcon className="size-3.5" />
                </button>
              </>
            ) : payload.mermaidFallback ? (
              <button
                className="inline-flex min-h-10 items-center gap-1 rounded-full bg-primary px-3.5 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                data-testid="mermaid-download-btn"
                onClick={handleDownloadMermaid}
                type="button"
              >
                <DownloadIcon className="size-3.5" />
                <span>.mmd</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="border-[color:var(--hairline)] border-t bg-muted/25 p-3">
          {viewMode === "excalidraw" && payload.scene ? (
            <LazyExcalidrawCanvas exportRef={exportRef} scene={payload.scene} />
          ) : payload.mermaidFallback ? (
            <div
              className="overflow-x-auto rounded-xl border border-[color:var(--hairline)] bg-background p-4"
              data-testid="excalidraw-mermaid-fallback"
            >
              <MessageResponse>
                {`\`\`\`mermaid\n${payload.mermaidFallback}\n\`\`\``}
              </MessageResponse>
            </div>
          ) : null}
        </div>
      </div>

      {fullScreen &&
        payload.scene &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-label={payload.title}
            aria-modal="true"
            className="fixed inset-0 z-50 flex flex-col bg-background p-3 sm:p-5"
            data-testid="excalidraw-fullscreen-modal"
            role="dialog"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <p className="truncate font-semibold text-base text-foreground">
                {payload.title}
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-card px-3.5 font-medium text-foreground text-xs hover:bg-muted"
                  onClick={handleExportPng}
                  type="button"
                >
                  <span>PNG</span>
                </button>
                <button
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-card px-3.5 font-medium text-foreground text-xs hover:bg-muted"
                  onClick={handleExportSvg}
                  type="button"
                >
                  <span>SVG</span>
                </button>
                <button
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                  onClick={handleDownloadExcalidraw}
                  type="button"
                >
                  <DownloadIcon className="size-3.5" />
                  <span>.excalidraw</span>
                </button>
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
            <LazyExcalidrawCanvas
              exportRef={exportRef}
              heightClass="flex-1 min-h-0"
              scene={payload.scene}
            />
          </div>,
          document.body
        )}
    </>
  );
}
