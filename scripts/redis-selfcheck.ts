import { createClient } from "redis";
import { createResumableStreamContext } from "resumable-stream";
import {
  buildRateLimitKey,
  checkIpRateLimit,
  closeRedisClient,
  EPHEMERAL_REDIS_KEY_PREFIXES,
  pingRedis,
} from "../lib/ratelimit";

async function main() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    console.log("Redis self-check: SKIPPED (REDIS_URL not set)");
    return;
  }

  const start = Date.now();
  const pingOk = await pingRedis();
  if (!pingOk) {
    throw new Error("Redis self-check failed: pingRedis() returned false");
  }
  const pingMs = Date.now() - start;

  const probeIp = "203.0.113.251";
  const rateKey = buildRateLimitKey(probeIp);
  const streamId = `selfcheck-${Date.now()}`;
  const sentinelKey = `eph-stream:rs:sentinel:${streamId}`;

  const admin = createClient({ url, socket: { connectTimeout: 3000 } });
  admin.on("error", () => undefined);
  await admin.connect();

  try {
    await admin.del(rateKey);
    await checkIpRateLimit(probeIp, { forceEnforce: true });

    const [rawCount, rateTtl] = await Promise.all([
      admin.get(rateKey),
      admin.ttl(rateKey),
    ]);
    if (rawCount !== "1" || rateTtl <= 0 || rateTtl > 3600) {
      throw new Error(
        `Redis rate-limit check failed: count=${rawCount}, ttl=${rateTtl}`
      );
    }

    const subscriber = createClient({ url, socket: { connectTimeout: 3000 } });
    const publisher = createClient({ url, socket: { connectTimeout: 3000 } });
    subscriber.on("error", () => undefined);
    publisher.on("error", () => undefined);
    await Promise.all([subscriber.connect(), publisher.connect()]);

    let resumedPayload = "";
    try {
      const ctx = createResumableStreamContext({
        waitUntil: null,
        keyPrefix: "eph-stream",
        subscriber,
        publisher,
      });

      let releaseChunk = () => undefined;
      const chunkGate = new Promise<void>((resolve) => {
        releaseChunk = () => {
          resolve();
          return undefined;
        };
      });

      const sourceStream = new ReadableStream<string>({
        async start(controller) {
          controller.enqueue('data: {"type":"text-delta","delta":"ok"}\n\n');
          await chunkGate;
          controller.close();
        },
      });

      await ctx.createNewResumableStream(streamId, () => sourceStream);
      const resumed = await ctx.resumeExistingStream(streamId);
      if (!resumed) {
        throw new Error(
          "Redis mid-stream resume check failed: resumeExistingStream returned empty"
        );
      }
      releaseChunk();

      const reader = resumed.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        resumedPayload += value;
      }

      if (!resumedPayload.includes('"delta":"ok"')) {
        throw new Error(
          `Redis mid-stream resume payload mismatch: ${resumedPayload}`
        );
      }

      const sentinelTtl = await admin.ttl(sentinelKey);
      if (sentinelTtl <= 0) {
        throw new Error(
          `Redis sentinel missing ephemeral TTL: ttl=${sentinelTtl}`
        );
      }
    } finally {
      await Promise.allSettled([subscriber.quit(), publisher.quit()]);
    }

    await admin.del([rateKey, sentinelKey]);

    const scanResult = await admin.scan("0", { COUNT: 200 });
    for (const key of scanResult.keys) {
      const allowed =
        EPHEMERAL_REDIS_KEY_PREFIXES.some((p) => key.startsWith(p)) ||
        key.startsWith("resumable-stream:");
      const ttl = await admin.ttl(key);
      if (!allowed || ttl === -1) {
        throw new Error(
          `Permanent or unexpected Redis key detected: key=${key} ttl=${ttl}`
        );
      }
    }

    console.log(
      `Redis self-check: PASS redis_store=ready ping=${pingMs}ms ratelimit=ok(ttl=${rateTtl}s) streamResume=ok permanentKeys=0`
    );
  } finally {
    await admin.del([rateKey, sentinelKey]).catch(() => undefined);
    await Promise.allSettled([admin.quit(), closeRedisClient()]);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Redis self-check: FAIL", err);
    process.exit(1);
  });
