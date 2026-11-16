import path from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  startLoopbackHealthServer,
  writeHealthHeartbeatFile,
} from "../lib/worker/health-server";
import { RotatingFileLogger } from "../lib/worker/log-rotator";
import {
  createInMemoryWorkerAdapter,
  createPostgresWorkerAdapter,
  DEFAULT_HEAP_CAP_MB,
  DEFAULT_TARGET_RSS_CAP_MB,
  QueueWorkerEngine,
} from "../lib/worker/queue-worker";

loadDotenv({ path: ".env.local" });

const POLL_INTERVAL_MS = Math.max(
  2000,
  Number.parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "15000", 10)
);
const HEALTH_PORT = Number.parseInt(
  process.env.WORKER_HEALTH_PORT ?? "4319",
  10
);
const RSS_CAP_MB = Number.parseInt(
  process.env.WORKER_MAX_RSS_MB ?? String(DEFAULT_TARGET_RSS_CAP_MB),
  10
);
const HEAP_CAP_MB = Number.parseInt(
  process.env.WORKER_MAX_HEAP_MB ?? String(DEFAULT_HEAP_CAP_MB),
  10
);

const logDir =
  process.env.WORKER_LOG_DIR ??
  path.join(process.cwd(), ".next", "cache", "worker");
const logFile = path.join(logDir, "worker.log");
const heartbeatFile =
  process.env.WORKER_HEARTBEAT_FILE ?? path.join(logDir, "worker-health.json");

async function main() {
  const onceMode = process.argv.includes("--once");
  const baselineRssBytes = process.memoryUsage().rss;

  const logger = new RotatingFileLogger({
    filePath: logFile,
    maxBytes: 2 * 1024 * 1024, // 2 MB per file
    maxBackups: 3, // Rotate up to 3 backups (~8 MB ceiling)
    alsoConsole: onceMode,
  });

  const pgUrl = (process.env.POSTGRES_URL ?? "").trim();
  const hasPg = pgUrl.length > 10 && pgUrl !== "****";
  const adapter = hasPg
    ? createPostgresWorkerAdapter(pgUrl)
    : createInMemoryWorkerAdapter();

  const engine = new QueueWorkerEngine({
    adapter,
    logger,
    rssCapMb: RSS_CAP_MB,
    heapCapMb: HEAP_CAP_MB,
    baselineRssBytes,
  });

  logger.log("info", "worker.start", {
    pid: process.pid,
    mode: onceMode ? "once" : "daemon",
    dbMode: hasPg ? "postgres" : "idle_no_db",
    rssCapMb: RSS_CAP_MB,
    heapCapMb: HEAP_CAP_MB,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  if (onceMode) {
    await engine.runPollTick(new Date());
    writeHealthHeartbeatFile(heartbeatFile, engine.getHealthSnapshot());
    await engine.shutdown();
    return;
  }

  const healthServer = await startLoopbackHealthServer({
    port: HEALTH_PORT,
    host: "127.0.0.1",
    maxPollStaleMs: Math.max(POLL_INTERVAL_MS * 4, 120_000),
    getSnapshot: () => engine.getHealthSnapshot(),
  });

  logger.log("info", "worker.health_listening", {
    host: "127.0.0.1",
    port: healthServer.port,
  });

  let stopping = false;
  const gracefulStop = async (reason: string, exitCode = 0) => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.log("info", "worker.stop", { reason, exitCode });
    await healthServer.close().catch(() => null);
    await engine.shutdown().catch(() => null);
    process.exit(exitCode);
  };

  process.on("SIGTERM", () => {
    gracefulStop("SIGTERM", 0).catch(() => null);
  });
  process.on("SIGINT", () => {
    gracefulStop("SIGINT", 0).catch(() => null);
  });

  while (!stopping) {
    try {
      const tick = await engine.runPollTick(new Date());
      writeHealthHeartbeatFile(heartbeatFile, engine.getHealthSnapshot());

      if (tick.recycleNeeded) {
        // Exit cleanly so launchd KeepAlive=true respawns a fresh low-RSS worker.
        await gracefulStop("memory_cap_recycle", 0);
        return;
      }
    } catch (err) {
      logger.log("error", "worker.tick_error", {
        error: err instanceof Error ? err.message : "unknown_error",
      });
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  process.stderr.write(
    `[worker.fatal] ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
