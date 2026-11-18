import { streamText } from "ai";
import { artifactSettings } from "@/lib/ai/artifact-settings";
import { sheetPrompt, updateDocumentPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocumentHandler } from "@/lib/artifacts/server";

export const sheetDocumentHandler = createDocumentHandler<"sheet">({
  kind: "sheet",
  onCreateDocument: async ({ title, dataStream, modelId, abortSignal }) => {
    let draftContent = "";

    const { stream } = streamText({
      model: getLanguageModel(modelId),
      ...artifactSettings(
        `${sheetPrompt}\n\nOutput ONLY the raw CSV data. No explanations, no markdown fences.`,
        title,
        abortSignal
      ),
    });

    for await (const delta of stream) {
      if (delta.type === "error") {
        throw delta.error;
      }
      if (delta.type === "abort") {
        throw new Error("Artifact generation interrupted");
      }
      if (delta.type === "text-delta") {
        draftContent += delta.text;
        dataStream.write({
          type: "data-sheetDelta",
          data: draftContent,
          transient: true,
        });
      }
    }

    if (!draftContent.trim()) {
      throw new Error("Empty artifact response");
    }
    return draftContent;
  },
  onUpdateDocument: async ({
    document,
    description,
    dataStream,
    modelId,
    abortSignal,
  }) => {
    let draftContent = "";

    const { stream } = streamText({
      model: getLanguageModel(modelId),
      ...artifactSettings(
        `${updateDocumentPrompt(document.content, "sheet")}\n\nOutput ONLY the raw CSV data. No explanations, no markdown fences.`,
        description,
        abortSignal
      ),
    });

    for await (const delta of stream) {
      if (delta.type === "error") {
        throw delta.error;
      }
      if (delta.type === "abort") {
        throw new Error("Artifact generation interrupted");
      }
      if (delta.type === "text-delta") {
        draftContent += delta.text;
        dataStream.write({
          type: "data-sheetDelta",
          data: draftContent,
          transient: true,
        });
      }
    }

    if (!draftContent.trim()) {
      throw new Error("Empty artifact response");
    }
    return draftContent;
  },
});
