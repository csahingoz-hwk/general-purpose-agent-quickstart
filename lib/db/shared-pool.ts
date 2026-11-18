import postgres from "postgres";

const sharedPools = new Map<string, ReturnType<typeof postgres>>();

/**
 * Process-wide shared PostgreSQL connection pool keyed by URL so parallel
 * chat-turn reads (messages, soul, memory, vault, approvals, summaries, skills,
 * roster, ledger, files) reuse warm TLS sockets instead of opening 8+ separate
 * connection pools per request.
 */
export function getSharedPostgresClient(
  rawUrl = process.env.POSTGRES_URL ?? ""
): ReturnType<typeof postgres> {
  const key = rawUrl.trim();
  const existing = sharedPools.get(key);
  if (existing) {
    return existing;
  }
  const client = postgres(key, {
    max: 10,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  sharedPools.set(key, client);
  return client;
}

export function getSharedPoolCountForTests(): number {
  return sharedPools.size;
}
