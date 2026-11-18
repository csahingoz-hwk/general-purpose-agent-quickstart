import { tool } from "ai";
import { z } from "zod";
import {
  classifyCloudCommand,
  cloudBrowsePublicUrl,
  cloudReadWorkspaceFile,
  cloudRunExec,
  cloudWriteWorkspaceFile,
  resolveSafeWorkspacePath,
} from "@/lib/cloud-computer/client";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  type AllowedAttachmentMediaType,
  sanitizeAttachmentFilename,
} from "@/lib/files/attachment-validator";
import { createSignedFileToken } from "@/lib/files/signed-url";
import {
  getDefaultPrivateFileStore,
  type PrivateFileStore,
} from "@/lib/files/store";
import { reviewActionRisk } from "@/lib/safety/action-review";

function inferExportMediaType(
  filename: string
): AllowedAttachmentMediaType | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  return null;
}

export function createCloudComputerTools(opts: {
  userId: string;
  hasUntrustedContext?: boolean;
  fileStore?: PrivateFileStore;
  relayUrl?: string;
  hmacSecret?: string;
  signingSecret?: string;
  fetchImpl?: typeof fetch;
}) {
  const {
    userId,
    hasUntrustedContext = false,
    relayUrl,
    hmacSecret,
    signingSecret,
    fetchImpl,
  } = opts;
  const fileStore = opts.fileStore ?? getDefaultPrivateFileStore();

  const cloudExec = tool({
    description:
      "Run a shell command (bash, git, python3, node, pnpm, curl) on the assistant's persistent sandboxed Linux Cloud Computer (/workspace). Automatically wakes the VM if suspended. Destructive or outbound push commands pause for approval.",
    inputSchema: z.object({
      command: z
        .string()
        .trim()
        .min(1)
        .max(4000)
        .describe("Shell command to execute inside /workspace."),
      cwd: z
        .string()
        .trim()
        .max(240)
        .default("/workspace")
        .optional()
        .describe(
          "Working directory inside /workspace (e.g. '/workspace/app')."
        ),
      timeoutSec: z.number().int().min(2).max(90).default(30).optional(),
    }),
    execute: async ({ command, cwd = "/workspace", timeoutSec = 30 }) => {
      const decision = classifyCloudCommand(command);
      if (decision.tier === "blocked") {
        return {
          status: "blocked" as const,
          command,
          cwd,
          message: decision.reason,
        };
      }

      if (decision.tier === "needs_approval" || hasUntrustedContext) {
        const review = reviewActionRisk({
          toolName: "cloudExec",
          input: { command, cwd },
          hasUntrustedContext,
        });
        return {
          status: "awaiting_approval" as const,
          command,
          cwd,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message:
            decision.tier === "needs_approval"
              ? decision.reason
              : "Command follows untrusted external content and requires your approval before running.",
        };
      }

      try {
        const res = await cloudRunExec({
          command,
          cwd,
          timeoutSec,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        return {
          status: res.exitCode === 0 ? ("ok" as const) : ("failed" as const),
          command,
          cwd: res.cwd,
          exitCode: res.exitCode,
          stdout: res.stdout.slice(0, 8000),
          stderr: res.stderr.slice(0, 4000),
          durationMs: res.durationMs,
          vmWakeMs: res.vmWakeMs,
        };
      } catch (err) {
        return {
          status: "setup_required" as const,
          command,
          cwd,
          message:
            err instanceof Error
              ? err.message
              : "Cloud Computer could not run that command right now.",
        };
      }
    },
  });

  const cloudWriteFile = tool({
    description:
      "Write or update a text/script file inside /workspace on the Cloud Computer.",
    inputSchema: z.object({
      path: z
        .string()
        .trim()
        .min(1)
        .max(240)
        .describe("File path inside /workspace, e.g. 'analysis/run.py'."),
      content: z.string().max(250_000).describe("UTF-8 file contents."),
    }),
    execute: async ({ path: rawPath, content }) => {
      if (containsRestrictedWorkData(`${rawPath}\n${content}`)) {
        return {
          status: "blocked" as const,
          path: rawPath,
          message:
            "Blocked: employer/Korn Ferry material cannot be written to the personal Cloud Computer.",
        };
      }
      try {
        const safePath = resolveSafeWorkspacePath(rawPath);
        const res = await cloudWriteWorkspaceFile({
          path: safePath,
          contentBase64: Buffer.from(content, "utf8").toString("base64"),
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        return {
          status: "ok" as const,
          path: res.path,
          bytesWritten: res.bytesWritten,
        };
      } catch (err) {
        return {
          status: "error" as const,
          path: rawPath,
          message: err instanceof Error ? err.message : "Failed to write file.",
        };
      }
    },
  });

  const cloudExportFileToChat = tool({
    description:
      "Read a generated file (CSV, PDF, PNG, JPEG, or text) from /workspace on the Cloud Computer and attach a private signed download link into the chat.",
    inputSchema: z.object({
      path: z
        .string()
        .trim()
        .min(1)
        .max(240)
        .describe("Path inside /workspace, e.g. '/workspace/report.csv'."),
    }),
    execute: async ({ path: rawPath }) => {
      try {
        const safePath = resolveSafeWorkspacePath(rawPath);
        const read = await cloudReadWorkspaceFile({
          path: safePath,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        const bytes = new Uint8Array(Buffer.from(read.base64, "base64"));
        const safeName = sanitizeAttachmentFilename(safePath);
        const mediaType = inferExportMediaType(safeName);

        if (!mediaType) {
          const previewText = Buffer.from(bytes)
            .toString("utf8")
            .slice(0, 6000);
          return {
            status: "ok" as const,
            path: read.path,
            filename: safeName,
            sizeBytes: bytes.byteLength,
            textPreview: previewText,
          };
        }

        const stored = await fileStore.save({
          userId,
          safeName,
          contentType: mediaType,
          bytes,
        });
        const token = createSignedFileToken({
          uid: userId,
          fid: stored.fileId,
          name: safeName,
          ct: mediaType,
          size: bytes.byteLength,
          ref: stored.storageRef,
          secret: signingSecret,
        });
        return {
          status: "ok" as const,
          path: read.path,
          filename: safeName,
          mediaType,
          sizeBytes: bytes.byteLength,
          downloadUrl: `/api/files/${encodeURIComponent(token)}`,
        };
      } catch (err) {
        return {
          status: "error" as const,
          path: rawPath,
          message:
            err instanceof Error ? err.message : "Could not export file.",
        };
      }
    },
  });

  const cloudBrowseUrl = tool({
    description:
      "Open a public web page in headless Chromium on the Cloud Computer (uses zero Mac mini RAM), extract readable page content inside an untrusted-content fence, and optionally attach a PNG screenshot.",
    inputSchema: z.object({
      url: z.string().trim().min(4).max(1024),
      captureScreenshot: z.boolean().default(false).optional(),
    }),
    execute: async ({ url, captureScreenshot = false }) => {
      try {
        const res = await cloudBrowsePublicUrl({
          url,
          captureScreenshot,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        let screenshotUrl: string | undefined;
        if (res.screenshotBase64) {
          const pngBytes = new Uint8Array(
            Buffer.from(res.screenshotBase64, "base64")
          );
          const stored = await fileStore.save({
            userId,
            safeName: "browser-snapshot.png",
            contentType: "image/png",
            bytes: pngBytes,
          });
          const token = createSignedFileToken({
            uid: userId,
            fid: stored.fileId,
            name: "browser-snapshot.png",
            ct: "image/png",
            size: pngBytes.byteLength,
            ref: stored.storageRef,
            secret: signingSecret,
          });
          screenshotUrl = `/api/files/${encodeURIComponent(token)}`;
        }
        return {
          status: "ok" as const,
          url: res.url,
          title: res.title,
          content: res.fencedText,
          ...(screenshotUrl ? { screenshotUrl } : {}),
        };
      } catch (err) {
        return {
          status: "error" as const,
          url,
          message: err instanceof Error ? err.message : "Cloud browser failed.",
        };
      }
    },
  });

  const cloudReadFile = tool({
    description:
      "Read a text, log, JSON, or code file inside /workspace on the Cloud Computer.",
    inputSchema: z.object({
      path: z
        .string()
        .trim()
        .min(1)
        .max(240)
        .describe("Path inside /workspace, e.g. '/workspace/app/output.json'."),
    }),
    execute: async ({ path: rawPath }) => {
      if (containsRestrictedWorkData(rawPath)) {
        return {
          status: "blocked" as const,
          path: rawPath,
          message:
            "Blocked: employer/Korn Ferry paths cannot be read from the personal Cloud Computer.",
        };
      }
      try {
        const safePath = resolveSafeWorkspacePath(rawPath);
        const read = await cloudReadWorkspaceFile({
          path: safePath,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        const text = Buffer.from(read.base64, "base64")
          .toString("utf8")
          .slice(0, 16_000);
        return {
          status: "ok" as const,
          path: read.path,
          sizeBytes: read.sizeBytes,
          content: text,
        };
      } catch (err) {
        return {
          status: "error" as const,
          path: rawPath,
          message: err instanceof Error ? err.message : "Could not read file.",
        };
      }
    },
  });

  return {
    cloudExec,
    cloudWriteFile,
    cloudReadFile,
    cloudExportFileToChat,
    cloudBrowseUrl,
  };
}
