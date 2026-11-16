import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";

const DEFAULT_HEALTH_PORT = 4319;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const port = Number.parseInt(
    process.env.WORKER_HEALTH_PORT ?? String(DEFAULT_HEALTH_PORT),
    10
  );

  // 1. Try live loopback health server on 127.0.0.1 first
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(800),
    });
    const body = await res.json();
    return NextResponse.json(
      { source: "loopback_http", worker: body },
      { status: res.ok ? 200 : 503 }
    );
  } catch {
    // Fall back to atomic heartbeat file written by worker
  }

  const heartbeatPath =
    process.env.WORKER_HEARTBEAT_FILE ??
    path.join(process.cwd(), ".next", "cache", "worker", "worker-health.json");

  try {
    const raw = await readFile(
      /* turbopackIgnore: true */ heartbeatPath,
      "utf8"
    );
    const parsed = JSON.parse(raw) as { lastPollAt?: string };
    const ageMs = parsed.lastPollAt
      ? Date.now() - new Date(parsed.lastPollAt).getTime()
      : null;
    const healthy = ageMs !== null && ageMs < 120_000;
    return NextResponse.json(
      {
        source: "heartbeat_file",
        worker: { ...parsed, pollAgeMs: ageMs },
      },
      { status: healthy ? 200 : 503 }
    );
  } catch {
    return NextResponse.json(
      {
        source: "offline",
        worker: null,
        message:
          "Local Mac mini launchd worker is not currently running. Run ops/launchd/install-launchd.sh when ready.",
      },
      { status: 200 }
    );
  }
}
