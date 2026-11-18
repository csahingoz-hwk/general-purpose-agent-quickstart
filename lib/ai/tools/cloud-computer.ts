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
import {
  type CloudComputerLifecycleStore,
  resolveCloudLifecycleStore,
} from "@/lib/cloud-computer/lifecycle";
import {
  buildScreenHandoffPayload,
  detectScreenHandoffChallenge,
} from "@/lib/cloud-computer/screen-handoff";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  inferPrivateFileMediaType,
  sanitizeAttachmentFilename,
} from "@/lib/files/attachment-validator";
import { createSignedFileToken } from "@/lib/files/signed-url";
import {
  getDefaultPrivateFileStore,
  type PrivateFileStore,
} from "@/lib/files/store";
import { reviewActionRisk } from "@/lib/safety/action-review";

export function createCloudComputerTools(opts: {
  userId: string;
  hasUntrustedContext?: boolean;
  fileStore?: PrivateFileStore;
  lifecycleStore?: CloudComputerLifecycleStore;
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
  const lifecycle = resolveCloudLifecycleStore(opts.lifecycleStore);

  const cloudExec = tool({
    description:
      "Run a shell command (bash, git, python3, node, pnpm, curl) on the assistant's persistent sandboxed Linux Cloud Computer (/workspace). Automatically wakes the VM if sleeping due to inactivity. Destructive or outbound push commands pause for approval.",
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
        const wake = await lifecycle
          .ensureAwakeForTask({ userId })
          .catch(() => null);
        const res = await cloudRunExec({
          command,
          cwd,
          timeoutSec,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        await lifecycle.recordActivity({ userId }).catch(() => null);
        return {
          status: res.exitCode === 0 ? ("ok" as const) : ("failed" as const),
          command,
          cwd: res.cwd,
          exitCode: res.exitCode,
          stdout: res.stdout.slice(0, 8000),
          stderr: res.stderr.slice(0, 4000),
          durationMs: res.durationMs,
          vmWakeMs:
            res.vmWakeMs ??
            (wake?.wokeFromSleep ? wake.wakeDurationMs : undefined),
          wokeFromSleep: wake?.wokeFromSleep ?? false,
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
        const wake = await lifecycle
          .ensureAwakeForTask({ userId })
          .catch(() => null);
        const safePath = resolveSafeWorkspacePath(rawPath);
        const res = await cloudWriteWorkspaceFile({
          path: safePath,
          contentBase64: Buffer.from(content, "utf8").toString("base64"),
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        await lifecycle.recordActivity({ userId }).catch(() => null);
        const safeName = sanitizeAttachmentFilename(res.path);
        const mediaType = inferPrivateFileMediaType(safeName);
        const encodedPath = encodeURIComponent(res.path);
        return {
          status: "ok" as const,
          path: res.path,
          filename: safeName,
          mediaType,
          bytesWritten: res.bytesWritten,
          sizeBytes: res.bytesWritten,
          previewUrl: `/api/cloud-computer/files?path=${encodedPath}&disposition=inline`,
          downloadUrl: `/api/cloud-computer/files?path=${encodedPath}&disposition=attachment`,
          wokeFromSleep: wake?.wokeFromSleep ?? false,
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
      "Read a generated file (HTML, CSV, PDF, PNG, JPEG, Markdown, JSON, or text) from /workspace on the Cloud Computer and attach private preview and download links into the chat.",
    inputSchema: z.object({
      path: z
        .string()
        .trim()
        .min(1)
        .max(240)
        .describe("Path inside /workspace, e.g. '/workspace/ai_news.html'."),
    }),
    execute: async ({ path: rawPath }) => {
      if (containsRestrictedWorkData(rawPath)) {
        return {
          status: "blocked" as const,
          path: rawPath,
          message:
            "Blocked: employer/Korn Ferry material cannot be exported from the personal Cloud Computer.",
        };
      }
      try {
        await lifecycle.ensureAwakeForTask({ userId }).catch(() => null);
        const safePath = resolveSafeWorkspacePath(rawPath);
        const read = await cloudReadWorkspaceFile({
          path: safePath,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        await lifecycle.recordActivity({ userId }).catch(() => null);
        const bytes = new Uint8Array(Buffer.from(read.base64, "base64"));
        const safeName = sanitizeAttachmentFilename(safePath);
        const mediaType = inferPrivateFileMediaType(safeName);
        const isTextLike =
          mediaType.startsWith("text/") ||
          mediaType === "application/json" ||
          mediaType === "image/svg+xml";
        const textPreview = isTextLike
          ? Buffer.from(bytes).toString("utf8").slice(0, 24_000)
          : undefined;
        if (textPreview && containsRestrictedWorkData(textPreview)) {
          return {
            status: "blocked" as const,
            path: read.path,
            message:
              "Blocked: employer/Korn Ferry material cannot be exported to chat.",
          };
        }

        const encodedPath = encodeURIComponent(read.path);
        const vmPreviewUrl = `/api/cloud-computer/files?path=${encodedPath}&disposition=inline`;
        const vmDownloadUrl = `/api/cloud-computer/files?path=${encodedPath}&disposition=attachment`;

        try {
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
          const baseFileUrl = `/api/files/${encodeURIComponent(token)}`;
          return {
            status: "ok" as const,
            path: read.path,
            filename: safeName,
            mediaType,
            sizeBytes: bytes.byteLength,
            downloadUrl: baseFileUrl,
            previewUrl: `${baseFileUrl}?disposition=inline`,
            vmFileUrl: vmPreviewUrl,
            ...(textPreview !== undefined ? { textPreview } : {}),
          };
        } catch {
          return {
            status: "ok" as const,
            path: read.path,
            filename: safeName,
            mediaType,
            sizeBytes: bytes.byteLength,
            downloadUrl: vmDownloadUrl,
            previewUrl: vmPreviewUrl,
            ...(textPreview !== undefined ? { textPreview } : {}),
          };
        }
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
      "Open a public web page in headless Chromium on the Cloud Computer, extract readable page content inside an untrusted-content fence, and optionally attach a PNG screenshot. If the page requires login, 2FA, or human verification (CAPTCHA), automatically returns a Screen Handoff card ('I'm here / Not now') — never asks for passwords in chat.",
    inputSchema: z.object({
      url: z.string().trim().min(4).max(1024),
      captureScreenshot: z.boolean().default(false).optional(),
    }),
    execute: async ({ url, captureScreenshot = false }) => {
      try {
        const wake = await lifecycle
          .ensureAwakeForTask({ userId })
          .catch(() => null);
        const res = await cloudBrowsePublicUrl({
          url,
          captureScreenshot,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        await lifecycle.recordActivity({ userId }).catch(() => null);

        const challenge = detectScreenHandoffChallenge({
          url: res.url,
          title: res.title,
          text: res.fencedText,
        });
        if (challenge) {
          return buildScreenHandoffPayload({
            reason: challenge,
            url: res.url,
          });
        }

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
          wokeFromSleep: wake?.wokeFromSleep ?? false,
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
        const wake = await lifecycle
          .ensureAwakeForTask({ userId })
          .catch(() => null);
        const safePath = resolveSafeWorkspacePath(rawPath);
        const read = await cloudReadWorkspaceFile({
          path: safePath,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        await lifecycle.recordActivity({ userId }).catch(() => null);
        const text = Buffer.from(read.base64, "base64")
          .toString("utf8")
          .slice(0, 16_000);
        return {
          status: "ok" as const,
          path: read.path,
          sizeBytes: read.sizeBytes,
          content: text,
          wokeFromSleep: wake?.wokeFromSleep ?? false,
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

  const requestScreenHandoff = tool({
    description:
      "Show an 'I'm here / Not now' Screen Handoff card when the Cloud Computer needs the owner directly on the screen (for account login, 2FA/OTP verification, or CAPTCHA/human verification). NEVER ask the owner to type passwords, PINs, or 2FA codes in chat.",
    inputSchema: z.object({
      reason: z.enum(["login", "two_factor", "captcha"]),
      serviceName: z.string().trim().min(1).max(120),
      url: z.string().trim().url().max(1024).optional(),
    }),
    execute: ({ reason, serviceName, url }) =>
      Promise.resolve(
        buildScreenHandoffPayload({
          reason,
          serviceName,
          url,
        })
      ),
  });

  return {
    cloudExec,
    cloudWriteFile,
    cloudReadFile,
    cloudExportFileToChat,
    cloudBrowseUrl,
    requestScreenHandoff,
  };
}
