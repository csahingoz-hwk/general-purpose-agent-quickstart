import postgres from "postgres";

/** A session advisory lock MUST use a direct, unpooled PostgreSQL connection. */
export async function acquireChatLock(
  chatId: string,
  url = process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL_UNPOOLED
): Promise<(() => Promise<void>) | null> {
  if (!url) {
    throw new Error(
      "Direct database connection required for chat coordination"
    );
  }
  const connection = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  let released = false;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    try {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${chatId}, 0))`;
    } finally {
      await connection.end({ timeout: 1 });
    }
  };
  try {
    const [row] =
      await connection`SELECT pg_try_advisory_lock(hashtextextended(${chatId}, 0)) AS acquired`;
    if (!row.acquired) {
      await connection.end({ timeout: 1 });
      return null;
    }
    return release;
  } catch (error) {
    await connection.end({ timeout: 1 });
    throw error;
  }
}
