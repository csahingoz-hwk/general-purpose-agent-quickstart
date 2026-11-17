import { createHash } from "node:crypto";
import { createClient } from "redis";

import { isProductionEnvironment } from "@/lib/constants";
import { ChatbotError } from "@/lib/errors";

/**
 * Vercel Redis (Free, 30 MB, RAM-only, no persistence) is strictly ephemeral:
 * ONLY short-TTL rate-limit counters (`rl:ip:*`) and transient mid-stream SSE
 * Pub/Sub coordination (`eph-stream:*`) may touch this store.
 * NEVER store user memory, chat messages, vault secrets, or permanent state here.
 */
export const EPHEMERAL_REDIS_KEY_PREFIXES = ["rl:ip:", "eph-stream:"] as const;

const MAX_MESSAGES = 100;
const TTL_SECONDS = 60 * 60;
const REDIS_CONNECT_TIMEOUT_MS = 1500;

type MinimalRedisClient = {
  isReady: boolean;
  connect: () => Promise<unknown>;
  ping: () => Promise<string>;
  multi: () => {
    incr: (key: string) => unknown;
    expire: (
      key: string,
      seconds: number,
      mode?: "NX" | "XX" | "GT" | "LT"
    ) => unknown;
    exec: () => Promise<unknown[]>;
  };
};

let client: ReturnType<typeof createClient> | null = null;
let connectPromise: Promise<ReturnType<typeof createClient> | null> | null =
  null;
let injectedClientForTests: MinimalRedisClient | null = null;

export function setRedisClientForTests(mock: MinimalRedisClient | null) {
  injectedClientForTests = mock;
}

export async function closeRedisClient(): Promise<void> {
  const active = client;
  client = null;
  connectPromise = null;
  if (active) {
    await active.quit().catch(() => active.disconnect().catch(() => undefined));
  }
}

export function assertEphemeralRedisKey(key: string, ttlSeconds: number) {
  const allowed = EPHEMERAL_REDIS_KEY_PREFIXES.some((prefix) =>
    key.startsWith(prefix)
  );
  if (!allowed) {
    throw new Error(
      `Refusing non-ephemeral Redis key "${key}". Redis is reserved for rate limits and stream resume only.`
    );
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86_400) {
    throw new Error(
      `Refusing Redis key "${key}" without bounded ephemeral TTL (got ${ttlSeconds}s).`
    );
  }
}

export function buildRateLimitKey(ip: string): string {
  const digest = createHash("sha256")
    .update(ip.trim())
    .digest("hex")
    .slice(0, 16);
  return `rl:ip:${digest}`;
}

async function ensureRedisClient(): Promise<MinimalRedisClient | null> {
  if (injectedClientForTests) {
    return injectedClientForTests;
  }
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    return null;
  }
  if (client?.isReady) {
    return client as unknown as MinimalRedisClient;
  }
  if (!connectPromise) {
    const next = createClient({
      url,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy: (retries) =>
          retries > 2 ? false : Math.min(retries * 100, 300),
      },
    });
    next.on("error", () => undefined);
    connectPromise = next
      .connect()
      .then(() => {
        client = next;
        return next;
      })
      .catch(() => {
        client = null;
        connectPromise = null;
        next.disconnect().catch(() => undefined);
        return null;
      });
  }
  const connected = await connectPromise;
  return (connected as unknown as MinimalRedisClient) ?? null;
}

export async function pingRedis(): Promise<boolean> {
  const redis = await ensureRedisClient();
  if (!redis?.isReady) {
    return false;
  }
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("Redis ping timeout")),
          REDIS_CONNECT_TIMEOUT_MS
        )
      ),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

export async function checkIpRateLimit(
  ip: string | undefined,
  options?: { forceEnforce?: boolean; maxMessages?: number }
) {
  if ((!isProductionEnvironment && !options?.forceEnforce) || !ip) {
    return;
  }

  const redis = await ensureRedisClient();
  if (!redis?.isReady) {
    return;
  }

  try {
    const key = buildRateLimitKey(ip);
    assertEphemeralRedisKey(key, TTL_SECONDS);
    const tx = redis.multi();
    tx.incr(key);
    tx.expire(key, TTL_SECONDS, "NX");
    const [count] = await tx.exec();

    const limit = options?.maxMessages ?? MAX_MESSAGES;
    if (typeof count === "number" && count > limit) {
      throw new ChatbotError("rate_limit:chat");
    }
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
  }
}
