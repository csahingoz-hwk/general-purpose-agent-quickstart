import path from "node:path";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { validateCoderBranchSpec } from "@/lib/subagents/worktree-coder";

export const BOTRUNNER_HOME = "/Users/botrunner";
export const BOTRUNNER_WORKSPACES = "/Users/botrunner/workspaces";
export const MAX_CONCURRENT_MAC_AGENTS = 3;
export const MAX_CONCURRENT_MAC_BUILDS = 1;
export const MIN_FREE_RAM_MB = 1200;

export type SupportedMacCli =
  | "claude"
  | "codex"
  | "agy"
  | "t3"
  | "copilot"
  | "cursor";

export type MacCommandPolicyDecision =
  | { tier: "allow" }
  | { tier: "needs_approval"; reason: string }
  | { tier: "blocked"; reason: string };

const HARD_BLOCKED_MAC_CMD =
  /(?:\bsudo\b|\bsu\b(?:\s|$)|\bdscl\b|\bsysadminctl\b|\bsecurity\s+(?:dump-keychain|find-generic-password|find-internet-password|unlock-keychain)\b|\btailscale\s+(?:funnel|serve|up|down|logout|set)\b|\/Users\/caglar\b|~\/\.ssh\b|\/\.ssh\/|(?:^|[\s/])\.env(?:\.|\b)|\bosascript\b|\blaunchctl\s+(?:bootstrap|bootout|load|unload|system)\b|rm\s+-[rf]{1,2}\s+(?:~|\/Users\/botrunner\/?(?:\s|$)|\/(?:\s|$)))/i;

const DESTRUCTIVE_OR_SENDING_MAC_CMD =
  /\b(?:git\s+push|git\s+reset\s+--hard|git\s+clean\b|git\s+branch\s+-D|gh\s+(?:pr|issue|release)\s+(?:create|merge|comment|close|edit)|rm\b|mv\b|brew\s+(?:install|uninstall|upgrade)|npm\s+(?:publish|install\s+-g)|pnpm\s+(?:publish|add\s+-g)|curl\b[^\n]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data|-d\s|-F\s|--upload-file)|scp\b|rsync\b|sendmail\b|mail\s+-s)\b/i;

const BUILD_HEAVY_CMD =
  /\b(?:pnpm\s+build|next\s+build|tsc\b|cargo\s+build|xcodebuild|playwright\s+test|vitest|pnpm\s+test)\b/i;

export function isBuildCommand(command: string): boolean {
  return BUILD_HEAVY_CMD.test(command);
}

export function resolveSafeBotrunnerWorkspace(repoName = ""): string {
  const raw = repoName.trim();
  if (!raw) {
    return BOTRUNNER_WORKSPACES;
  }
  if (raw.includes("\0") || raw.includes("..")) {
    throw new Error("Invalid Mac workspace name");
  }
  if (
    raw.startsWith("/") &&
    raw !== BOTRUNNER_WORKSPACES &&
    !raw.startsWith(`${BOTRUNNER_WORKSPACES}/`)
  ) {
    throw new Error(
      "Path escapes /Users/botrunner/workspaces; personal macOS home directories are isolated."
    );
  }
  const resolved = raw.startsWith(BOTRUNNER_WORKSPACES)
    ? path.posix.normalize(raw)
    : path.posix.normalize(path.posix.join(BOTRUNNER_WORKSPACES, raw));

  if (
    resolved !== BOTRUNNER_WORKSPACES &&
    !resolved.startsWith(`${BOTRUNNER_WORKSPACES}/`)
  ) {
    throw new Error(
      "Path escapes /Users/botrunner/workspaces; personal macOS home directories are isolated."
    );
  }
  return resolved;
}

export function classifyMacCommand(command: string): MacCommandPolicyDecision {
  const trimmed = command.trim();
  if (!trimmed) {
    return { tier: "blocked", reason: "Command cannot be empty." };
  }
  if (containsRestrictedWorkData(trimmed)) {
    return {
      tier: "blocked",
      reason:
        "Blocked: employer/Korn Ferry material cannot be dispatched over the cloud-initiated Mac bridge.",
    };
  }
  if (HARD_BLOCKED_MAC_CMD.test(trimmed)) {
    return {
      tier: "blocked",
      reason:
        "Blocked by Mac Bridge security policy (no sudo, never Tailscale Funnel/serve, and zero access to personal home/SSH/env secrets).",
    };
  }
  if (/\b(?:gh\s+copilot|copilot\b|cursor\b)/i.test(trimmed)) {
    return {
      tier: "blocked",
      reason:
        "GitHub Copilot Pro and Cursor are opt-in only to protect credits; use macRunAgentCli with explicitOptIn when explicitly requested.",
    };
  }
  if (DESTRUCTIVE_OR_SENDING_MAC_CMD.test(trimmed)) {
    return {
      tier: "needs_approval",
      reason:
        "Destructive or outbound sending commands on the Mac mini require your approval first.",
    };
  }
  return { tier: "allow" };
}

/** Parses macOS `vm_stat` output into reclaimable + free RAM in MB. */
export function parseVmStatFreeMb(vmStatOutput: string): number {
  const pageMatch = vmStatOutput.match(/page size of (\d+) bytes/i);
  const pageSize = pageMatch
    ? Number.parseInt(pageMatch[1] ?? "16384", 10)
    : 16_384;
  const readPages = (label: RegExp): number => {
    const m = vmStatOutput.match(label);
    return m ? Number.parseInt((m[1] ?? "0").replace(/\D/g, ""), 10) : 0;
  };
  const freePages =
    readPages(/Pages free:\s+(\d+)/i) +
    readPages(/Pages speculative:\s+(\d+)/i) +
    readPages(/Pages inactive:\s+(\d+)/i) +
    readPages(/Pages purgeable:\s+(\d+)/i);
  return Math.round((freePages * pageSize) / (1024 * 1024));
}

export function evaluateMacGovernor(opts: {
  activeAgents: number;
  buildLockHeld: boolean;
  isBuild: boolean;
  freeRamMb: number;
}): { allowed: true } | { allowed: false; reason: string } {
  if (opts.activeAgents >= MAX_CONCURRENT_MAC_AGENTS) {
    return {
      allowed: false,
      reason: `8 GB Mac mini governor: ${opts.activeAgents}/${MAX_CONCURRENT_MAC_AGENTS} CLI agents are already running.`,
    };
  }
  if (opts.isBuild && opts.buildLockHeld) {
    return {
      allowed: false,
      reason:
        "8 GB Mac mini governor: another build/test holds /tmp/assistant-build.lock (strictly 1 build at a time).",
    };
  }
  if (opts.freeRamMb < MIN_FREE_RAM_MB) {
    return {
      allowed: false,
      reason: `8 GB Mac mini governor: free/reclaimable RAM (${opts.freeRamMb} MB) is below the ${MIN_FREE_RAM_MB} MB safety floor. Offload to Cloud Computer instead.`,
    };
  }
  return { allowed: true };
}

export function validateMacCliInvocation(opts: {
  cli: SupportedMacCli;
  repoName: string;
  branch: string;
  prompt: string;
  explicitOptIn?: boolean;
}):
  | {
      ok: true;
      workspacePath: string;
      worktreePath: string;
      branch: string;
      shellCommand: string;
    }
  | { ok: false; code: "opt_in_required" | "blocked"; reason: string } {
  if (containsRestrictedWorkData(`${opts.repoName}\n${opts.prompt}`)) {
    return {
      ok: false,
      code: "blocked",
      reason:
        "Blocked: employer/Korn Ferry material cannot run through personal CLI subscriptions or the cloud-initiated bridge.",
    };
  }

  if (
    (opts.cli === "copilot" || opts.cli === "cursor") &&
    opts.explicitOptIn !== true
  ) {
    return {
      ok: false,
      code: "opt_in_required",
      reason: `${opts.cli === "copilot" ? "GitHub Copilot Pro" : "Cursor"} is locked to explicit owner request only (high credit burn).`,
    };
  }

  const branchCheck = validateCoderBranchSpec(opts.branch);
  if (!branchCheck.valid) {
    return { ok: false, code: "blocked", reason: branchCheck.reason };
  }

  let repoDir: string;
  try {
    repoDir = resolveSafeBotrunnerWorkspace(opts.repoName);
  } catch (err) {
    return {
      ok: false,
      code: "blocked",
      reason: err instanceof Error ? err.message : "Invalid repo path",
    };
  }

  const worktreePath = `${repoDir}/.worktrees/${branchCheck.worktreeDirName}`;
  const b64Prompt = Buffer.from(opts.prompt.trim(), "utf8").toString("base64");

  const cliCmdMap: Record<SupportedMacCli, string> = {
    claude: 'claude -p "$PROMPT_TXT" --output-format text --max-turns 6',
    codex: 'codex exec --sandbox workspace-write "$PROMPT_TXT"',
    agy: 'agy run --prompt "$PROMPT_TXT"',
    t3: 't3 run --prompt "$PROMPT_TXT"',
    copilot: 'gh copilot suggest -t shell "$PROMPT_TXT"',
    cursor: "cursor --status",
  };

  const shellCommand = [
    `mkdir -p "${repoDir}/.worktrees"`,
    `if [ -d "${repoDir}/.git" ] && [ ! -d "${worktreePath}" ]; then git -C "${repoDir}" worktree add -B "${branchCheck.branch}" "${worktreePath}" HEAD; fi`,
    `cd "${worktreePath}" 2>/dev/null || cd "${repoDir}"`,
    `PROMPT_TXT="$(printf '%s' '${b64Prompt}' | base64 -d)"`,
    cliCmdMap[opts.cli],
  ].join(" && ");

  return {
    ok: true,
    workspacePath: repoDir,
    worktreePath,
    branch: branchCheck.branch,
    shellCommand,
  };
}

const SECRET_TOKEN_REGEX =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{16,}|tskey-[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|vcst_[a-zA-Z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g;

export function redactBridgeLog(raw: string): string {
  return raw.replace(SECRET_TOKEN_REGEX, "[REDACTED]");
}

export type BridgeAuditEntry = {
  timestamp: string;
  taskId: string;
  tmuxSession: string;
  user: "botrunner";
  cwd: string;
  command: string;
  exitCode: number;
  durationMs: number;
  approvalDigest?: string;
  outputPreview: string;
};

export function formatBridgeAuditEntry(entry: BridgeAuditEntry): string {
  return JSON.stringify({
    ...entry,
    command: redactBridgeLog(entry.command).slice(0, 500),
    outputPreview: redactBridgeLog(entry.outputPreview).slice(0, 600),
  });
}
