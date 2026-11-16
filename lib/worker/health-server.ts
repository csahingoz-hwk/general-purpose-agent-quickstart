import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

export type WorkerHealthSnapshot = {
  status: "ok" | "degraded" | "recycling";
  pid: number;
  uptimeSec: number;
  rssBytes: number;
  rssMb: number;
  heapUsedMb: number;
  heapCapMb: number;
  rssCapMb: number;
  lastPollAt: string | null;
  pollAgeMs: number | null;
  routinesEnqueued: number;
  tasksSucceeded: number;
  tasksPausedForApproval: number;
  tasksOffloadedToCloudRun: number;
  tasksFailed: number;
  recycleNeeded: boolean;
  recycleReason: string | null;
};

export function writeHealthHeartbeatFile(
  filePath: string,
  snapshot: WorkerHealthSnapshot
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(tmpPath, filePath);
}

export function startLoopbackHealthServer(opts: {
  port: number;
  host?: "127.0.0.1";
  maxPollStaleMs?: number;
  getSnapshot: () => WorkerHealthSnapshot;
}): Promise<{
  server: Server;
  port: number;
  close: () => Promise<void>;
}> {
  const host = opts.host ?? "127.0.0.1";
  const maxPollStaleMs = opts.maxPollStaleMs ?? 120_000;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method !== "GET" || (req.url !== "/healthz" && req.url !== "/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const snapshot = opts.getSnapshot();
      const pollStale =
        snapshot.pollAgeMs !== null && snapshot.pollAgeMs > maxPollStaleMs;
      const healthy = snapshot.status === "ok" && !pollStale;

      const payload: WorkerHealthSnapshot = pollStale
        ? { ...snapshot, status: "degraded" }
        : snapshot;

      res.writeHead(healthy ? 200 : 503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(payload));
    });

    server.once("error", reject);
    server.listen(opts.port, host, () => {
      const addr = server.address();
      const boundPort =
        typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        server,
        port: boundPort,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
