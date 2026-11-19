import { z } from "zod";

export const EXCALIDRAW_ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "text",
  "frame",
] as const;

const labelShorthandSchema = z.union([
  z.string().trim().min(1).max(300),
  z.object({
    text: z.string().trim().min(1).max(300),
    fontSize: z.number().min(10).max(48).optional(),
    strokeColor: z.string().trim().max(32).optional(),
  }),
]);

const bindingSchema = z
  .union([
    z.string().trim().min(1).max(120),
    z.object({
      elementId: z.string().trim().min(1).max(120),
      focus: z.number().min(-4).max(4).optional(),
      gap: z.number().min(0).max(120).optional(),
    }),
  ])
  .nullable()
  .optional();

export const excalidrawElementInputSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  type: z.enum(EXCALIDRAW_ELEMENT_TYPES),
  x: z.number().finite().min(-20_000).max(20_000),
  y: z.number().finite().min(-20_000).max(20_000),
  width: z.number().finite().min(-10_000).max(10_000).optional(),
  height: z.number().finite().min(-10_000).max(10_000).optional(),
  strokeColor: z.string().trim().max(32).optional(),
  backgroundColor: z.string().trim().max(32).optional(),
  fillStyle: z.enum(["solid", "hachure", "cross-hatch"]).optional(),
  strokeWidth: z.number().min(0.5).max(16).optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  roughness: z.number().min(0).max(4).optional(),
  opacity: z.number().min(0).max(100).optional(),
  text: z.string().max(1200).optional(),
  fontSize: z.number().min(8).max(96).optional(),
  label: labelShorthandSchema.optional(),
  points: z
    .array(z.tuple([z.number().finite(), z.number().finite()]))
    .max(128)
    .optional(),
  startBinding: bindingSchema,
  endBinding: bindingSchema,
  endArrowhead: z
    .enum(["arrow", "bar", "dot", "triangle", "none"])
    .nullable()
    .optional(),
  containerId: z.string().trim().max(120).nullable().optional(),
});

export const excalidrawSceneInputSchema = z.object({
  type: z.literal("excalidraw").default("excalidraw").optional(),
  version: z.number().int().min(1).max(10).default(2).optional(),
  elements: z.array(excalidrawElementInputSchema).min(1).max(200),
  appState: z
    .object({
      viewBackgroundColor: z.string().trim().max(32).optional(),
      gridSize: z.number().int().min(0).max(100).nullable().optional(),
    })
    .optional(),
});

export type NormalizedExcalidrawScene = {
  type: "excalidraw";
  version: 2;
  source: "assistant";
  elements: Record<string, unknown>[];
  appState: {
    viewBackgroundColor: string;
    gridSize: number | null;
  };
  files: Record<string, never>;
};

const MERMAID_HEADER_RE =
  /^\s*(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|gantt|journey|mindmap|pie|timeline)\b/m;

export function validateMermaidCode(raw?: string | null): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const stripped = raw
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!stripped || stripped.length > 16_000) {
    return null;
  }
  if (!MERMAID_HEADER_RE.test(stripped)) {
    return null;
  }
  return stripped;
}

function deterministicSeed(index: number, id: string): number {
  let hash = 2_166_136_261 ^ index;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return Math.abs(hash) % 2_000_000_000 || index + 1;
}

/**
 * Validates model-generated Excalidraw scene JSON against a strict Zod schema
 * and expands shape/arrow `label` shorthands into bound Excalidraw v2 elements
 * so the scene renders cleanly in `@excalidraw/excalidraw` and exports as a
 * standard `.excalidraw` file.
 */
export function validateAndNormalizeExcalidrawScene(
  rawInput: unknown
):
  | { valid: true; scene: NormalizedExcalidrawScene }
  | { valid: false; error: string } {
  const parsed = excalidrawSceneInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      valid: false,
      error: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "scene"}: ${i.message}`)
        .join("; "),
    };
  }

  const now = Date.now();
  const normalizedElements: Record<string, unknown>[] = [];

  parsed.data.elements.forEach((el, idx) => {
    const id = el.id?.trim() || `el_${idx + 1}`;
    const seed = deterministicSeed(idx + 1, id);
    const strokeColor = el.strokeColor || "#1e293b";
    const backgroundColor = el.backgroundColor || "transparent";
    const isLinear = el.type === "arrow" || el.type === "line";

    const labelText =
      typeof el.label === "string"
        ? el.label
        : el.label && typeof el.label === "object"
          ? el.label.text
          : undefined;
    const labelFontSize =
      el.label && typeof el.label === "object" && el.label.fontSize
        ? el.label.fontSize
        : 18;
    const boundTextId = labelText ? `${id}_label` : null;

    const width =
      el.width ??
      (isLinear
        ? Math.abs((el.points?.at(-1)?.[0] ?? 120) - (el.points?.[0]?.[0] ?? 0))
        : el.type === "text"
          ? Math.max(60, (el.text?.length ?? 8) * 10)
          : 180);
    const height =
      el.height ??
      (isLinear
        ? Math.abs((el.points?.at(-1)?.[1] ?? 0) - (el.points?.[0]?.[1] ?? 0))
        : el.type === "text"
          ? 28
          : 76);

    const baseElement: Record<string, unknown> = {
      id,
      type: el.type,
      x: el.x,
      y: el.y,
      width,
      height,
      angle: 0,
      strokeColor,
      backgroundColor,
      fillStyle: el.fillStyle ?? "solid",
      strokeWidth: el.strokeWidth ?? 2,
      strokeStyle: el.strokeStyle ?? "solid",
      roughness: el.roughness ?? 1,
      opacity: el.opacity ?? 100,
      groupIds: [],
      frameId: null,
      roundness:
        el.type === "rectangle" || el.type === "diamond" || isLinear
          ? { type: isLinear ? 2 : 3 }
          : null,
      seed,
      version: 1,
      versionNonce: seed + 7,
      isDeleted: false,
      boundElements: boundTextId ? [{ id: boundTextId, type: "text" }] : [],
      updated: now,
      link: null,
      locked: false,
    };

    if (isLinear) {
      const pts =
        el.points && el.points.length >= 2
          ? el.points
          : [
              [0, 0],
              [width || 120, height || 0],
            ];
      const normalizeBinding = (
        b: typeof el.startBinding
      ): Record<string, unknown> | null => {
        if (!b) {
          return null;
        }
        if (typeof b === "string") {
          return { elementId: b, focus: 0, gap: 6 };
        }
        return {
          elementId: b.elementId,
          focus: b.focus ?? 0,
          gap: b.gap ?? 6,
        };
      };
      baseElement.points = pts;
      baseElement.lastCommittedPoint = null;
      baseElement.startBinding = normalizeBinding(el.startBinding);
      baseElement.endBinding = normalizeBinding(el.endBinding);
      baseElement.startArrowhead = null;
      baseElement.endArrowhead =
        el.type === "arrow"
          ? el.endArrowhead === "none"
            ? null
            : (el.endArrowhead ?? "arrow")
          : null;
    }

    if (el.type === "text") {
      const txt = el.text ?? labelText ?? "";
      const fs = el.fontSize ?? 18;
      baseElement.text = txt;
      baseElement.fontSize = fs;
      baseElement.fontFamily = 1;
      baseElement.textAlign = el.containerId ? "center" : "left";
      baseElement.verticalAlign = el.containerId ? "middle" : "top";
      baseElement.containerId = el.containerId ?? null;
      baseElement.originalText = txt;
      baseElement.lineHeight = 1.25;
      baseElement.boundElements = [];
    }

    normalizedElements.push(baseElement);

    if (boundTextId && labelText && el.type !== "text") {
      const lines = labelText.split("\n");
      const maxChars = Math.max(...lines.map((l) => l.length), 4);
      const textWidth = Math.min(
        Math.max(48, width - 20),
        Math.max(60, Math.round(maxChars * labelFontSize * 0.58))
      );
      const textHeight = Math.max(
        24,
        Math.round(lines.length * labelFontSize * 1.25)
      );
      const centerX = isLinear
        ? el.x + ((el.points?.at(-1)?.[0] ?? width) / 2 - textWidth / 2)
        : el.x + (width - textWidth) / 2;
      const centerY = isLinear
        ? el.y + ((el.points?.at(-1)?.[1] ?? height) / 2 - textHeight / 2)
        : el.y + (height - textHeight) / 2;

      normalizedElements.push({
        id: boundTextId,
        type: "text",
        x: centerX,
        y: centerY,
        width: textWidth,
        height: textHeight,
        angle: 0,
        strokeColor,
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: seed + 19,
        version: 1,
        versionNonce: seed + 23,
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
        text: labelText,
        fontSize: labelFontSize,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: id,
        originalText: labelText,
        lineHeight: 1.25,
      });
    }
  });

  return {
    valid: true,
    scene: {
      type: "excalidraw",
      version: 2,
      source: "assistant",
      elements: normalizedElements,
      appState: {
        viewBackgroundColor:
          parsed.data.appState?.viewBackgroundColor || "#ffffff",
        gridSize: parsed.data.appState?.gridSize ?? null,
      },
      files: {},
    },
  };
}
