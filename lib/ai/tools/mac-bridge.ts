import { tool } from "ai";
import { z } from "zod";
import { runMacBridgeExec } from "@/lib/mac-bridge/client";
import {
  classifyMacCommand,
  type SupportedMacCli,
  validateMacCliInvocation,
} from "@/lib/mac-bridge/policy";
import { reviewActionRisk } from "@/lib/safety/action-review";
import { generateUUID } from "@/lib/utils";

export function createMacBridgeTools(opts: {
  userId: string;
  hasUntrustedContext?: boolean;
  macHost?: string;
  relayUrl?: string;
  hmacSecret?: string;
  fetchImpl?: typeof fetch;
}) {
  const {
    hasUntrustedContext = false,
    macHost,
    relayUrl,
    hmacSecret,
    fetchImpl,
  } = opts;

  const macExec = tool({
    description:
      "Run a terminal command on the owner's Mac mini over the private Tailscale SSH bridge as dedicated non-admin user 'botrunner' inside a logged tmux session. No sudo, zero Funnel, and destructive or sending commands pause on an Approval Card.",
    inputSchema: z.object({
      command: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .describe("Command to run inside /Users/botrunner/workspaces."),
      repoName: z
        .string()
        .trim()
        .max(120)
        .default("")
        .optional()
        .describe("Optional repo folder inside /Users/botrunner/workspaces."),
      timeoutSec: z.number().int().min(3).max(90).default(30).optional(),
    }),
    execute: async ({ command, repoName = "", timeoutSec = 30 }) => {
      const decision = classifyMacCommand(command);
      if (decision.tier === "blocked") {
        return {
          status: "blocked" as const,
          command,
          repoName,
          message: decision.reason,
        };
      }

      if (decision.tier === "needs_approval" || hasUntrustedContext) {
        const review = reviewActionRisk({
          toolName: "macExec",
          input: { command, repoName },
          hasUntrustedContext,
        });
        return {
          status: "awaiting_approval" as const,
          command,
          repoName,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message:
            decision.tier === "needs_approval"
              ? decision.reason
              : "Command follows untrusted content and requires your approval before running on the Mac mini.",
        };
      }

      const taskId = generateUUID().slice(0, 8);
      try {
        const res = await runMacBridgeExec({
          taskId,
          command,
          repoName,
          timeoutSec,
          macHost,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        return {
          status: res.status,
          command,
          repoName,
          tmuxSession: res.tmuxSession,
          cwd: res.cwd,
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
          durationMs: res.durationMs,
        };
      } catch (err) {
        return {
          status: "setup_required" as const,
          command,
          repoName,
          tmuxSession: `task-${taskId}`,
          message:
            err instanceof Error
              ? err.message
              : "Mac mini bridge is not reachable right now.",
        };
      }
    },
  });

  const macRunAgentCli = tool({
    description:
      "Drive one of the owner's local Mac mini coding subscriptions (claude, codex, agy, or t3) inside an isolated 'agent/<slug>' git worktree and logged tmux session over Tailscale SSH. Enforces the 8 GB RAM governor and stops for approval before any git push.",
    inputSchema: z.object({
      cli: z
        .enum(["claude", "codex", "agy", "t3", "copilot", "cursor"])
        .describe(
          "Subscription CLI: 'claude' (Claude Code), 'codex' (Codex CLI), 'agy' (Antigravity Ultra 5x), or 't3'. 'copilot' & 'cursor' require explicit owner request."
        ),
      repoName: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe("Repo folder under /Users/botrunner/workspaces."),
      branch: z
        .string()
        .trim()
        .min(3)
        .max(80)
        .describe(
          "Isolated worktree branch, must start with 'agent/' or 'draft/'."
        ),
      prompt: z
        .string()
        .trim()
        .min(3)
        .max(4000)
        .describe(
          "Task prompt passed to the CLI inside the isolated worktree."
        ),
      explicitOptIn: z
        .boolean()
        .default(false)
        .optional()
        .describe(
          "True ONLY when the owner explicitly named Copilot or Cursor."
        ),
    }),
    execute: async ({
      cli,
      repoName,
      branch,
      prompt,
      explicitOptIn = false,
    }) => {
      const validated = validateMacCliInvocation({
        cli: cli as SupportedMacCli,
        repoName,
        branch,
        prompt,
        explicitOptIn,
      });

      if (!validated.ok) {
        return {
          status:
            validated.code === "opt_in_required"
              ? ("opt_in_required" as const)
              : ("blocked" as const),
          cli,
          repoName,
          branch,
          message: validated.reason,
        };
      }

      if (hasUntrustedContext) {
        const review = reviewActionRisk({
          toolName: "macRunAgentCli",
          input: { cli, repoName, branch, prompt },
          hasUntrustedContext: true,
        });
        return {
          status: "awaiting_approval" as const,
          cli,
          repoName,
          branch: validated.branch,
          digest: review.digest,
          riskLevel: review.riskLevel,
          message:
            "CLI run follows untrusted content and requires your approval first.",
        };
      }

      const taskId = generateUUID().slice(0, 8);
      try {
        const res = await runMacBridgeExec({
          taskId,
          command: validated.shellCommand,
          repoName,
          timeoutSec: 90,
          macHost,
          relayUrl,
          hmacSecret,
          fetchImpl,
        });
        return {
          status: res.status,
          cli,
          repoName,
          branch: validated.branch,
          worktreePath: validated.worktreePath,
          tmuxSession: res.tmuxSession,
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
          durationMs: res.durationMs,
          pushNote:
            "Changes stay strictly on the local worktree branch; git push always requires a separate Approval Card.",
        };
      } catch (err) {
        return {
          status: "setup_required" as const,
          cli,
          repoName,
          branch: validated.branch,
          tmuxSession: `task-${taskId}`,
          message:
            err instanceof Error
              ? err.message
              : "Mac mini Tailscale bridge is not paired yet.",
        };
      }
    },
  });

  return {
    macExec,
    macRunAgentCli,
  };
}
