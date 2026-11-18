import { streamText } from "ai";
import { artifactSettings } from "@/lib/ai/artifact-settings";
import {
  fetchGroundedNewsBriefing,
  GROUNDED_NEWS_PAGE_RULES,
  isNewsPageOrBriefingTarget,
} from "@/lib/ai/grounded-news";
import { codePrompt, updateDocumentPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocumentHandler } from "@/lib/artifacts/server";

function stripFences(code: string): string {
  return code
    .replace(/^```[\w]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export const codeDocumentHandler = createDocumentHandler<"code">({
  kind: "code",
  onCreateDocument: async ({ title, dataStream, modelId, abortSignal }) => {
    let draftContent = "";
    const needsGroundedNews = isNewsPageOrBriefingTarget({ title });
    const grounded = needsGroundedNews
      ? await fetchGroundedNewsBriefing(title).catch(() => null)
      : null;
    const extraNewsBlock = needsGroundedNews
      ? `\n\n${GROUNDED_NEWS_PAGE_RULES}\n\n${
          grounded?.promptContext
            ? `Use ONLY the verified live Google Search results below (each item with its real publication date and clickable https:// source link):\n\n${grounded.promptContext}`
            : "Live web search returned no verified items in this environment; render an honest empty-state notice and do NOT invent headlines, dates, or URLs."
        }`
      : "";

    const { stream } = streamText({
      model: getLanguageModel(modelId),
      ...artifactSettings(
        `${codePrompt}${extraNewsBlock}\n\nOutput ONLY the code. No explanations, no markdown fences, no wrapping.`,
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
          type: "data-codeDelta",
          data: stripFences(draftContent),
          transient: true,
        });
      }
    }

    if (!stripFences(draftContent)) {
      throw new Error("Empty artifact response");
    }
    return stripFences(draftContent);
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
        `${updateDocumentPrompt(document.content, "code")}\n\nOutput ONLY the complete updated code. No explanations, no markdown fences, no wrapping.`,
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
          type: "data-codeDelta",
          data: stripFences(draftContent),
          transient: true,
        });
      }
    }

    if (!stripFences(draftContent)) {
      throw new Error("Empty artifact response");
    }
    return stripFences(draftContent);
  },
});
