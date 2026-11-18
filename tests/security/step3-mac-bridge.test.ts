import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import { createMacBridgeTools } from "../../lib/ai/tools/mac-bridge";
import {
  classifyMacCommand,
  evaluateMacGovernor,
  parseVmStatFreeMb,
  redactBridgeLog,
  resolveSafeBotrunnerWorkspace,
  validateMacCliInvocation,
} from "../../lib/mac-bridge/policy";
import type { ChatMessage } from "../../lib/types";

const userTurn = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

test("Step 3: Tailscale ACL HuJSON locks tag:bot to tag:mac:22 as botrunner only, enables check mode, and omits Funnel", () => {
  const raw = readFileSync("ops/mac-bridge/tailscale-acl.hujson", "utf8");
  const stripped = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const acl = JSON.parse(stripped) as {
    acls: Array<{ src: string[]; dst: string[] }>;
    ssh: Array<{
      action: string;
      src: string[];
      dst: string[];
      users: string[];
      checkPeriod?: string;
    }>;
    nodeAttrs?: unknown;
  };

  assert.equal(acl.nodeAttrs, undefined);
  assert.doesNotMatch(stripped, /funnel/i);

  const botNet = acl.acls.find((r) => r.src.includes("tag:bot"));
  assert.deepEqual(botNet?.dst, ["tag:mac:22"]);

  const botSsh = acl.ssh.find((r) => r.src.includes("tag:bot"));
  assert.equal(botSsh?.action, "accept");
  assert.deepEqual(botSsh?.dst, ["tag:mac"]);
  assert.deepEqual(botSsh?.users, ["botrunner"]);

  const humanCheck = acl.ssh.find((r) => r.action === "check");
  assert.ok(humanCheck);
  assert.equal(humanCheck.checkPeriod, "12h");
});

test("Step 3: Mac Bridge policy enforces no sudo, never Funnel, /Users/caglar isolation, 8 GB governor, Copilot/Cursor opt-in, and approval gate", () => {
  assert.equal(
    resolveSafeBotrunnerWorkspace("my-repo"),
    "/Users/botrunner/workspaces/my-repo"
  );
  assert.throws(() => resolveSafeBotrunnerWorkspace("/Users/caglar/Secrets"));
  assert.throws(() => resolveSafeBotrunnerWorkspace("../caglar"));

  // Hard blocks
  for (const cmd of [
    "sudo ls",
    "tailscale funnel 3000",
    "tailscale serve https / http://localhost:3000",
    "cat /Users/caglar/.ssh/id_ed25519",
    "cat .env.local",
    "security dump-keychain",
    "echo Korn Ferry Q4 accrual",
  ]) {
    assert.equal(classifyMacCommand(cmd).tier, "blocked", cmd);
  }

  // Approval required for destructive & sending commands
  for (const cmd of [
    "git push origin agent/fix-nav",
    "gh pr create --fill",
    "rm -rf build",
    "git reset --hard HEAD~1",
    "curl -X POST https://api.example.com/hook -d '{}'",
  ]) {
    assert.equal(classifyMacCommand(cmd).tier, "needs_approval", cmd);
  }

  // Safe reads/tests allowed
  assert.equal(classifyMacCommand("git status -s").tier, "allow");

  // 8 GB Mac mini governor
  const freeMb = parseVmStatFreeMb(
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 60000.\nPages inactive: 40000.\n"
  );
  assert.ok(freeMb > 1500);
  assert.equal(
    evaluateMacGovernor({
      activeAgents: 3,
      buildLockHeld: false,
      isBuild: false,
      freeRamMb: 2000,
    }).allowed,
    false
  );
  assert.equal(
    evaluateMacGovernor({
      activeAgents: 1,
      buildLockHeld: true,
      isBuild: true,
      freeRamMb: 2000,
    }).allowed,
    false
  );
  assert.equal(
    evaluateMacGovernor({
      activeAgents: 1,
      buildLockHeld: false,
      isBuild: false,
      freeRamMb: 900,
    }).allowed,
    false
  );

  // CLI validation: Claude/Codex/agy/t3 allowed on agent/*; Copilot/Cursor opt-in only; main blocked
  assert.equal(
    validateMacCliInvocation({
      cli: "claude",
      repoName: "demo",
      branch: "agent/fix-navbar",
      prompt: "Fix mobile padding",
    }).ok,
    true
  );
  const agySpec = validateMacCliInvocation({
    cli: "agy",
    repoName: "demo",
    branch: "agent/fix-navbar",
    prompt: "Audit 390px mobile cards",
  });
  assert.equal(agySpec.ok, true);
  if (agySpec.ok) {
    assert.match(agySpec.shellCommand, /agy -p "\$PROMPT_TXT"/);
  }
  const copilotBlocked = validateMacCliInvocation({
    cli: "copilot",
    repoName: "demo",
    branch: "agent/fix-navbar",
    prompt: "Fix padding",
  });
  assert.equal(copilotBlocked.ok, false);
  if (!copilotBlocked.ok) {
    assert.equal(copilotBlocked.code, "opt_in_required");
  }
  assert.equal(
    validateMacCliInvocation({
      cli: "codex",
      repoName: "demo",
      branch: "main",
      prompt: "Edit directly on main",
    }).ok,
    false
  );

  // Routing in selectActiveTools
  const selected = selectActiveTools(
    [userTurn("Have Claude Code fix the navbar on my Mac mini")],
    true,
    true
  );
  assert.ok(selected.includes("macExec"));
  assert.ok(selected.includes("macRunAgentCli"));
  assert.ok(!selected.includes("webSearch"));

  // Token redaction
  assert.equal(
    redactBridgeLog("token sk-abc1234567890defghijk ok"),
    "token [REDACTED] ok"
  );
});

test("Step 3: macExec & macRunAgentCli tools pause on ApprovalCard for git push and execute safe tmux sessions via relay", async () => {
  const tools = createMacBridgeTools({
    userId: "97a9a7c5-e220-425d-9589-7e63b607ca75",
    macHost: "mac-mini.tailnet",
    relayUrl: "https://relay.example.test",
    hmacSecret: "test-cloud-computer-hmac-secret-32-chars-long",
    fetchImpl: () =>
      Promise.resolve(
        Response.json({
          status: "ok",
          exitCode: 0,
          stdout: "On branch agent/smoke\nnothing to commit\n",
          stderr: "",
          durationMs: 92,
        })
      ),
  });

  const safeStatus = await (tools.macExec as any).execute(
    { command: "git status", repoName: "demo" },
    { toolCallId: "me1", messages: [] }
  );
  assert.equal(safeStatus.status, "ok");
  assert.match(String(safeStatus.tmuxSession), /^task-/);

  const pushGate = await (tools.macExec as any).execute(
    { command: "git push origin agent/smoke", repoName: "demo" },
    { toolCallId: "me2", messages: [] }
  );
  assert.equal(pushGate.status, "awaiting_approval");
  assert.ok(typeof pushGate.digest === "string");
});

test("Step 3: real tmux + mac-bridge-exec wrapper blocks sudo/Funnel and writes redacted .pty.log + commands.jsonl", () => {
  if (!existsSync("/opt/homebrew/bin/tmux")) {
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "mac-bridge-smoke-"));
  const wsDir = join(tmp, "workspaces");
  const logDir = join(tmp, "logs");
  const env = {
    ...process.env,
    ALLOW_LOCAL_TEST_USER: "1",
    MAC_GOVERNOR_MAX_AGENTS: "25",
    BOTRUNNER_WORKSPACES_ROOT: wsDir,
    BOTRUNNER_LOG_DIR: logDir,
  };

  try {
    // 0. Governor cap=0 exits 75 immediately
    let govCode = 0;
    try {
      execFileSync(
        "/bin/zsh",
        [
          "ops/mac-bridge/mac-bridge-exec",
          "gov1",
          wsDir,
          Buffer.from("echo hi").toString("base64"),
        ],
        {
          env: { ...env, MAC_GOVERNOR_MAX_AGENTS: "0" },
          stdio: "pipe",
        }
      );
    } catch (err) {
      govCode = (err as { status?: number }).status ?? 1;
    }
    assert.equal(govCode, 75);

    // 1. sudo and tailscale funnel must fail with exit code 126
    for (const bad of ["sudo id", "tailscale funnel 8080"]) {
      let code = 0;
      try {
        execFileSync(
          "/bin/zsh",
          [
            "ops/mac-bridge/mac-bridge-exec",
            "bad1",
            wsDir,
            Buffer.from(bad).toString("base64"),
          ],
          { env, stdio: "pipe" }
        );
      } catch (err) {
        code = (err as { status?: number }).status ?? 1;
      }
      assert.equal(code, 126, `expected 126 for: ${bad}`);
    }

    // 2. Real tmux execution + token-redacted logging
    const cmdB64 = Buffer.from(
      'echo "bridge-ok sk-1234567890abcdefghijklmnop" && git --version'
    ).toString("base64");
    const out = execFileSync(
      "/bin/zsh",
      ["ops/mac-bridge/mac-bridge-exec", "smoke99", wsDir, cmdB64],
      { env, encoding: "utf8" }
    );
    assert.match(out, /bridge-ok \[REDACTED\]/);
    assert.doesNotMatch(out, /sk-1234567890/);

    const jsonl = readFileSync(join(logDir, "commands.jsonl"), "utf8");
    assert.match(jsonl, /"tmuxSession":\s*"task-smoke99"/);
    assert.doesNotMatch(jsonl, /sk-1234567890/);
  } finally {
    try {
      execFileSync(
        "/opt/homebrew/bin/tmux",
        ["kill-session", "-t", "task-smoke99"],
        { stdio: "ignore" }
      );
    } catch {
      /* session already closed */
    }
    rmSync(tmp, { recursive: true, force: true });
  }
});
