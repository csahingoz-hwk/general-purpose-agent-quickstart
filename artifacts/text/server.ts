import { smoothStream, streamText } from "ai";
import { artifactSettings } from "@/lib/ai/artifact-settings";
import {
  fetchGroundedNewsBriefing,
  GROUNDED_NEWS_PAGE_RULES,
  isNewsPageOrBriefingTarget,
} from "@/lib/ai/grounded-news";
import { updateDocumentPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocumentHandler } from "@/lib/artifacts/server";

export const textDocumentHandler = createDocumentHandler<"text">({
  kind: "text",
  onCreateDocument: async ({ title, dataStream, modelId, abortSignal }) => {
    let draftContent = "";
    const needsGroundedNews = isNewsPageOrBriefingTarget({ title });
    const grounded = needsGroundedNews
      ? await fetchGroundedNewsBriefing(title).catch(() => null)
      : null;
    const baseInstruction = needsGroundedNews
      ? [
          "Write about the topic. Use Markdown headings where appropriate.",
          GROUNDED_NEWS_PAGE_RULES,
          grounded?.promptContext
            ? `Use ONLY the verified live Google Search results below (each item with its real publication date and clickable https:// source link):\n\n${grounded.promptContext}`
            : "Live web search returned no verified items in this environment; state clearly that live search results could not be retrieved right now and do NOT invent headlines, dates, or URLs.",
        ].join("\n\n")
      : "Write about the topic. Use Markdown headings where appropriate.";

    const { stream } = streamText({
      model: getLanguageModel(modelId),
      ...artifactSettings(baseInstruction, title, abortSignal),
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
