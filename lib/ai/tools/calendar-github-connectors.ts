import { tool } from "ai";
import { z } from "zod";
import {
  createGithubPendingDraftReview,
  createGoogleCalendarDraftEvent,
  readGithubPullRequests,
  readGoogleCalendarEvents,
} from "@/lib/connectors/calendar-and-github";
import { reviewActionRisk } from "@/lib/safety/action-review";
import type { SecretVaultStore } from "@/lib/vault/secret-vault";

export function createCalendarAndGithubTools(opts: {
  userId: string;
  vaultStore?: SecretVaultStore;
  hasUntrustedContext?: boolean;
  fetchImpl?: typeof fetch;
}) {
  const { userId, vaultStore, hasUntrustedContext = false, fetchImpl } = opts;

  const calendarReadEvents = tool({
    description:
      "Read upcoming Google Calendar events using encrypted credentials from Secret Vault. Read-only; returns events inside <untrusted_content> fences.",
    inputSchema: z.object({
      maxResults: z.number().int().min(1).max(15).default(8).optional(),
    }),
    execute: ({ maxResults }) =>
      readGoogleCalendarEvents({
        userId,
        maxResults,
        vaultStore,
        fetchImpl,
      }),
  });

  const calendarCreateDraftEvent = tool({
    description:
      "Create a private tentative '[DRAFT]' event on the owner's primary Google Calendar after explicit owner approval. Never emails or invites attendees (sendUpdates=none).",
    inputSchema: z.object({
      title: z.string().trim().min(1).max(140),
      startIso: z.string().datetime({ offset: true }),
      endIso: z.string().datetime({ offset: true }),
      description: z.string().trim().max(2000).optional(),
    }),
    needsApproval: true,
    execute: async ({ title, startIso, endIso, description }) => {
      const review = reviewActionRisk({
        toolName: "calendarCreateDraftEvent",
        input: { title, startIso, endIso, description },
        hasUntrustedContext,
      });
      const result = await createGoogleCalendarDraftEvent({
        userId,
        title,
        startIso,
        endIso,
        description,
        vaultStore,
        fetchImpl,
      });
      return {
        ...result,
        digest: review.digest,
        riskLevel: review.riskLevel,
        deliveryMode: "private_tentative_draft_no_invites" as const,
      };
    },
  });

  const githubReadPullRequests = tool({
    description:
      "Read open GitHub pull requests for a repository using encrypted GITHUB_CONNECTOR_PAT from Secret Vault. Read-only; returns PR descriptions inside <untrusted_content> fences.",
    inputSchema: z.object({
      owner: z.string().trim().min(1).max(80),
      repo: z.string().trim().min(1).max(100),
      maxResults: z.number().int().min(1).max(10).default(5).optional(),
    }),
    execute: ({ owner, repo, maxResults }) =>
      readGithubPullRequests({
        userId,
        owner,
        repo,
        maxResults,
        vaultStore,
        fetchImpl,
      }),
  });

  const githubCreateDraftReview = tool({
    description:
      "Save an UNPUBLISHED PENDING pull-request review draft on GitHub after explicit owner approval. Never submits a public comment and never merges.",
    inputSchema: z.object({
      owner: z.string().trim().min(1).max(80),
      repo: z.string().trim().min(1).max(100),
      pullNumber: z.number().int().positive(),
      body: z.string().trim().min(1).max(4000),
    }),
    needsApproval: true,
    execute: async ({ owner, repo, pullNumber, body }) => {
      const review = reviewActionRisk({
        toolName: "githubCreateDraftReview",
        input: { owner, repo, pullNumber, body },
        hasUntrustedContext,
      });
      const result = await createGithubPendingDraftReview({
        userId,
        owner,
        repo,
        pullNumber,
        body,
        vaultStore,
        fetchImpl,
      });
      return {
        ...result,
        digest: review.digest,
        riskLevel: review.riskLevel,
        deliveryMode: "unpublished_pending_review_only" as const,
      };
    },
  });

  return {
    calendarReadEvents,
    calendarCreateDraftEvent,
    githubReadPullRequests,
    githubCreateDraftReview,
  };
}
