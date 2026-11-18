import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ChatbotError } from "../../lib/errors";
import {
  assertEphemeralRedisKey,
  buildRateLimitKey,
  checkIpRateLimit,
  pingRedis,
  setRedisClientForTests,
} from "../../lib/ratelimit";

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

test("Redis ephemeral guard rejects permanent keys and unbounded TTLs", () => {
  assert.doesNotThrow(() =>
    assertEphemeralRedisKey("rl:ip:0123456789abcdef", 3600)
  );
  assert.doesNotThrow(() =>
    assertEphemeralRedisKey("eph-stream:rs:sentinel:abc", 3600)
  );

  assert.throws(
    () => assertEphemeralRedisKey("memory:user:123", 3600),
    /non-ephemeral Redis key/
  );
  assert.throws(
    () => assertEphemeralRedisKey("chat:messages:123", 3600),
    /non-ephemeral Redis key/
  );
  assert.throws(
    () => assertEphemeralRedisKey("vault:secret:123", 3600),
    /non-ephemeral Redis key/
  );
  assert.throws(
    () => assertEphemeralRedisKey("rl:ip:0123456789abcdef", -1),
    /bounded ephemeral TTL/
  );
  assert.throws(
    () => assertEphemeralRedisKey("rl:ip:0123456789abcdef", 7 * 86_400),
    /bounded ephemeral TTL/
  );
});

test("Redis rate limiter hashes IPs, enforces 1h TTL, and pingRedis checks PONG", async () => {
  const store = new Map<string, { count: number; ttl: number }>();

  setRedisClientForTests({
    isReady: true,
    connect: async () => undefined,
    ping: async () => "PONG",
    multi: () => {
      let targetKey = "";
      let targetTtl = 0;
      return {
        incr(key: string) {
          targetKey = key;
          return this;
        },
        expire(_key: string, seconds: number) {
          targetTtl = seconds;
          return this;
        },
        exec() {
          const prev = store.get(targetKey)?.count ?? 0;
          const next = prev + 1;
          store.set(targetKey, { count: next, ttl: targetTtl });
          return Promise.resolve([next, 1]);
        },
      };
    },
  });

  try {
    assert.equal(await pingRedis(), true);

    const ip = "198.51.100.77";
    const key = buildRateLimitKey(ip);
    assert.match(key, /^rl:ip:[a-f0-9]{16}$/);
    assert.ok(!key.includes(ip), "raw IP must never be stored in Redis key");

    await checkIpRateLimit(ip, { forceEnforce: true, maxMessages: 2 });
    await checkIpRateLimit(ip, { forceEnforce: true, maxMessages: 2 });
    assert.deepEqual(store.get(key), { count: 2, ttl: 3600 });

    await assert.rejects(
      () => checkIpRateLimit(ip, { forceEnforce: true, maxMessages: 2 }),
      (err: unknown) => err instanceof ChatbotError && err.statusCode === 429
    );
  } finally {
    setRedisClientForTests(null);
  }
});

test("Memory, chat history, vault, files, and task stores never import Redis", () => {
  const permanentDirs = [
    "lib/memory",
    "lib/db",
    "lib/vault",
    "lib/files",
    "lib/tasks",
  ];
  for (const rel of permanentDirs) {
    for (const file of collectTsFiles(join(process.cwd(), rel))) {
      const src = readFileSync(file, "utf8");
      assert.ok(
        !/from\s+["']redis["']|REDIS_URL|resumable-stream/.test(src),
        `Permanent store ${file} must never touch ephemeral Redis`
      );
    }
  }

  const streamRoute = readFileSync(
    join(process.cwd(), "app/(chat)/api/chat/[id]/stream/route.ts"),
    "utf8"
  );
  assert.match(
    streamRoute,
    /resumeExistingStream/,
    "GET /api/chat/[id]/stream must resume active streams via Redis"
  );
});
