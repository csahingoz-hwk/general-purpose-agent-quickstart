import {
  callCloudRelay,
  isCloudComputerConfigured,
} from "@/lib/cloud-computer/client";
import { redactBridgeLog, resolveSafeBotrunnerWorkspace } from "./policy";

export type MacBridgeExecResult = {
  status: "ok" | "error";
  taskId: string;
  tmuxSession: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export function resolveMacTailscaleHost(explicit?: string): string {
  return (explicit ?? process.env.MAC_TAILSCALE_HOST ?? "").trim();
}

export function isMacBridgeConfigured(): boolean {
  return Boolean(resolveMacTailscaleHost() && isCloudComputerConfigured());
}

/**
 * Dispatches a vetted command from Cloud Computer (`tag:bot`) over Tailscale SSH
 * to `botrunner@<MAC_TAILSCALE_HOST>`, executing inside `tmux` (`task-<taskId>`)
 * with `tmux pipe-pane` session logging via `/Users/botrunner/bin/mac-bridge-exec`.
 */
export async function runMacBridgeExec(opts: {
  taskId: string;
  command: string;
  repoName?: string;
  timeoutSec?: number;
  macHost?: string;
  relayUrl?: string;
  hmacSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<MacBridgeExecResult> {
  const macHost = resolveMacTailscaleHost(opts.macHost);
  if (!macHost) {
    throw new Error(
      "Mac mini Tailscale bridge isn't paired yet. Run ops/mac-bridge/setup-mac-bridge.sh once to connect standalone Tailscale (botrunner)."
    );
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(macHost)) {
    throw new Error("Invalid MAC_TAILSCALE_HOST format");
  }

  const safeTaskId =
    opts.taskId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "mac";
  const safeCwd = resolveSafeBotrunnerWorkspace(opts.repoName ?? "");

  const raw = await callCloudRelay<{
    status: "ok" | "error";
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }>({
    pathname: "/mac-exec",
    payload: {
      macHost,
      taskId: safeTaskId,
      cwd: safeCwd,
      command: opts.command,
      timeoutSec: Math.max(3, Math.min(120, opts.timeoutSec ?? 45)),
    },
    timeoutMs: 95_000,
    relayUrl: opts.relayUrl,
    hmacSecret: opts.hmacSecret,
    fetchImpl: opts.fetchImpl,
  });

  return {
    status: raw.exitCode === 0 ? "ok" : "error",
    taskId: safeTaskId,
    tmuxSession: `task-${safeTaskId}`,
    cwd: safeCwd,
    exitCode: raw.exitCode,
    stdout: redactBridgeLog(raw.stdout ?? "").slice(0, 8000),
    stderr: redactBridgeLog(raw.stderr ?? "").slice(0, 4000),
    durationMs: raw.durationMs,
  };
}
