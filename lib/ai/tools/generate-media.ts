import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { streamGeneratedImageToArtifact } from "@/artifacts/image/server";
import type { UsageLedger } from "@/lib/ai/routing/ledger";
import type { PrivateFileStore } from "@/lib/files/store";
import {
  generateImageWithImagen,
  generateVideoWithVeo,
} from "@/lib/media/media-studio";
import type { BackgroundTaskStore } from "@/lib/tasks/runner";
import type { ChatMessage } from "@/lib/types";
import type { SecretVaultStore } from "@/lib/vault/secret-vault";

export type MediaPreviewPayload =
  | {
      status: "ok";
      kind: "image";
      title: string;
      prompt: string;
      fileUrl: string;
      model: string;
      reservedUsd: number;
    }
  | {
      status: "queued";
      kind: "video";
      title: string;
      prompt: string;
      taskId: string;
      operationName: string;
      model: string;
      reservedUsd: number;
    }
  | {
      status:
        | "blocked_data_boundary"
        | "setup_required"
        | "spend_cap_exceeded"
        | "blocked_untrusted_context"
        | "error";
      kind: "image" | "video";
      title: string;
      message: string;
    };

export function createMediaTools(opts: {
  userId: string;
  ledger?: UsageLedger;
  dataStream?: UIMessageStreamWriter<ChatMessage>;
  hasUntrustedContext?: boolean;
  vaultStore?: SecretVaultStore;
  fileStore?: PrivateFileStore;
  taskStore?: BackgroundTaskStore;
  signingSecret?: string;
  fetchImpl?: typeof fetch;
}) {
  const generateImageAsset = tool({
    description:
      "Generate a PNG image using Google Imagen (reserves spend in ModelUsage and opens the image artifact viewer).",
    inputSchema: z.object({
      title: z
        .string()
        .min(2)
        .max(100)
        .describe("Short title for the generated image artifact"),
      prompt: z
        .string()
        .min(3)
        .max(1600)
        .describe("Detailed visual prompt for Imagen"),
      aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).optional(),
    }),
    execute: async ({
      title,
      prompt,
      aspectRatio,
    }): Promise<MediaPreviewPayload> => {
      const res = await generateImageWithImagen({
        userId: opts.userId,
        prompt,
        aspectRatio,
        ledger: opts.ledger,
        vaultStore: opts.vaultStore,
        fileStore: opts.fileStore,
        signingSecret: opts.signingSecret,
        fetchImpl: opts.fetchImpl,
      });

      if (res.status !== "ok") {
        return {
          status: res.status,
          kind: "image",
          title,
          message: res.message,
        };
      }

      if (opts.dataStream) {
        streamGeneratedImageToArtifact({
          dataStream: opts.dataStream,
          id: res.fileId,
          title,
          base64Png: res.base64Png,
        });
      }

      return {
        status: "ok",
        kind: "image",
        title,
        prompt: res.prompt,
        fileUrl: res.fileUrl,
        model: res.model,
        reservedUsd: res.reservedUsd,
      };
    },
  });

  const generateVideoClip = tool({
    description:
      "Queue a short 5-second video clip using Google Veo (requires owner approval and reserves spend in ModelUsage).",
    inputSchema: z.object({
      title: z
        .string()
        .min(2)
        .max(100)
        .describe("Short title for the video clip"),
      prompt: z
        .string()
        .min(3)
        .max(1600)
        .describe("Scene and motion description for Veo"),
      aspectRatio: z.enum(["16:9", "9:16"]).optional(),
    }),
    needsApproval: true,
    execute: async ({
      title,
      prompt,
      aspectRatio,
    }): Promise<MediaPreviewPayload> => {
      const res = await generateVideoWithVeo({
        userId: opts.userId,
        prompt,
        aspectRatio,
        ledger: opts.ledger,
        vaultStore: opts.vaultStore,
        taskStore: opts.taskStore,
        fetchImpl: opts.fetchImpl,
      });

      if (res.status !== "queued") {
        return {
          status: res.status,
          kind: "video",
          title,
          message: res.message,
        };
      }

      return {
        status: "queued",
        kind: "video",
        title,
        prompt: res.prompt,
        taskId: res.task.id,
        operationName: res.operationName,
        model: res.model,
        reservedUsd: res.reservedUsd,
      };
    },
  });

  return {
    generateImageAsset,
    generateVideoClip,
  };
}
