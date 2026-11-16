import { tool } from "ai";
import { z } from "zod";
import { resolveGoogleAccessTokenFromVault } from "@/lib/connectors/google-vault-auth";
import {
  containsRestrictedWorkData,
  createDrivePrivateDraftDoc,
  createGmailUnsentDraft,
  readDriveFiles,
  readGmailMessages,
} from "@/lib/connectors/google-workspace";
import { reviewActionRisk } from "@/lib/safety/action-review";
import type { SecretVaultStore } from "@/lib/vault/secret-vault";

export type GoogleConnectorToolsOptions = {
  userId: string;
  vaultStore?: SecretVaultStore;
  hasUntrustedContext?: boolean;
  fetchImpl?: typeof fetch;
};

export function createGoogleConnectorTools(opts: GoogleConnectorToolsOptions) {
  const { userId, vaultStore, hasUntrustedContext = false, fetchImpl } = opts;

  const gmailReadMessages = tool({
    description:
      "Read recent Gmail messages using encrypted credentials from the owner's Secret Vault. Read-only; returns message excerpts inside <untrusted_content> fences.",
    inputSchema: z.object({
      query: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe(
          "Optional Gmail search query (e.g. 'is:unread', 'from:alice')."
        ),
      maxResults: z.number().int().min(1).max(10).default(5).optional(),
    }),
    execute: async ({ query, maxResults }) => {
      const auth = await resolveGoogleAccessTokenFromVault({
        userId,
        vaultStore,
        fetchImpl,
      });
      if (!auth.ok) {
        return {
          status: "setup_required" as const,
          code: auth.code,
          message: auth.message,
          messages: [],
        };
      }
      try {
        const messages = await readGmailMessages({
          accessToken: auth.accessToken,
          query,
          maxResults: maxResults ?? 5,
          fetchImpl,
        });
        return {
          status: "ok" as const,
          count: messages.length,
          messages,
        };
      } catch (err) {
        return {
          status: "error" as const,
          message:
            err instanceof Error
              ? err.message
              : "Failed to read Gmail messages.",
          messages: [],
        };
      }
    },
  });

  const driveReadFiles = tool({
    description:
      "Search and read Google Drive file excerpts using encrypted credentials from the owner's Secret Vault. Read-only; returns file excerpts inside <untrusted_content> fences.",
    inputSchema: z.object({
      query: z
        .string()
        .trim()
        .max(120)
        .optional()
        .describe("Optional filename search term in Google Drive."),
      maxResults: z.number().int().min(1).max(10).default(5).optional(),
    }),
    execute: async ({ query, maxResults }) => {
      const auth = await resolveGoogleAccessTokenFromVault({
        userId,
        vaultStore,
        fetchImpl,
      });
      if (!auth.ok) {
        return {
          status: "setup_required" as const,
          code: auth.code,
          message: auth.message,
          files: [],
        };
      }
      try {
        const files = await readDriveFiles({
          accessToken: auth.accessToken,
          query,
          maxResults: maxResults ?? 5,
          fetchImpl,
        });
        return {
          status: "ok" as const,
          count: files.length,
          files,
        };
      } catch (err) {
        return {
          status: "error" as const,
          message:
            err instanceof Error
              ? err.message
              : "Failed to read Google Drive files.",
          files: [],
        };
      }
    },
  });

  const gmailCreateDraft = tool({
    description:
      "Create an UNSENT Gmail draft in the owner's Drafts folder after explicit owner approval. NEVER sends the email; you must review and send manually in Gmail.",
    inputSchema: z.object({
      recipient: z.string().email().max(320),
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(4000),
      threadId: z.string().trim().max(120).optional(),
    }),
    needsApproval: true,
    execute: async ({ recipient, subject, body, threadId }) => {
      const review = reviewActionRisk({
        toolName: "gmailCreateDraft",
        input: { recipient, subject, body, threadId },
        hasUntrustedContext,
      });

      if (containsRestrictedWorkData(`${recipient}\n${subject}\n${body}`)) {
        return {
          status: "blocked_data_boundary" as const,
          deliveryMode: "draft_only_never_send" as const,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message:
            "Blocked: employer/Korn Ferry material cannot be saved to personal Gmail.",
        };
      }

      const auth = await resolveGoogleAccessTokenFromVault({
        userId,
        vaultStore,
        fetchImpl,
      });
      if (!auth.ok) {
        return {
          status: "setup_required" as const,
          code: auth.code,
          deliveryMode: "draft_only_never_send" as const,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message: auth.message,
        };
      }

      try {
        const created = await createGmailUnsentDraft({
          accessToken: auth.accessToken,
          to: recipient,
          subject,
          body,
          threadId,
          fetchImpl,
        });
        return {
          status: "draft_created_unsent" as const,
          deliveryMode: "draft_only_never_send" as const,
          draftId: created.draftId,
          recipient,
          subject,
          digest: review.digest,
          riskLevel: review.riskLevel,
          note: "Saved strictly as an UNSENT Gmail draft. Nothing was sent.",
        };
      } catch (err) {
        return {
          status: "error" as const,
          deliveryMode: "draft_only_never_send" as const,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message:
            err instanceof Error
              ? err.message
              : "Failed to create Gmail draft.",
        };
      }
    },
  });

  const driveCreateDraftDoc = tool({
    description:
      "Create a new private '[DRAFT]' Google Doc in the owner's Google Drive after explicit owner approval. Never overwrites existing files, never shares permissions, and never sends notifications.",
    inputSchema: z.object({
      title: z.string().trim().min(1).max(140),
      content: z.string().trim().min(1).max(12_000),
    }),
    needsApproval: true,
    execute: async ({ title, content }) => {
      const review = reviewActionRisk({
        toolName: "driveCreateDraftDoc",
        input: { title, content },
        hasUntrustedContext,
      });

      if (containsRestrictedWorkData(`${title}\n${content}`)) {
        return {
          status: "blocked_data_boundary" as const,
          mode: "private_draft_only" as const,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message:
            "Blocked: employer/Korn Ferry material cannot be saved to personal Google Drive.",
        };
      }

      const auth = await resolveGoogleAccessTokenFromVault({
        userId,
        vaultStore,
        fetchImpl,
      });
      if (!auth.ok) {
        return {
          status: "setup_required" as const,
          code: auth.code,
          mode: "private_draft_only" as const,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message: auth.message,
        };
      }

      try {
        const created = await createDrivePrivateDraftDoc({
          accessToken: auth.accessToken,
          title,
          content,
          fetchImpl,
        });
        return {
          status: "draft_doc_created" as const,
          mode: "private_draft_only" as const,
          fileId: created.fileId,
          name: created.name,
          digest: review.digest,
          riskLevel: review.riskLevel,
          note: "Created as a private owner-only [DRAFT] document. Not shared or sent.",
        };
      } catch (err) {
        return {
          status: "error" as const,
          mode: "private_draft_only" as const,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message:
            err instanceof Error
              ? err.message
              : "Failed to create Google Drive draft document.",
        };
      }
    },
  });

  return {
    gmailReadMessages,
    driveReadFiles,
    gmailCreateDraft,
    driveCreateDraftDoc,
  };
}
