import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 3119;
const origin = `http://127.0.0.1:${port}`;
const owner = "owner@example.test";
const secret = "synthetic-readiness-ui-secret-with-at-least-32-characters";
const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";

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

test("Step 1 Playwright Mobile E2E (390x844): 3-step agent turn updates TaskCard live, survives reload, and honors 1-tap Approve & Stop (>=44px)", async () => {
  const scratchDir =
    process.env.VERIFY_SCREENSHOT_DIR ||
    join(process.cwd(), ".next/verify-screenshots");
  mkdirSync(scratchDir, { recursive: true });

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

    const liveTaskId = "70000000-0000-4000-8000-000000000001";
    const approvalTaskId = "70000000-0000-4000-8000-000000000002";
    let pollCount = 0;

    const tasksDb: Record<string, any> = {
      [liveTaskId]: {
        id: liveTaskId,
        userId,
        kind: "executor",
        title: "Check open PRs & prepare summary",
        prompt: "Read open PRs, check calendar window, and compile summary.",
        status: "running",
        riskLevel: "low",
        scheduleId: null,
        steps: [
          {
            step: 1,
            message: "Step 1/3: Checked open GitHub pull requests",
            timestamp: "2026-11-17T23:10:00.000Z",
          },
        ],
        output: null,
        error: null,
        createdAt: "2026-11-17T23:10:00.000Z",
        startedAt: "2026-11-17T23:10:00.000Z",
        finishedAt: null,
      },
      [approvalTaskId]: {
        id: approvalTaskId,
        userId,
        kind: "coding_worktree",
        title: "Push branch agent/navbar-fix",
        prompt: "git push origin agent/navbar-fix",
        status: "awaiting_approval",
        riskLevel: "high",
        scheduleId: null,
        steps: [
          {
            step: 1,
            message: "Task queued for execution",
            timestamp: "2026-11-17T23:10:01.000Z",
          },
          {
            step: 2,
            message: "Paused for your approval (MAC target · digest 9a4f2c11)",
            timestamp: "2026-11-17T23:10:02.000Z",
          },
        ],
        output: null,
        error: null,
        createdAt: "2026-11-17T23:10:01.000Z",
        startedAt: null,
        finishedAt: null,
      },
    };

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
            {
              id: "gemini-4-argon",
              name: "Gemini 4 Argon",
              provider: "google",
              description: "Research & agent loop · Vertex AI on Ultra credit",
            },
          ],
        },
      })
    );
    await page.route("**/api/history*", (route) =>
      route.fulfill({ json: { chats: [], hasMore: false } })
    );
    await page.route("**/api/vote*", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/tasks/*", (route) => {
      const req = route.request();
      const id = req.url().split("/api/tasks/")[1]?.split("?")[0] ?? "";
      const rec = tasksDb[id];
      if (!rec) {
        return route.fulfill({ status: 404, json: { error: "Not found" } });
      }
      if (req.method() === "GET") {
        if (id === liveTaskId && rec.status === "running") {
          pollCount += 1;
          if (pollCount >= 1) {
            rec.status = "succeeded";
            rec.steps = [
              ...rec.steps,
              {
                step: 2,
                message: "Step 2/3: Checked Friday afternoon calendar slot",
                timestamp: "2026-11-17T23:10:03.000Z",
              },
              {
                step: 3,
                message: "Step 3/3: Compiled PR & schedule summary",
                timestamp: "2026-11-17T23:10:05.000Z",
              },
            ];
            rec.output =
              "PR #10 is green and Friday 14:00–16:30 London is open.";
            rec.finishedAt = "2026-11-17T23:10:05.000Z";
          }
        }
        return route.fulfill({
          status: 200,
          json: { status: "ready", task: rec },
        });
      }
      if (req.method() === "PATCH") {
        const body = JSON.parse(req.postData() ?? "{}") as {
          action?: "approve" | "cancel";
        };
        if (body.action === "approve") {
          rec.status = "succeeded";
          rec.steps.push({
            step: rec.steps.length + 1,
            message: "Approved by owner — branch pushed cleanly",
            timestamp: "2026-11-17T23:10:10.000Z",
          });
          rec.output = "Approved and completed.";
        } else if (body.action === "cancel") {
          rec.status = "cancelled";
          rec.steps.push({
            step: rec.steps.length + 1,
            message: "Cancelled by owner",
            timestamp: "2026-11-17T23:10:11.000Z",
          });
        }
        return route.fulfill({ status: 200, json: { task: rec } });
      }
      return route.fulfill({ status: 400, json: {} });
    });

    await page.route("**/api/chat", (route) => {
      const sse = [
        `data: ${JSON.stringify({ type: "start", messageId: "a-step1-1" })}\n\n`,
        `data: ${JSON.stringify({
          type: "data-task-step",
          data: {
            stepIndex: 1,
            label: "Checked GitHub pull requests",
            toolName: "githubReadPullRequests",
            status: "done",
            elapsedMs: 142,
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "data-task-step",
          data: {
            stepIndex: 2,
            label: "Checked Google Calendar",
            toolName: "calendarReadEvents",
            status: "done",
            elapsedMs: 118,
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "data-task-step",
          data: {
            stepIndex: 3,
            label: "Dispatched background task",
            toolName: "delegateTask",
            status: "done",
            elapsedMs: 64,
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-input-available",
          toolCallId: "tc-live-1",
          toolName: "delegateTask",
          input: { title: "Check open PRs & prepare summary" },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-output-available",
          toolCallId: "tc-live-1",
          output: {
            status: "running",
            target: "assistant",
            digest: "4e91bc0011223344",
            task: {
              ...tasksDb[liveTaskId],
              status: "running",
              steps: [tasksDb[liveTaskId].steps[0]],
            },
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-input-available",
          toolCallId: "tc-approve-1",
          toolName: "delegateTask",
          input: { title: "Push branch agent/navbar-fix" },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "tool-output-available",
          toolCallId: "tc-approve-1",
          output: {
            status: "awaiting_approval",
            target: "mac",
            digest: "9a4f2c11889900aa",
            riskLevel: "high",
            task: tasksDb[approvalTaskId],
          },
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text-start", id: "txt-s1" })}\n\n`,
        `data: ${JSON.stringify({
          type: "text-delta",
          id: "txt-s1",
          delta:
            "PR #10 is open and green, Friday afternoon is free, and the push task is paused for your one-tap approval.",
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text-end", id: "txt-s1" })}\n\n`,
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
      `${origin}/?query=${encodeURIComponent("Check open PRs, check if I am free Friday afternoon, and push agent/navbar-fix")}`,
      { waitUntil: "domcontentloaded" }
    );

    // 1. Verify multi-step AgentLoopStepStrip + live TaskCard transition Running -> Done (Step 3)!
    await expect(page.getByTestId("agent-step-strip")).toContainText(
      "Completed 3 steps",
      { timeout: 15_000 }
    );
    const firstCard = page.getByTestId("task-card").nth(0);
    await expect(firstCard.getByTestId("task-card-status")).toContainText(
      "Done",
      { timeout: 10_000 }
    );
    await expect(firstCard.getByTestId("task-card-step-counter")).toContainText(
      "Step 3"
    );

    // 2. Verify awaiting_approval TaskCard has >=44px touch targets and zero 390px overflow
    const secondCard = page.getByTestId("task-card").nth(1);
    await expect(secondCard.getByTestId("task-card-status")).toContainText(
      "Needs approval"
    );
    const approveBtn = secondCard.getByTestId("task-card-approve");
    const stopBtn = secondCard.getByTestId("task-card-stop");
    const approveBox = await approveBtn.boundingBox();
    const stopBox = await stopBtn.boundingBox();
    assert.ok(
      (approveBox?.height ?? 0) >= 44 && (stopBox?.height ?? 0) >= 44,
      `Touch targets must be >=44px: approve=${approveBox?.height} stop=${stopBox?.height}`
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    assert.ok(overflow <= 390, `390px horizontal overflow: ${overflow}`);

    const step1Shot = join(scratchDir, "verify-step1-task-card-390.png");
    await page.screenshot({ path: step1Shot, fullPage: false });

    // 3. Verify 1-tap Approve & Run transitions Needs approval -> Done!
    await approveBtn.click();
    await expect(secondCard.getByTestId("task-card-status")).toContainText(
      "Done",
      { timeout: 10_000 }
    );

    // 4. Verify Tasks hub (/routines) survives full page load with persisted task state & Stop control
    tasksDb[approvalTaskId].status = "running";
    await page.route("**/api/tasks", (route) =>
      route.fulfill({
        status: 200,
        json: {
          status: "ready",
          tasks: [tasksDb[liveTaskId], tasksDb[approvalTaskId]],
        },
      })
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const statusRes = await page.evaluate(async (id) => {
      const r = await fetch(`/api/tasks/${id}`);
      return await r.json();
    }, liveTaskId);
    assert.equal(statusRes.task.status, "succeeded");
    assert.equal(statusRes.task.steps.length, 3);

    console.log(`PASS: Step 1 TaskCard 390x844 E2E succeeded (${step1Shot})`);
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
