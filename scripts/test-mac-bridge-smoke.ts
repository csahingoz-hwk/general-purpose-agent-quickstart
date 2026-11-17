import assert from "node:assert/strict";
import { execFileSync, execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { createMacBridgeTools } from "../lib/ai/tools/mac-bridge";
import { cloudRunExec } from "../lib/cloud-computer/client";
import { validateMacCliInvocation } from "../lib/mac-bridge/policy";

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RELAY_URL =
  process.env.CLOUD_COMPUTER_RELAY_URL ||
  "https://assistant-computer-relay-439781161791.europe-west1.run.app";

function resolveHmacSecret(): string {
  if (process.env.CLOUD_COMPUTER_HMAC_SECRET?.trim()) {
    return process.env.CLOUD_COMPUTER_HMAC_SECRET.trim();
  }
  return execSync(
    "gcloud secrets versions access latest --secret=cloud-computer-hmac-secret --project=project-cd0bc64c-0025-446c-b41"
  )
    .toString()
    .trim();
}

async function waitForServer(url: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/login`, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) {
        return;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test("Step 3 End-to-End Smoke: Cloud VM tailscale/ssh binary check, Tailscale ACL audit, local tmux agent/bridge-smoke worktree + logs, and 390x844 MacBridgeCard E2E", async () => {
  // 1. Verify live Cloud VM (assistant-computer-01) has tailscale + ssh installed for tag:bot
  const hmacSecret = resolveHmacSecret();
  const vmCheck = await cloudRunExec({
    command: "tailscale --version | head -n 1 && ssh -V 2>&1",
    cwd: "/workspace",
    relayUrl: RELAY_URL,
    hmacSecret,
  });
  assert.equal(
    vmCheck.exitCode,
    0,
    `VM tailscale check failed: ${vmCheck.stderr}`
  );
  assert.match(vmCheck.stdout, /\d+\.\d+\.\d+/);
  assert.match(`${vmCheck.stdout}\n${vmCheck.stderr}`, /OpenSSH/i);

  // 2. Verify setup-mac-bridge.sh --dry-run & Tailscale ACL invariants (no caglar/root, port 22 only, zero Funnel)
  const dryRunOut = execFileSync(
    "/bin/zsh",
    ["ops/mac-bridge/setup-mac-bridge.sh", "--dry-run"],
    { encoding: "utf8" }
  );
  assert.match(
    dryRunOut,
    /Validated mac-bridge-exec and tailscale-acl\.hujson/
  );

  const rawAcl = readFileSync("ops/mac-bridge/tailscale-acl.hujson", "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  const acl = JSON.parse(rawAcl) as {
    acls: Array<{ src: string[]; dst: string[] }>;
    ssh: Array<{
      action: string;
      src: string[];
      dst: string[];
      users: string[];
    }>;
    nodeAttrs?: unknown;
  };
  assert.equal(acl.nodeAttrs, undefined);
  const botNet = acl.acls.find((r) => r.src.includes("tag:bot"));
  assert.deepEqual(botNet?.dst, ["tag:mac:22"]);
  const botSsh = acl.ssh.find((r) => r.src.includes("tag:bot"));
  assert.deepEqual(botSsh?.users, ["botrunner"]);
  assert.ok(!botSsh?.users.includes("caglar"));
  assert.ok(!botSsh?.users.includes("root"));

  // 3. Real tmux + isolated `agent/bridge-smoke` git worktree + .pty.log & commands.jsonl
  const tmp = mkdtempSync(join(tmpdir(), "step3-smoke-"));
  const wsDir = join(tmp, "workspaces");
  const repoDir = join(wsDir, "demo-repo");
  const logDir = join(tmp, "logs");
  mkdirSync(repoDir, { recursive: true });
  execSync(
    'git init -q && git config user.email "bot@example.test" && git config user.name "Bot" && echo "hello" > README.md && git add README.md && git commit -qm "init"',
    { cwd: repoDir }
  );

  const env = {
    ...process.env,
    ALLOW_LOCAL_TEST_USER: "1",
    MAC_GOVERNOR_MAX_AGENTS: "25",
    BOTRUNNER_WORKSPACES_ROOT: wsDir,
    BOTRUNNER_LOG_DIR: logDir,
  };

  try {
    const worktreeCmd = [
      'mkdir -p ".worktrees"',
      'git worktree add -B "agent/bridge-smoke" ".worktrees/agent__bridge-smoke" HEAD',
      'cd ".worktrees/agent__bridge-smoke"',
      "git status --short --branch",
    ].join(" && ");

    const tmuxOut = execFileSync(
      "/bin/zsh",
      [
        "ops/mac-bridge/mac-bridge-exec",
        "bridgesmoke1",
        repoDir,
        Buffer.from(worktreeCmd).toString("base64"),
      ],
      { env, encoding: "utf8" }
    );
    assert.match(tmuxOut, /agent\/bridge-smoke/);

    const ptyFiles = readdirSync(logDir).filter((f) => f.endsWith(".pty.log"));
    assert.ok(ptyFiles.length >= 1, "Expected tmux pipe-pane .pty.log file");
    const jsonl = readFileSync(join(logDir, "commands.jsonl"), "utf8");
    assert.match(jsonl, /"tmuxSession":\s*"task-bridgesmoke1"/);

    // Verify git push halts on ApprovalCard
    const tools = createMacBridgeTools({
      userId: "97a9a7c5-e220-425d-9589-7e63b607ca75",
      macHost: "mac-mini.tailnet",
    });
    const pushPaused = await (tools.macExec as any).execute(
      { command: "git push origin agent/bridge-smoke", repoName: "demo-repo" },
      { toolCallId: "mp-1", messages: [] }
    );
    assert.equal(pushPaused.status, "awaiting_approval");
    assert.ok(
      typeof pushPaused.digest === "string" && pushPaused.digest.length === 64
    );
    assert.equal(
      validateMacCliInvocation({
        cli: "agy",
        repoName: "demo-repo",
        branch: "agent/bridge-smoke",
        prompt: "Check layout",
      }).ok,
      true
    );
  } finally {
    try {
      execFileSync(
        "/opt/homebrew/bin/tmux",
        ["kill-session", "-t", "task-bridgesmoke1"],
        { stdio: "ignore" }
      );
    } catch {
      /* closed */
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // 4. 390x844 iPhone Playwright verification of MacBridgeCard (ok + awaiting_approval + setup_required)
  const scratchDir =
    process.env.VERIFY_SCREENSHOT_DIR ||
    join(process.cwd(), ".next/verify-screenshots");
  mkdirSync(scratchDir, { recursive: true });
  const port = 3121;
  const origin = `http://127.0.0.1:${port}`;
  const owner = "owner@example.test";
  const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
  const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync(MAC_CHROME) ? MAC_CHROME : undefined);

  const browser = await chromium.launch({ headless: true, executablePath });
  const server = spawn(
    "npx",
    ["next", "dev", "--turbo", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        AUTH_SECRET: secret,
        APP_OWNER_EMAIL: owner,
        PLAYWRIGHT: "True",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    }
  );
  server.unref();

  try {
    await waitForServer(origin);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      reducedMotion: "reduce",
    });
    const token = await encode({
      secret,
      salt: "authjs.session-token",
      token: { id: userId, email: owner, type: "regular" },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: origin },
    ]);

    const page = await context.newPage();
    const macTaskId = "80000000-0000-4000-8000-000000000001";

    await page.route("**/a-4-a/c.js*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.V_C = window.V_C || []; window.V_C.push({b:1,d:0});",
      })
    );
    await page.route("**/api/models*", (route) =>
      route.fulfill({
        json: {
          status: "ready",
          defaultModelId: "gemini-4-hydrogen",
          models: [
            {
              id: "gemini-4-hydrogen",
              name: "Gemini 4 Hydrogen",
              provider: "google",
              description: "Default · Vertex AI on Ultra credit",
            },
          ],
        },
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/vote*", (route) => route.fulfill({ json: [] }));
    await page.route(`**/api/tasks/${macTaskId}`, (route) =>
      route.fulfill({
        status: 200,
        json: { task: { id: macTaskId, status: "succeeded" } },
      })
    );

    await page.route("**/api/chat", (route) => {
      const sse = [
        `data: ${JSON.stringify({ type: "start", messageId: "a-step3-1" })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-input-available",
          toolCallId: "mc-1",
          toolName: "macRunAgentCli",
          input: {
            cli: "agy",
            repoName: "demo-repo",
            branch: "agent/bridge-smoke",
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-output-available",
          toolCallId: "mc-1",
          output: {
            status: "ok",
            cli: "agy",
            repoName: "demo-repo",
            branch: "agent/bridge-smoke",
            tmuxSession: "task-bridgesmoke1",
            exitCode: 0,
            stdout: "## agent/bridge-smoke\nAll 390px cards verified clean.",
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-input-available",
          toolCallId: "mc-2",
          toolName: "macExec",
          input: { command: "git push origin agent/bridge-smoke" },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-output-available",
          toolCallId: "mc-2",
          output: {
            status: "awaiting_approval",
            command: "git push origin agent/bridge-smoke",
            repoName: "demo-repo",
            digest: "77f201aa99bc1100",
            taskId: macTaskId,
            message:
              "Destructive or outbound sending commands on the Mac mini require your approval first.",
          },
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text-start", id: "txt-s3" })}\n\n`,
        `data: ${JSON.stringify({
          type: "text-delta",
          id: "txt-s3",
          delta:
            "Ran `agy` inside `tmux` (`task-bridgesmoke1`) on branch `agent/bridge-smoke`, and paused `git push` awaiting your approval.",
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text-end", id: "txt-s3" })}\n\n`,
        `data: ${JSON.stringify({ type: "finish" })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");

      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: sse,
      });
    });

    await page.goto(
      `${origin}/?query=${encodeURIComponent("Run agy on agent/bridge-smoke on my Mac mini and push")}`,
      { waitUntil: "domcontentloaded" }
    );

    const cards = page.getByTestId("mac-bridge-card");
    await expect(cards).toHaveCount(2, { timeout: 15_000 });
    await expect(cards.nth(0).getByTestId("mac-bridge-status")).toContainText(
      "Done"
    );
    await expect(cards.nth(1).getByTestId("mac-bridge-status")).toContainText(
      "Needs approval"
    );

    const approveBtn = cards.nth(1).getByTestId("mac-bridge-approve");
    const box = await approveBtn.boundingBox();
    assert.ok(
      (box?.height ?? 0) >= 44,
      `MacBridgeCard approve touch target must be >=44px: ${box?.height}`
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(overflow <= 390, `390px horizontal overflow: ${overflow}`);

    const step3Shot = join(scratchDir, "verify-step3-mac-bridge-390.png");
    await page.screenshot({ path: step3Shot, fullPage: false });

    await approveBtn.click();
    await expect(cards.nth(1).getByTestId("mac-bridge-status")).toContainText(
      "Done",
      { timeout: 10_000 }
    );

    console.log(
      `PASS: Step 3 Mac Bridge smoke + 390x844 E2E succeeded (${step3Shot})`
    );
  } finally {
    await browser.close().catch(() => undefined);
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        server.kill("SIGKILL");
      }
    }
  }
});
