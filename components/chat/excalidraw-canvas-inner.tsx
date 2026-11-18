"use client";

import "@excalidraw/excalidraw/index.css";
import { Excalidraw, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import { useTheme } from "next-themes";
import { useImperativeHandle, useRef } from "react";
import type { NormalizedExcalidrawScene } from "@/lib/excalidraw/schema";

export type ExcalidrawExportHandle = {
  exportPng: () => Promise<Blob | null>;
  exportSvgString: () => Promise<string | null>;
  exportSceneJson: () => string;
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export default function ExcalidrawCanvasInner({
  scene,
  heightClass = "h-[430px]",
  exportRef,
}: {
  scene: NormalizedExcalidrawScene;
  heightClass?: string;
  exportRef?: React.Ref<ExcalidrawExportHandle>;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const latestElementsRef = useRef<readonly Record<string, unknown>[]>(
    scene.elements
  );
  const latestAppStateRef = useRef<Record<string, unknown>>(scene.appState);
  const latestFilesRef = useRef<Record<string, unknown>>(scene.files);

  useImperativeHandle(exportRef, () => ({
    async exportPng() {
      const elements = latestElementsRef.current.filter(
        (el) => !el.isDeleted
      ) as never;
      const blob = await exportToBlob({
        elements,
        appState: {
          ...latestAppStateRef.current,
          exportBackground: true,
          exportWithDarkMode: isDark,
        } as never,
        files: latestFilesRef.current as never,
        mimeType: "image/png",
      });
      return blob;
    },
    async exportSvgString() {
      const elements = latestElementsRef.current.filter(
        (el) => !el.isDeleted
      ) as never;
      const svgEl = await exportToSvg({
        elements,
        appState: {
          ...latestAppStateRef.current,
          exportBackground: true,
          exportWithDarkMode: isDark,
        } as never,
        files: latestFilesRef.current as never,
      });
      return new XMLSerializer().serializeToString(svgEl);
    },
    exportSceneJson() {
      return JSON.stringify(
        {
          type: "excalidraw",
          version: 2,
          source: "assistant",
          elements: latestElementsRef.current.filter((el) => !el.isDeleted),
          appState: {
            viewBackgroundColor:
              (latestAppStateRef.current.viewBackgroundColor as string) ??
              (isDark ? "#121212" : "#ffffff"),
            gridSize: null,
          },
          files: latestFilesRef.current,
        },
        null,
        2
      );
    },
  }));

  return (
    <div
      className={`w-full overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-background ${heightClass}`}
      data-testid="excalidraw-live-canvas"
    >
      <Excalidraw
        initialData={{
          elements: scene.elements as never,
          appState: {
            ...scene.appState,
            viewBackgroundColor: isDark ? "#121212" : "#ffffff",
            scrollToContent: true,
          } as never,
          scrollToContent: true,
        }}
        onChange={(elements, appState, files) => {
          latestElementsRef.current = elements as unknown as readonly Record<
            string,
            unknown
          >[];
          latestAppStateRef.current = appState as unknown as Record<
            string,
            unknown
          >;
          latestFilesRef.current = files as unknown as Record<string, unknown>;
        }}
        theme={isDark ? "dark" : "light"}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
      />
    </div>
  );
}

export { triggerBlobDownload };
