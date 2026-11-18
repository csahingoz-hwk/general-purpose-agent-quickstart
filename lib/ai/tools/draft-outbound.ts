import { tool } from "ai";
import { z } from "zod";
import { type RiskLevel, reviewActionRisk } from "@/lib/safety/action-review";

export type OutboundChannel = "email" | "telegram" | "slack" | "webhook";

export type OutboundDraftResult = {
  kind: "outbound-draft";
  status: "approved_dry_run";
  deliveryMode: "dry_run_no_live_connector";
  channel: OutboundChannel;
  recipient: string;
  subject: string | null;
  body: string;
  digest: string;
  riskLevel: RiskLevel;
  reasons: string[];
  approvedAt: string;
  note: string;
};

export const draftOutboundMessage = ({
  hasUntrustedContext = false,
}: {
  hasUntrustedContext?: boolean;
} = {}) =>
  tool({
    description:
      "Prepare an outbound message draft (email, Telegram, Slack, or webhook) for explicit owner review and approval before any send. Live external connectors are currently disconnected, so approving records a verified dry-run draft receipt without transmitting externally.",
    inputSchema: z.object({
      channel: z.enum(["email", "telegram", "slack", "webhook"]),
      recipient: z.string().trim().min(1).max(320),
      subject: z.string().trim().max(200).optional(),
      body: z.string().trim().min(1).max(4000),
    }),
    needsApproval: true,
    execute: ({ channel, recipient, subject, body }): OutboundDraftResult => {
      const normalizedSubject = subject?.trim() ? subject.trim() : null;
      const review = reviewActionRisk({
        toolName: "draftOutboundMessage",
        input: {
          channel,
          recipient,
          subject: normalizedSubject,
          body,
        },
        hasUntrustedContext,
      });

      return {
        kind: "outbound-draft",
        status: "approved_dry_run",
        deliveryMode: "dry_run_no_live_connector",
        channel,
        recipient,
        subject: normalizedSubject,
        body,
        digest: review.digest,
        riskLevel: review.riskLevel,
        reasons: review.reasons,
        approvedAt: new Date().toISOString(),
        note: "Approved by owner in dry-run mode. Live external connectors are disconnected, so nothing was sent externally.",
      };
    },
    toModelOutput: ({ output }) => ({
      type: "json" as const,
      value: {
        status: output.status,
        deliveryMode: output.deliveryMode,
        channel: output.channel,
        recipient: output.recipient,
        digest: output.digest.slice(0, 12),
      },
    }),
  });
