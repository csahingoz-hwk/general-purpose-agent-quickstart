import { tool } from "ai";
import { z } from "zod";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  type NormalizedExcalidrawScene,
  validateAndNormalizeExcalidrawScene,
  validateMermaidCode,
} from "@/lib/excalidraw/schema";
import { sanitizeAttachmentFilename } from "@/lib/files/attachment-validator";

export type ExcalidrawToolPayload =
  | {
      status: "ok";
      kind: "excalidraw_diagram";
      title: string;
      filename: string;
      mode: "excalidraw" | "mermaid";
      scene: NormalizedExcalidrawScene | null;
      mermaidFallback: string | null;
    }
  | {
      status: "blocked" | "error";
      message: string;
    };

export function createExcalidrawDiagramTool() {
  return tool({
    description:
      "Create an interactive, editable Excalidraw diagram in chat (validated scene JSON with shapes, arrows, and labels; exports PNG, SVG, and .excalidraw) with optional Mermaid fallback for simple flows.",
    inputSchema: z.object({
      title: z.string().trim().min(2).max(120),
      mode: z
        .enum(["excalidraw", "mermaid"])
        .default("excalidraw")
        .optional()
        .describe(
          "Use 'excalidraw' for architecture, system, ER, or rich visual diagrams; 'mermaid' only as a simple-flow fallback."
        ),
      elementsJson: z
        .string()
        .trim()
        .min(2)
        .max(36_000)
        .optional()
        .describe(
          'JSON-serialized array of Excalidraw elements (`rectangle`, `ellipse`, `diamond`, `arrow`, `line`, `text`, `frame`), e.g. \'[{"id":"api","type":"rectangle","x":80,"y":120,"width":180,"height":76,"backgroundColor":"#dbeafe","label":"API Gateway"}]\'.'
        ),
      viewBackgroundColor: z.string().trim().max(32).optional(),
      mermaidFallback: z
        .string()
        .max(8000)
        .optional()
        .describe(
          "Optional Mermaid diagram syntax (`flowchart TD ...` or `sequenceDiagram ...`) as a fallback for simple flows."
        ),
    }),
    execute: (input): Promise<ExcalidrawToolPayload> => {
      if (containsRestrictedWorkData(JSON.stringify(input))) {
        return Promise.resolve({
          status: "blocked",
          message:
            "Blocked: employer/Korn Ferry material cannot be rendered in personal diagram exports.",
        });
      }

      const slug = sanitizeAttachmentFilename(
        input.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48) || "diagram"
      );
      const filename = slug.endsWith(".excalidraw")
        ? slug
        : `${slug}.excalidraw`;
      const validMermaid = validateMermaidCode(input.mermaidFallback);

      if (input.elementsJson) {
        let parsedElements: unknown;
        try {
          const rawParsed = JSON.parse(input.elementsJson) as unknown;
          parsedElements =
            rawParsed &&
            typeof rawParsed === "object" &&
            !Array.isArray(rawParsed) &&
            "elements" in (rawParsed as Record<string, unknown>)
              ? (rawParsed as { elements: unknown }).elements
              : rawParsed;
        } catch {
          if (validMermaid) {
            return Promise.resolve({
              status: "ok",
              kind: "excalidraw_diagram",
              title: input.title,
              filename,
              mode: "mermaid",
              scene: null,
              mermaidFallback: validMermaid,
            });
          }
          return Promise.resolve({
            status: "error",
            message:
              "Invalid Excalidraw elementsJson: expected a valid JSON array of elements.",
          });
        }

        if (Array.isArray(parsedElements) && parsedElements.length > 0) {
          const checked = validateAndNormalizeExcalidrawScene({
            type: "excalidraw",
            version: 2,
            elements: parsedElements,
            appState: input.viewBackgroundColor
              ? { viewBackgroundColor: input.viewBackgroundColor }
              : undefined,
          });

          if (checked.valid) {
            return Promise.resolve({
              status: "ok",
              kind: "excalidraw_diagram",
              title: input.title,
              filename,
              mode:
                input.mode === "mermaid" && validMermaid
                  ? "mermaid"
                  : "excalidraw",
              scene: checked.scene,
              mermaidFallback: validMermaid,
            });
          }

          if (validMermaid) {
            return Promise.resolve({
              status: "ok",
              kind: "excalidraw_diagram",
              title: input.title,
              filename,
              mode: "mermaid",
              scene: null,
              mermaidFallback: validMermaid,
            });
          }

          return Promise.resolve({
            status: "error",
            message: `Invalid Excalidraw scene schema: ${checked.error}`,
          });
        }
      }

      if (validMermaid) {
        return Promise.resolve({
          status: "ok",
          kind: "excalidraw_diagram",
          title: input.title,
          filename,
          mode: "mermaid",
          scene: null,
          mermaidFallback: validMermaid,
        });
      }

      return Promise.resolve({
        status: "error",
        message:
          "Provide valid Excalidraw `elementsJson` (or `mermaidFallback` for a simple flow).",
      });
    },
  });
}
