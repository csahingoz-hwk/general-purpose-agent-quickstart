import type { UIMessageStreamWriter } from "ai";
import type { ChatMessage } from "@/lib/types";

/**
 * Streams a generated PNG image into the `artifacts/image` side-panel viewer
 * (`artifacts/image/client.tsx`) without inflating chat context tokens.
 */
export function streamGeneratedImageToArtifact(opts: {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  id: string;
  title: string;
  base64Png: string;
}): void {
  opts.dataStream.write({
    type: "data-kind",
    data: "image",
    transient: true,
  });
  opts.dataStream.write({
    type: "data-id",
    data: opts.id,
    transient: true,
  });
  opts.dataStream.write({
    type: "data-title",
    data: opts.title,
    transient: true,
  });
  opts.dataStream.write({
    type: "data-clear",
    data: null,
    transient: true,
  });
  opts.dataStream.write({
    type: "data-imageDelta",
    data: opts.base64Png,
    transient: true,
  });
  opts.dataStream.write({
    type: "data-finish",
    data: null,
    transient: true,
  });
}
