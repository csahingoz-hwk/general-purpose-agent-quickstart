import postgres from "postgres";

const directSessionPools = new Map<string, ReturnType<typeof postgres>>();

function getDirectSessionPool(url: string): ReturnType<typeof postgres> {
  const key = url.trim();
  const existing = directSessionPools.get(key);
  if (existing) {
    return existing;
  }
  const pool = postgres(key, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    // Short idle_timeout keeps warm direct sessions across back-to-back chat turns
    // while allowing CLI test processes (`node --test`) to exit promptly.
    idle_timeout: 3,
  });
  directSessionPools.set(key, pool);
  return pool;
}

export async function closeChatLockPoolsForTests(): Promise<void> {
  const pools = [...directSessionPools.values()];
  directSessionPools.clear();
  await Promise.all(
    pools.map((pool) => pool.end({ timeout: 1 }).catch(() => null))
  );
}

/**
 * A session advisory lock MUST use a dedicated, unpooled PostgreSQL session.
 * Uses `pool.reserve()` + `session.release()` so the advisory lock and unlock
 * execute on the exact same backend session without paying a cold TCP+TLS+SCRAM
 * handshake on every chat message.
 */
export async function acquireChatLock(
  chatId: string,
  url = process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL_UNPOOLED
): Promise<(() => Promise<void>) | null> {
  if (!url?.trim()) {
    throw new Error(
      "Direct database connection required for chat coordination"
    );
  }
  const pool = getDirectSessionPool(url);
  const session = await pool.reserve();
  let released = false;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    try {
      await session`SELECT pg_advisory_unlock(hashtextextended(${chatId}, 0))`;
    } finally {
      session.release();
    }
  };
  try {
    const [row] =
      await session`SELECT pg_try_advisory_lock(hashtextextended(${chatId}, 0)) AS acquired`;
    if (!row?.acquired) {
      session.release();
      return null;
    }
    return release;
  } catch (error) {
    session.release();
    throw error;
  }
}
