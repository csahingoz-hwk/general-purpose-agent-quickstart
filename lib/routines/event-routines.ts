import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { resolveGoogleAccessTokenFromVault } from "@/lib/connectors/google-vault-auth";
import {
  containsRestrictedWorkData,
  readGmailMessages,
} from "@/lib/connectors/google-workspace";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";
import {
  type BackgroundTaskRecord,
  type BackgroundTaskStore,
  createPostgresTaskStore,
} from "@/lib/tasks/runner";
import type { SecretVaultStore } from "@/lib/vault/secret-vault";

export type EventRoutineTriggerRecord = {
  id: string;
  userId: string;
  source: string;
  eventFilter: string;
  title: string;
  promptTemplate: string;
  enabled: boolean;
  createdAt: string;
};

export type NormalizedRoutineEvent = {
  source: string;
  eventType: string;
  externalEventId: string;
  occurredAt: string;
  sender?: string;
  subjectOrTitle: string;
  fencedBody: string;
  suspicious: boolean;
  metadata?: Record<string, string>;
};

export interface EventTriggerSourceAdapter {
  readonly source: string;
  readonly label: { en: string; tr: string };
  readonly status: "active" | "webhook_ready" | "extensible";
  readonly supportedEvents: readonly string[];
  matchesFilter: (event: NormalizedRoutineEvent, filter: string) => boolean;
  pollNewEvents?: (opts: {
    userId: string;
    cursor: string | null;
    vaultStore?: SecretVaultStore;
    fetchImpl?: typeof fetch;
  }) => Promise<{
    events: NormalizedRoutineEvent[];
    nextCursor: string | null;
  }>;
  parseWebhookPayload?: (opts: {
    eventType: string;
    rawBody: string;
  }) => NormalizedRoutineEvent[];
}

function matchesCommonKeywordFilter(
  event: NormalizedRoutineEvent,
  rawFilter: string
): boolean {
  const f = rawFilter.trim().toLowerCase();
  if (!f || f === "*" || f === event.eventType.toLowerCase()) {
    return true;
  }
  if (f.startsWith("from:")) {
    const needle = f.slice(5).trim();
    return Boolean(
      needle && (event.sender ?? "").toLowerCase().includes(needle)
    );
  }
  if (f.startsWith("subject:")) {
    const needle = f.slice(8).trim();
    return Boolean(
      needle && event.subjectOrTitle.toLowerCase().includes(needle)
    );
  }
  if (f.startsWith("repo:")) {
    const needle = f.slice(5).trim();
    return Boolean(
      needle && (event.metadata?.repo ?? "").toLowerCase().includes(needle)
    );
  }
  if (f.startsWith("channel:")) {
    const needle = f.slice(8).trim();
    return Boolean(
      needle && (event.metadata?.channel ?? "").toLowerCase().includes(needle)
    );
  }
  const haystack =
    `${event.sender ?? ""} ${event.subjectOrTitle} ${event.fencedBody}`.toLowerCase();
  return haystack.includes(f);
}

/**
 * Live adapter #1: "new Gmail email" trigger (`source: "gmail"`).
 * Polls the owner's Gmail inbox using encrypted Vault credentials, seeds cursor
 * cleanly on first run without spamming old mail, and emits newly arrived emails.
 */
export const gmailEventTriggerAdapter: EventTriggerSourceAdapter = {
  source: "gmail",
  label: { en: "New Gmail email", tr: "Yeni Gmail e-postası" },
  status: "active",
  supportedEvents: ["email.received"],
  matchesFilter: matchesCommonKeywordFilter,
  async pollNewEvents({ userId, cursor, vaultStore, fetchImpl }) {
    const auth = await resolveGoogleAccessTokenFromVault({
      userId,
      vaultStore,
      fetchImpl,
    });
    if (!auth.ok) {
      return { events: [], nextCursor: cursor };
    }

    const messages = await readGmailMessages({
      accessToken: auth.accessToken,
      query: "in:inbox",
      maxResults: 10,
      oauthClientProjectNumber: auth.oauthClientProjectNumber,
      fetchImpl,
    });

    if (messages.length === 0) {
      return { events: [], nextCursor: cursor ?? "__empty__" };
    }

    const newestId = messages[0]?.id ?? null;

    // First-time baseline initialization: record newest message ID without backfilling old mail
    if (cursor === null) {
      return { events: [], nextCursor: newestId };
    }

    const newMessages: typeof messages = [];
    for (const msg of messages) {
      if (msg.id === cursor) {
        break;
      }
      newMessages.push(msg);
    }

    // Oldest-first ordering for deterministic routine execution
    const chronological = [...newMessages].reverse();
    const events: NormalizedRoutineEvent[] = [];

    for (const msg of chronological) {
      if (
        containsRestrictedWorkData(
          `${msg.from}\n${msg.subject}\n${msg.fencedContent}`
        )
      ) {
        continue;
      }
      events.push({
        source: "gmail",
        eventType: "email.received",
        externalEventId: msg.id,
        occurredAt: msg.date || new Date().toISOString(),
        sender: msg.from,
        subjectOrTitle: msg.subject,
        fencedBody: msg.fencedContent,
        suspicious: msg.suspicious,
        metadata: { threadId: msg.threadId },
      });
    }

    return {
      events,
      nextCursor: newestId ?? cursor,
    };
  },
};

/**
 * Extensible adapter #2: GitHub events (`source: "github"`).
 */
export const githubEventTriggerAdapter: EventTriggerSourceAdapter = {
  source: "github",
  label: { en: "GitHub event", tr: "GitHub olayı" },
  status: "webhook_ready",
  supportedEvents: [
    "pull_request.opened",
    "pull_request.synchronize",
    "issues.opened",
    "push",
  ],
  matchesFilter: matchesCommonKeywordFilter,
  parseWebhookPayload({ eventType, rawBody }) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const pr = parsed.pull_request as Record<string, unknown> | undefined;
    const repo = parsed.repository as Record<string, unknown> | undefined;
    const sender = parsed.sender as Record<string, unknown> | undefined;
    const repoFullName =
      typeof repo?.full_name === "string" ? repo.full_name : "unknown/repo";
    const title =
      typeof pr?.title === "string"
        ? pr.title
        : `${eventType} on ${repoFullName}`;
    const extId = String(
      pr?.id ?? parsed.after ?? `${eventType}:${Date.now()}`
    );
    const fenced = fenceUntrustedContent({
      text: rawBody,
      source: `github:${eventType}`,
      maxChars: 3500,
    });
    return [
      {
        source: "github",
        eventType,
        externalEventId: extId,
        occurredAt: new Date().toISOString(),
        sender: typeof sender?.login === "string" ? sender.login : undefined,
        subjectOrTitle: title,
        fencedBody: fenced.fencedText,
        suspicious: fenced.suspicious,
        metadata: { repo: repoFullName },
      },
    ];
  },
};

/**
 * Extensible adapter #3: Slack events (`source: "slack"`).
 */
export const slackEventTriggerAdapter: EventTriggerSourceAdapter = {
  source: "slack",
  label: { en: "Slack event", tr: "Slack olayı" },
  status: "extensible",
  supportedEvents: ["app_mention", "message.channels", "message.im"],
  matchesFilter: matchesCommonKeywordFilter,
  parseWebhookPayload({ eventType, rawBody }) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const ev = (parsed.event as Record<string, unknown> | undefined) ?? parsed;
    const text = typeof ev.text === "string" ? ev.text : rawBody;
    const channel = typeof ev.channel === "string" ? ev.channel : "general";
    const user = typeof ev.user === "string" ? ev.user : "slack-user";
    const ts = String(ev.event_ts ?? ev.ts ?? `${Date.now()}`);
    const resolvedType =
      typeof ev.type === "string" ? ev.type : eventType || "app_mention";
    const fenced = fenceUntrustedContent({
      text,
      source: `slack:${channel}`,
      maxChars: 3000,
    });
    return [
      {
        source: "slack",
        eventType: resolvedType,
        externalEventId: `${channel}:${ts}`,
        occurredAt: new Date().toISOString(),
        sender: user,
        subjectOrTitle: `Slack message in ${channel}`,
        fencedBody: fenced.fencedText,
        suspicious: fenced.suspicious,
        metadata: { channel },
      },
    ];
  },
};

export class EventTriggerRegistry {
  private readonly adapters = new Map<string, EventTriggerSourceAdapter>();

  constructor(initial: readonly EventTriggerSourceAdapter[] = []) {
    for (const adapter of initial) {
      this.register(adapter);
    }
  }

  register(adapter: EventTriggerSourceAdapter): void {
    this.adapters.set(adapter.source.toLowerCase(), adapter);
  }

  get(source: string): EventTriggerSourceAdapter | undefined {
    return this.adapters.get(source.toLowerCase());
  }

  listCatalog() {
    return [...this.adapters.values()].map((a) => ({
      source: a.source,
      label: a.label,
      status: a.status,
      supportedEvents: [...a.supportedEvents],
      supportsPolling: typeof a.pollNewEvents === "function",
      supportsWebhook: typeof a.parseWebhookPayload === "function",
    }));
  }
}

export const defaultEventTriggerRegistry = new EventTriggerRegistry([
  gmailEventTriggerAdapter,
  githubEventTriggerAdapter,
  slackEventTriggerAdapter,
]);

export interface EventRoutineStore {
  listTriggers: (userId: string) => Promise<EventRoutineTriggerRecord[]>;
  createTrigger: (input: {
    userId: string;
    source: string;
    eventFilter?: string;
    title: string;
    promptTemplate: string;
    enabled?: boolean;
  }) => Promise<EventRoutineTriggerRecord>;
  toggleTrigger: (opts: {
    userId: string;
    id: string;
    enabled: boolean;
  }) => Promise<EventRoutineTriggerRecord | null>;
  deleteTrigger: (opts: { userId: string; id: string }) => Promise<boolean>;
  getCursor: (opts: {
    userId: string;
    source: string;
  }) => Promise<string | null>;
  setCursor: (opts: {
    userId: string;
    source: string;
    cursorValue: string;
  }) => Promise<void>;
  claimEventOnce: (opts: {
    userId: string;
    source: string;
    externalEventId: string;
  }) => Promise<boolean>;
}

export function createInMemoryEventRoutineStore(): EventRoutineStore {
  const triggers = new Map<string, EventRoutineTriggerRecord>();
  const cursors = new Map<string, string>();
  const processed = new Set<string>();
  let seq = 0;

  return {
    listTriggers(userId) {
      const rows = [...triggers.values()]
        .filter((t) => t.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((t) => ({ ...t }));
      return Promise.resolve(rows);
    },
    createTrigger({
      userId,
      source,
      eventFilter = "*",
      title,
      promptTemplate,
      enabled = true,
    }) {
      const record: EventRoutineTriggerRecord = {
        id: randomUUID(),
        userId,
        source: source.trim().toLowerCase(),
        eventFilter: eventFilter.trim() || "*",
        title: title.trim().slice(0, 180),
        promptTemplate: promptTemplate.trim(),
        enabled,
        createdAt: new Date(Date.now() + seq++).toISOString(),
      };
      triggers.set(record.id, record);
      return Promise.resolve({ ...record });
    },
    toggleTrigger({ userId, id, enabled }) {
      const found = triggers.get(id);
      if (!found || found.userId !== userId) {
        return Promise.resolve(null);
      }
      const updated = { ...found, enabled };
      triggers.set(id, updated);
      return Promise.resolve({ ...updated });
    },
    deleteTrigger({ userId, id }) {
      const found = triggers.get(id);
      if (!found || found.userId !== userId) {
        return Promise.resolve(false);
      }
      return Promise.resolve(triggers.delete(id));
    },
    getCursor({ userId, source }) {
      return Promise.resolve(
        cursors.get(`${userId}:${source.toLowerCase()}`) ?? null
      );
    },
    setCursor({ userId, source, cursorValue }) {
      cursors.set(`${userId}:${source.toLowerCase()}`, cursorValue);
      return Promise.resolve();
    },
    claimEventOnce({ userId, source, externalEventId }) {
      const key = `${userId}:${source.toLowerCase()}:${externalEventId}`;
      if (processed.has(key)) {
        return Promise.resolve(false);
      }
      processed.add(key);
      return Promise.resolve(true);
    },
  };
}

let pgClient: ReturnType<typeof postgres> | undefined;
function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not configured");
  }
  pgClient ??= postgres(process.env.POSTGRES_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 0,
  });
  return pgClient;
}

async function readySql() {
  const sql = getSql();
  await ensureParitySchema(sql);
  return sql;
}

function mapTriggerRow(
  row: Record<string, unknown>
): EventRoutineTriggerRecord {
  return {
    id: String(row.id),
    userId: String(row.userId),
    source: String(row.source),
    eventFilter: String(row.eventFilter ?? "*"),
    title: String(row.title),
    promptTemplate: String(row.promptTemplate),
    enabled: Boolean(row.enabled),
    createdAt: new Date(String(row.createdAt)).toISOString(),
  };
}

export function createPostgresEventRoutineStore(): EventRoutineStore {
  return {
    async listTriggers(userId) {
      const sql = await readySql();
      const rows = await sql`
        SELECT * FROM "RoutineTrigger"
        WHERE "userId" = ${userId}::uuid
        ORDER BY "createdAt" DESC
      `;
      return rows.map(mapTriggerRow);
    },
    async createTrigger({
      userId,
      source,
      eventFilter = "*",
      title,
      promptTemplate,
      enabled = true,
    }) {
      const sql = await readySql();
      const id = randomUUID();
      const [row] = await sql`
        INSERT INTO "RoutineTrigger" (
          "id", "userId", "source", "eventFilter", "title", "promptTemplate", "enabled"
        )
        VALUES (
          ${id}::uuid,
          ${userId}::uuid,
          ${source.trim().toLowerCase()},
          ${eventFilter.trim() || "*"},
          ${title.trim().slice(0, 180)},
          ${promptTemplate.trim()},
          ${enabled}
        )
        RETURNING *
      `;
      return mapTriggerRow(row);
    },
    async toggleTrigger({ userId, id, enabled }) {
      const sql = await readySql();
      const [row] = await sql`
        UPDATE "RoutineTrigger"
        SET "enabled" = ${enabled}
        WHERE "id" = ${id}::uuid AND "userId" = ${userId}::uuid
        RETURNING *
      `;
      return row ? mapTriggerRow(row) : null;
    },
    async deleteTrigger({ userId, id }) {
      const sql = await readySql();
      const rows = await sql`
        DELETE FROM "RoutineTrigger"
        WHERE "id" = ${id}::uuid AND "userId" = ${userId}::uuid
        RETURNING "id"
      `;
      return rows.length > 0;
    },
    async getCursor({ userId, source }) {
      const sql = await readySql();
      const [row] = await sql`
        SELECT "cursorValue" FROM "RoutineTriggerCursor"
        WHERE "userId" = ${userId}::uuid AND "source" = ${source.toLowerCase()}
        LIMIT 1
      `;
      return row?.cursorValue ? String(row.cursorValue) : null;
    },
    async setCursor({ userId, source, cursorValue }) {
      const sql = await readySql();
      await sql`
        INSERT INTO "RoutineTriggerCursor" ("userId", "source", "cursorValue", "updatedAt")
        VALUES (${userId}::uuid, ${source.toLowerCase()}, ${cursorValue}, now())
        ON CONFLICT ("userId", "source")
        DO UPDATE SET "cursorValue" = EXCLUDED."cursorValue", "updatedAt" = now()
      `;
    },
    async claimEventOnce({ userId, source, externalEventId }) {
      const sql = await readySql();
      const id = randomUUID();
      const rows = await sql`
        INSERT INTO "RoutineTriggerProcessedEvent" ("id", "userId", "source", "externalEventId")
        VALUES (${id}::uuid, ${userId}::uuid, ${source.toLowerCase()}, ${externalEventId})
        ON CONFLICT ("userId", "source", "externalEventId") DO NOTHING
        RETURNING "id"
      `;
      return rows.length > 0;
    },
  };
}

let fallbackEventStore: EventRoutineStore | null = null;
export function resolveEventRoutineStore(
  override?: EventRoutineStore
): EventRoutineStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresEventRoutineStore();
  }
  fallbackEventStore ??= createInMemoryEventRoutineStore();
  return fallbackEventStore;
}

/**
 * Dispatches normalized external events (Gmail poll or Slack/GitHub webhook)
 * against the owner's active `RoutineTrigger` rules with idempotent event-id
 * deduplication and untrusted-content risk elevation.
 */
export async function dispatchNormalizedRoutineEvents(opts: {
  userId: string;
  source: string;
  events: readonly NormalizedRoutineEvent[];
  eventStore?: EventRoutineStore;
  taskStore?: BackgroundTaskStore;
  registry?: EventTriggerRegistry;
}): Promise<{
  enqueuedTasks: BackgroundTaskRecord[];
  skippedDuplicates: number;
}> {
  const registry = opts.registry ?? defaultEventTriggerRegistry;
  const adapter = registry.get(opts.source);
  if (!adapter || opts.events.length === 0) {
    return { enqueuedTasks: [], skippedDuplicates: 0 };
  }

  const eventStore = resolveEventRoutineStore(opts.eventStore);
  const taskStore = opts.taskStore ?? createPostgresTaskStore();
  const triggers = (await eventStore.listTriggers(opts.userId)).filter(
    (t) => t.enabled && t.source.toLowerCase() === adapter.source
  );
  if (triggers.length === 0) {
    return { enqueuedTasks: [], skippedDuplicates: 0 };
  }

  const enqueuedTasks: BackgroundTaskRecord[] = [];
  let skippedDuplicates = 0;

  for (const ev of opts.events) {
    const matching = triggers.filter((t) =>
      adapter.matchesFilter(ev, t.eventFilter)
    );
    if (matching.length === 0) {
      continue;
    }
    const fresh = await eventStore.claimEventOnce({
      userId: opts.userId,
      source: adapter.source,
      externalEventId: ev.externalEventId,
    });
    if (!fresh) {
      skippedDuplicates += 1;
      continue;
    }

    for (const rule of matching) {
      const task = await taskStore.enqueueTask({
        userId: opts.userId,
        kind: "routine",
        title: `[Event:${adapter.source}] ${rule.title}`.slice(0, 180),
        prompt: `${rule.promptTemplate}\n\nEvent (${ev.eventType}) — ${ev.subjectOrTitle}${ev.sender ? ` from ${ev.sender}` : ""}:\n${ev.fencedBody}`,
        riskLevel: ev.suspicious ? "high" : "low",
      });
      enqueuedTasks.push(task);
    }
  }

  return { enqueuedTasks, skippedDuplicates };
}

/**
 * Polls all poll-capable adapters (starting with Gmail) that have at least one
 * enabled `RoutineTrigger` for `userId`, updates the cursor, and enqueues
 * matching routine tasks.
 */
export async function pollEventTriggeredRoutinesForUser(opts: {
  userId: string;
  eventStore?: EventRoutineStore;
  taskStore?: BackgroundTaskStore;
  vaultStore?: SecretVaultStore;
  registry?: EventTriggerRegistry;
  fetchImpl?: typeof fetch;
}): Promise<{
  seededCursors: string[];
  enqueuedTasks: BackgroundTaskRecord[];
}> {
  const registry = opts.registry ?? defaultEventTriggerRegistry;
  const eventStore = resolveEventRoutineStore(opts.eventStore);
  const activeTriggers = (await eventStore.listTriggers(opts.userId)).filter(
    (t) => t.enabled
  );
  const activeSources = [...new Set(activeTriggers.map((t) => t.source))];

  const seededCursors: string[] = [];
  const enqueuedTasks: BackgroundTaskRecord[] = [];

  for (const source of activeSources) {
    const adapter = registry.get(source);
    if (!adapter?.pollNewEvents) {
      continue;
    }
    const prevCursor = await eventStore.getCursor({
      userId: opts.userId,
      source,
    });
    const polled = await adapter.pollNewEvents({
      userId: opts.userId,
      cursor: prevCursor,
      vaultStore: opts.vaultStore,
      fetchImpl: opts.fetchImpl,
    });

    if (polled.nextCursor && polled.nextCursor !== prevCursor) {
      await eventStore.setCursor({
        userId: opts.userId,
        source,
        cursorValue: polled.nextCursor,
      });
      if (prevCursor === null) {
        seededCursors.push(source);
      }
    }

    if (polled.events.length > 0) {
      const dispatched = await dispatchNormalizedRoutineEvents({
        userId: opts.userId,
        source,
        events: polled.events,
        eventStore,
        taskStore: opts.taskStore,
        registry,
      });
      enqueuedTasks.push(...dispatched.enqueuedTasks);
    }
  }

  return { seededCursors, enqueuedTasks };
}
