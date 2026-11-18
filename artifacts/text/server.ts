import { smoothStream, streamText } from "ai";
import { artifactSettings } from "@/lib/ai/artifact-settings";
import { updateDocumentPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocumentHandler } from "@/lib/artifacts/server";

export const textDocumentHandler = createDocumentHandler<"text">({
  kind: "text",
  onCreateDocument: async ({ title, dataStream, modelId, abortSignal }) => {
    let draftContent = "";

    const { stream } = streamText({
      model: getLanguageModel(modelId),
      ...artifactSettings(
        "Write about the topic. Use Markdown headings where appropriate.",
        title,
        abortSignal
      ),
      experimental_transform: smoothStream({ chunking: "word" }),
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
          type: "data-textDelta",
          data: delta.text,
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
        updateDocumentPrompt(document.content, "text"),
        description,
        abortSignal
      ),
      experimental_transform: smoothStream({ chunking: "word" }),
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
          type: "data-textDelta",
          data: delta.text,
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
