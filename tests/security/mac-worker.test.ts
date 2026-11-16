import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startLoopbackHealthServer } from "../../lib/worker/health-server";
import { RotatingFileLogger } from "../../lib/worker/log-rotator";
import {
  createInMemoryWorkerAdapter,
  evaluateMemoryBudget,
  QueueWorkerEngine,
} from "../../lib/worker/queue-worker";
import { classifyTaskWorkload } from "../../lib/worker/workload-policy";

test("RotatingFileLogger rotates logs at maxBytes ceiling, prunes backups, and redacts secrets", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "worker-log-test-"));
  try {
    const logPath = path.join(tmpDir, "worker.log");
    const logger = new RotatingFileLogger({
      filePath: logPath,
      maxBytes: 1024,
      maxBackups: 2,
    });

    for (let i = 0; i < 30; i++) {
      logger.log("info", "poll.tick", {
        seq: i,
        auth: "Bearer secret-oauth-token-1234567890",
        padding: "x".repeat(80),
      });
    }

    const files = readdirSync(tmpDir).sort();
    assert.deepEqual(files, ["worker.log", "worker.log.1", "worker.log.2"]);
    assert.equal(files.includes("worker.log.3"), false);

    const content = readFileSync(logPath, "utf8");
    assert.equal(content.includes("secret-oauth-token"), false);
    assert.match(content, /\[REDACTED\]/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("workload policy keeps heavy jobs off the 8 GB RAM Mac mini and blocks work data from personal cloud", () => {
  const light = classifyTaskWorkload({
    kind: "routine",
    title: "Weekday 08:00 London Brief",
    prompt: "Summarize calendar priorities and FX rates.",
    riskLevel: "low",
  });
  assert.equal(light.route, "run_local_light");

  const heavyPersonal = classifyTaskWorkload({
    kind: "executor",
    title: "Render 1080p Remotion clip",
    prompt: "Run docker container with ffmpeg video render for personal song.",
    riskLevel: "low",
  });
  assert.equal(heavyPersonal.route, "defer_heavy_to_cloud_run");

  const heavyWork = classifyTaskWorkload({
    kind: "executor",
    title: "Korn Ferry batch OCR",
    prompt: "Run batch OCR container on SA90 EOSB schedules.",
    riskLevel: "low",
  });
  assert.equal(heavyWork.route, "blocked_work_data_boundary");

  const highRisk = classifyTaskWorkload({
    kind: "draft_review",
    title: "External webhook post",
    prompt: "Dispatch payload to external webhook.",
    riskLevel: "high",
  });
  assert.equal(highRisk.route, "pause_for_approval");
});

test("QueueWorkerEngine enqueues due routines, processes 1 task per tick, pauses high-risk, and flags ~40 MB RSS cap recycle", async () => {
  const now = new Date("2026-11-16T08:01:00.000Z");
  const adapter = createInMemoryWorkerAdapter({
    routines: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        userId: "owner-1",
        cronExpression: "0 8 * * 1-5",
        timezone: "Europe/London",
        prompt: "Morning FX pulse check",
        nextRunAt: new Date("2026-11-16T08:00:00.000Z"),
      },
    ],
    tasks: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        userId: "owner-1",
        kind: "draft_review",
        title: "Outbound summary",
        prompt: "Send update externally",
        status: "queued",
        riskLevel: "high",
        scheduleId: null,
        steps: [{ step: 1, message: "Queued", timestamp: now.toISOString() }],
        output: null,
        error: null,
        createdAt: "2026-11-16T07:59:00.000Z",
        startedAt: null,
        finishedAt: null,
      },
    ],
  });

  let simulatedRssMb = 34;
  const engine = new QueueWorkerEngine({
    adapter,
    rssCapMb: 40,
    heapCapMb: 24,
    readMemory: () => ({
      rss: simulatedRssMb * 1024 * 1024,
      heapUsed: 6 * 1024 * 1024,
      external: 1 * 1024 * 1024,
    }),
  });

  // Tick 1: enqueues due routine + claims oldest queued high-risk task -> pauses in awaiting_approval
  const tick1 = await engine.runPollTick(now);
  assert.equal(tick1.enqueuedRoutines, 1);
  assert.equal(tick1.processedTask?.status, "awaiting_approval");
  assert.equal(tick1.recycleNeeded, false);

  // Tick 2: claims the routine task enqueued on Tick 1; simulate RSS crossing 40 MB -> triggers clean recycle
  simulatedRssMb = 43;
  const tick2 = await engine.runPollTick(new Date(now.getTime() + 15_000));
  assert.equal(tick2.processedTask?.status, "succeeded");
  assert.equal(tick2.recycleNeeded, true);

  const routinesAfter = adapter.getRoutines();
  assert.ok(routinesAfter[0]?.nextRunAt.getTime() > now.getTime());
  assert.match(routinesAfter[0]?.lastOutput ?? "", /Morning FX pulse check/);

  // Verify direct memory budget helper as well
  const overHeap = evaluateMemoryBudget({
    sample: {
      rss: 35 * 1024 * 1024,
      heapUsed: 25 * 1024 * 1024,
      external: 0,
    },
    rssCapMb: 40,
    heapCapMb: 24,
  });
  assert.equal(overHeap.recycleNeeded, true);
});

test("loopback health check server responds 200 when healthy and 503 when degraded or recycling", async () => {
  let status: "ok" | "degraded" | "recycling" = "ok";
  const server = await startLoopbackHealthServer({
    port: 0, // OS-assigned ephemeral loopback port
    host: "127.0.0.1",
    getSnapshot: () => ({
      status,
      pid: process.pid,
      uptimeSec: 12,
      rssBytes: 34 * 1024 * 1024,
      rssMb: 34,
      heapUsedMb: 5.2,
      heapCapMb: 24,
      rssCapMb: 40,
      lastPollAt: new Date().toISOString(),
      pollAgeMs: 250,
      routinesEnqueued: 1,
      tasksSucceeded: 2,
      tasksPausedForApproval: 0,
      tasksOffloadedToCloudRun: 0,
      tasksFailed: 0,
      recycleNeeded: status === "recycling",
      recycleReason: null,
    }),
  });

  try {
    const okRes = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as { status: string; rssCapMb: number };
    assert.equal(okJson.status, "ok");
    assert.equal(okJson.rssCapMb, 40);

    status = "recycling";
    const degRes = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    assert.equal(degRes.status, 503);
  } finally {
    await server.close();
  }
});
