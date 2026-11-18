import { randomUUID } from "node:crypto";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";
import { getSharedPostgresClient } from "@/lib/db/shared-pool";
import { computeActionDigest } from "./action-review";
import { detectPromptInjection } from "./untrusted-content";

export type OwnerApprovalMode = "ask_every_time" | "draft_without_asking";
export type ToolRuleDecision = "always_allow" | "never_allow";

export type OwnerAssistantSettingsRecord = {
  userId: string;
  approvalMode: OwnerApprovalMode;
  uiLocale: "auto" | "en" | "tr";
  updatedAt: string;
};

export type ToolApprovalRuleRecord = {
  id: string;
  userId: string;
  toolName: string;
  decision: ToolRuleDecision;
  createdAt: string;
  updatedAt: string;
};

/**
 * Unsent draft-only tools that create private drafts without sending emails,
 * invites, or external messages. Under `draft_without_asking`, these run
 * without pausing on an approval gate (unless tainted by prompt injection or
 * blocked by a `never_allow` rule), while any send/outbound/schedule tool
 * still asks before executing.
 */
export const UNSENT_DRAFT_TOOLS = new Set<string>([
  "gmailCreateDraft",
  "calendarCreateDraftEvent",
  "driveCreateDraftDoc",
  "githubCreateDraftReview",
]);

export const SIDE_EFFECT_GUARDED_TOOLS = new Set<string>([
  "gmailCreateDraft",
  "calendarCreateDraftEvent",
  "driveCreateDraftDoc",
  "githubCreateDraftReview",
  "draftOutboundMessage",
  "scheduleTask",
  "cancelSchedule",
  "generateVideoClip",
  "cloudExec",
  "cloudWriteFile",
  "macExec",
  "macRunAgentCli",
]);

export type EffectiveApprovalPolicy =
  | {
      action: "block_by_rule";
      needsApproval: false;
      reason: string;
    }
  | {
      action: "auto_allow";
      needsApproval: false;
    }
  | {
      action: "require_approval";
      needsApproval: true;
    };

export function resolveEffectiveToolApproval(opts: {
  toolName: string;
  defaultNeedsApproval: boolean;
  approvalMode: OwnerApprovalMode;
  rulesMap: ReadonlyMap<string, ToolRuleDecision>;
  hasUntrustedContext?: boolean;
  serializedInput?: string;
}): EffectiveApprovalPolicy {
  const rule = opts.rulesMap.get(opts.toolName);
  if (rule === "never_allow") {
    return {
      action: "block_by_rule",
      needsApproval: false,
      reason: `Blocked because "${opts.toolName}" is set to Never allow in Settings.`,
    };
  }

  if (opts.serializedInput) {
    const injection = detectPromptInjection(opts.serializedInput);
    if (injection.suspicious) {
      return { action: "require_approval", needsApproval: true };
    }
  }

  if (rule === "always_allow") {
    return { action: "auto_allow", needsApproval: false };
  }

  if (
    opts.approvalMode === "draft_without_asking" &&
    UNSENT_DRAFT_TOOLS.has(opts.toolName)
  ) {
    return { action: "auto_allow", needsApproval: false };
  }

  if (opts.defaultNeedsApproval) {
    return { action: "require_approval", needsApproval: true };
  }

  return { action: "auto_allow", needsApproval: false };
}

export interface ApprovalPreferencesStore {
  getSettings: (userId: string) => Promise<OwnerAssistantSettingsRecord>;
  updateSettings: (opts: {
    userId: string;
    approvalMode?: OwnerApprovalMode;
    uiLocale?: "auto" | "en" | "tr";
  }) => Promise<OwnerAssistantSettingsRecord>;
  listToolRules: (userId: string) => Promise<ToolApprovalRuleRecord[]>;
  setToolRule: (opts: {
    userId: string;
    toolName: string;
    decision: ToolRuleDecision;
  }) => Promise<ToolApprovalRuleRecord>;
  deleteToolRule: (opts: {
    userId: string;
    toolName: string;
  }) => Promise<boolean>;
}

export function createInMemoryApprovalPreferencesStore(): ApprovalPreferencesStore {
  const settingsMap = new Map<string, OwnerAssistantSettingsRecord>();
  const rulesMap = new Map<string, ToolApprovalRuleRecord>();
  let seq = 0;

  return {
    getSettings(userId) {
      const existing = settingsMap.get(userId);
      if (existing) {
        return Promise.resolve({ ...existing });
      }
      return Promise.resolve({
        userId,
        approvalMode: "ask_every_time",
        uiLocale: "auto",
        updatedAt: new Date(0).toISOString(),
      });
    },
    async updateSettings({ userId, approvalMode, uiLocale }) {
      const current = await this.getSettings(userId);
      const updated: OwnerAssistantSettingsRecord = {
        userId,
        approvalMode: approvalMode ?? current.approvalMode,
        uiLocale: uiLocale ?? current.uiLocale,
        updatedAt: new Date(Date.now() + seq++).toISOString(),
      };
      settingsMap.set(userId, updated);
      return { ...updated };
    },
    listToolRules(userId) {
      const list = [...rulesMap.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((r) => ({ ...r }));
      return Promise.resolve(list);
    },
    setToolRule({ userId, toolName, decision }) {
      const cleanTool = toolName.trim();
      const key = `${userId}:${cleanTool}`;
      const existing = rulesMap.get(key);
      const now = new Date(Date.now() + seq++).toISOString();
      const record: ToolApprovalRuleRecord = {
        id: existing?.id ?? randomUUID(),
        userId,
        toolName: cleanTool,
        decision,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      rulesMap.set(key, record);
      return Promise.resolve({ ...record });
    },
    deleteToolRule({ userId, toolName }) {
      const key = `${userId}:${toolName.trim()}`;
      return Promise.resolve(rulesMap.delete(key));
    },
  };
}

// ---------------------------------------------------------------------------
// Restart-safe Mid-Flight Tool Execution Journal (Item 6)
// ---------------------------------------------------------------------------

export const PROCESS_BOOT_ID = randomUUID();

export type ExecutionJournalStatus =
  | "in_flight"
  | "completed"
  | "interrupted"
  | "failed";

export type ExecutionJournalEntry = {
  id: string;
  userId: string;
  chatId: string;
  toolCallId: string;
  toolName: string;
  digest: string;
  bootId: string;
  status: ExecutionJournalStatus;
  startedAt: string;
  finishedAt: string | null;
};

export interface ToolExecutionJournalStore {
  beginExecution: (opts: {
    userId: string;
    chatId: string;
    toolCallId: string;
    toolName: string;
    digest: string;
    bootId?: string;
  }) => Promise<
    | { allowed: true }
    | {
        allowed: false;
        reason: "interrupted_on_restart" | "already_completed" | "in_flight";
        entry: ExecutionJournalEntry;
      }
  >;
  finishExecution: (opts: {
    chatId: string;
    toolCallId: string;
    status: "completed" | "failed" | "interrupted";
  }) => Promise<void>;
  sweepStaleInFlightForBoot: (opts: {
    userId?: string;
    chatId?: string;
    currentBootId?: string;
  }) => Promise<number>;
  getEntry: (opts: {
    chatId: string;
    toolCallId: string;
  }) => Promise<ExecutionJournalEntry | null>;
}

export function createInMemoryExecutionJournalStore(): ToolExecutionJournalStore {
  const entries = new Map<string, ExecutionJournalEntry>();

  return {
    async sweepStaleInFlightForBoot({
      userId,
      chatId,
      currentBootId = PROCESS_BOOT_ID,
    }) {
      let count = 0;
      const nowIso = new Date().toISOString();
      for (const entry of entries.values()) {
        if (entry.status !== "in_flight") {
          continue;
        }
        if (userId && entry.userId !== userId) {
          continue;
        }
        if (chatId && entry.chatId !== chatId) {
          continue;
        }
        if (entry.bootId !== currentBootId) {
          entry.status = "interrupted";
          entry.finishedAt = nowIso;
          count += 1;
        }
      }
      return await Promise.resolve(count);
    },
    async beginExecution({
      userId,
      chatId,
      toolCallId,
      toolName,
      digest,
      bootId = PROCESS_BOOT_ID,
    }) {
      await this.sweepStaleInFlightForBoot({
        chatId,
        currentBootId: bootId,
      });
      const key = `${chatId}:${toolCallId}`;
      const existing = entries.get(key);
      if (existing) {
        if (existing.status === "interrupted") {
          return {
            allowed: false,
            reason: "interrupted_on_restart",
            entry: { ...existing },
          };
        }
        if (existing.status === "completed") {
          return {
            allowed: false,
            reason: "already_completed",
            entry: { ...existing },
          };
        }
        if (existing.status === "in_flight") {
          return {
            allowed: false,
            reason:
              existing.bootId !== bootId
                ? "interrupted_on_restart"
                : "in_flight",
            entry: { ...existing },
          };
        }
      }
      const created: ExecutionJournalEntry = {
        id: randomUUID(),
        userId,
        chatId,
        toolCallId,
        toolName,
        digest,
        bootId,
        status: "in_flight",
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      entries.set(key, created);
      return { allowed: true };
    },
    finishExecution({ chatId, toolCallId, status }) {
      const key = `${chatId}:${toolCallId}`;
      const existing = entries.get(key);
      if (existing) {
        existing.status = status;
        existing.finishedAt = new Date().toISOString();
      }
      return Promise.resolve();
    },
    getEntry({ chatId, toolCallId }) {
      const found = entries.get(`${chatId}:${toolCallId}`);
      return Promise.resolve(found ? { ...found } : null);
    },
  };
}

function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not configured");
  }
  return getSharedPostgresClient(process.env.POSTGRES_URL);
}

async function readySql() {
  const sql = getSql();
  await ensureParitySchema(sql);
  return sql;
}

function normalizeMode(raw: unknown): OwnerApprovalMode {
  return raw === "draft_without_asking"
    ? "draft_without_asking"
    : "ask_every_time";
}

function normalizeLocale(raw: unknown): "auto" | "en" | "tr" {
  if (raw === "en" || raw === "tr") {
    return raw;
  }
  return "auto";
}

let fallbackPrefsStore: ApprovalPreferencesStore | null = null;
export function resolveApprovalPreferencesStore(
  override?: ApprovalPreferencesStore
): ApprovalPreferencesStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresApprovalPreferencesStore();
  }
  fallbackPrefsStore ??= createInMemoryApprovalPreferencesStore();
  return fallbackPrefsStore;
}

let fallbackJournalStore: ToolExecutionJournalStore | null = null;
export function resolveExecutionJournalStore(
  override?: ToolExecutionJournalStore
): ToolExecutionJournalStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresExecutionJournalStore();
  }
  fallbackJournalStore ??= createInMemoryExecutionJournalStore();
  return fallbackJournalStore;
}

export function createPostgresApprovalPreferencesStore(): ApprovalPreferencesStore {
  return {
    async getSettings(userId) {
      const sql = await readySql();
      const [row] = await sql`
        SELECT "userId", "approvalMode", "uiLocale", "updatedAt"
        FROM "OwnerAssistantSettings"
        WHERE "userId" = ${userId}::uuid
        LIMIT 1
      `;
      if (!row) {
        return {
          userId,
          approvalMode: "ask_every_time",
          uiLocale: "auto",
          updatedAt: new Date(0).toISOString(),
        };
      }
      return {
        userId: String(row.userId),
        approvalMode: normalizeMode(row.approvalMode),
        uiLocale: normalizeLocale(row.uiLocale),
        updatedAt: new Date(String(row.updatedAt)).toISOString(),
      };
    },
    async updateSettings({ userId, approvalMode, uiLocale }) {
      const current = await this.getSettings(userId);
      const nextMode = approvalMode ?? current.approvalMode;
      const nextLocale = uiLocale ?? current.uiLocale;
      const sql = await readySql();
      const [row] = await sql`
        INSERT INTO "OwnerAssistantSettings" ("userId", "approvalMode", "uiLocale", "updatedAt")
        VALUES (${userId}::uuid, ${nextMode}, ${nextLocale}, now())
        ON CONFLICT ("userId")
        DO UPDATE SET
          "approvalMode" = EXCLUDED."approvalMode",
          "uiLocale" = EXCLUDED."uiLocale",
          "updatedAt" = now()
        RETURNING "userId", "approvalMode", "uiLocale", "updatedAt"
      `;
      return {
        userId: String(row.userId),
        approvalMode: normalizeMode(row.approvalMode),
        uiLocale: normalizeLocale(row.uiLocale),
        updatedAt: new Date(String(row.updatedAt)).toISOString(),
      };
    },
    async listToolRules(userId) {
      const sql = await readySql();
      const rows = await sql`
        SELECT "id", "userId", "toolName", "decision", "createdAt", "updatedAt"
        FROM "ToolApprovalRule"
        WHERE "userId" = ${userId}::uuid
        ORDER BY "updatedAt" DESC
      `;
      return rows.map((r) => ({
        id: String(r.id),
        userId: String(r.userId),
        toolName: String(r.toolName),
        decision: (r.decision === "never_allow"
          ? "never_allow"
          : "always_allow") as ToolRuleDecision,
        createdAt: new Date(String(r.createdAt)).toISOString(),
        updatedAt: new Date(String(r.updatedAt)).toISOString(),
      }));
    },
    async setToolRule({ userId, toolName, decision }) {
      const sql = await readySql();
      const id = randomUUID();
      const cleanName = toolName.trim().slice(0, 80);
      const [row] = await sql`
        INSERT INTO "ToolApprovalRule" ("id", "userId", "toolName", "decision", "createdAt", "updatedAt")
        VALUES (${id}::uuid, ${userId}::uuid, ${cleanName}, ${decision}, now(), now())
        ON CONFLICT ("userId", "toolName")
        DO UPDATE SET
          "decision" = EXCLUDED."decision",
          "updatedAt" = now()
        RETURNING "id", "userId", "toolName", "decision", "createdAt", "updatedAt"
      `;
      return {
        id: String(row.id),
        userId: String(row.userId),
        toolName: String(row.toolName),
        decision: (row.decision === "never_allow"
          ? "never_allow"
          : "always_allow") as ToolRuleDecision,
        createdAt: new Date(String(row.createdAt)).toISOString(),
        updatedAt: new Date(String(row.updatedAt)).toISOString(),
      };
    },
    async deleteToolRule({ userId, toolName }) {
      const sql = await readySql();
      const rows = await sql`
        DELETE FROM "ToolApprovalRule"
        WHERE "userId" = ${userId}::uuid AND "toolName" = ${toolName.trim()}
        RETURNING "id"
      `;
      return rows.length > 0;
    },
  };
}

function mapJournalRow(row: Record<string, unknown>): ExecutionJournalEntry {
  return {
    id: String(row.id),
    userId: String(row.userId),
    chatId: String(row.chatId),
    toolCallId: String(row.toolCallId),
    toolName: String(row.toolName),
    digest: String(row.digest),
    bootId: String(row.bootId),
    status: row.status as ExecutionJournalStatus,
    startedAt: new Date(String(row.startedAt)).toISOString(),
    finishedAt: row.finishedAt
      ? new Date(String(row.finishedAt)).toISOString()
      : null,
  };
}

export function createPostgresExecutionJournalStore(): ToolExecutionJournalStore {
  return {
    async sweepStaleInFlightForBoot({
      userId,
      chatId,
      currentBootId = PROCESS_BOOT_ID,
    }) {
      const sql = await readySql();
      const rows = chatId
        ? await sql`
            UPDATE "ToolExecutionJournal"
            SET "status" = 'interrupted', "finishedAt" = now()
            WHERE "chatId" = ${chatId}::uuid
              AND "status" = 'in_flight'
              AND "bootId" <> ${currentBootId}
            RETURNING "id"
          `
        : userId
          ? await sql`
              UPDATE "ToolExecutionJournal"
              SET "status" = 'interrupted', "finishedAt" = now()
              WHERE "userId" = ${userId}::uuid
                AND "status" = 'in_flight'
                AND "bootId" <> ${currentBootId}
              RETURNING "id"
            `
          : await sql`
              UPDATE "ToolExecutionJournal"
              SET "status" = 'interrupted', "finishedAt" = now()
              WHERE "status" = 'in_flight'
                AND "bootId" <> ${currentBootId}
              RETURNING "id"
            `;
      return rows.length;
    },
    async beginExecution({
      userId,
      chatId,
      toolCallId,
      toolName,
      digest,
      bootId = PROCESS_BOOT_ID,
    }) {
      await this.sweepStaleInFlightForBoot({
        chatId,
        currentBootId: bootId,
      });
      const sql = await readySql();
      const [existing] = await sql`
        SELECT * FROM "ToolExecutionJournal"
        WHERE "chatId" = ${chatId}::uuid AND "toolCallId" = ${toolCallId}
        LIMIT 1
      `;
      if (existing) {
        const mapped = mapJournalRow(existing);
        if (mapped.status === "interrupted") {
          return {
            allowed: false,
            reason: "interrupted_on_restart",
            entry: mapped,
          };
        }
        if (mapped.status === "completed") {
          return { allowed: false, reason: "already_completed", entry: mapped };
        }
        if (mapped.status === "in_flight") {
          return {
            allowed: false,
            reason:
              mapped.bootId !== bootId ? "interrupted_on_restart" : "in_flight",
            entry: mapped,
          };
        }
      }
      const id = randomUUID();
      await sql`
        INSERT INTO "ToolExecutionJournal" (
          "id", "userId", "chatId", "toolCallId", "toolName", "digest", "bootId", "status", "startedAt"
        )
        VALUES (
          ${id}::uuid, ${userId}::uuid, ${chatId}::uuid, ${toolCallId}, ${toolName}, ${digest}, ${bootId}, 'in_flight', now()
        )
        ON CONFLICT ("chatId", "toolCallId")
        DO UPDATE SET
          "status" = 'in_flight',
          "bootId" = EXCLUDED."bootId",
          "startedAt" = now(),
          "finishedAt" = NULL
      `;
      return { allowed: true };
    },
    async finishExecution({ chatId, toolCallId, status }) {
      const sql = await readySql();
      await sql`
        UPDATE "ToolExecutionJournal"
        SET "status" = ${status}, "finishedAt" = now()
        WHERE "chatId" = ${chatId}::uuid AND "toolCallId" = ${toolCallId}
      `.catch(() => null);
    },
    async getEntry({ chatId, toolCallId }) {
      const sql = await readySql();
      const [row] = await sql`
        SELECT * FROM "ToolExecutionJournal"
        WHERE "chatId" = ${chatId}::uuid AND "toolCallId" = ${toolCallId}
        LIMIT 1
      `;
      return row ? mapJournalRow(row) : null;
    },
  };
}

/**
 * Wraps chat tools with:
 * 1. Owner approval mode (`ask_every_time` vs `draft_without_asking`)
 * 2. Per-tool `always_allow` / `never_allow` rules
 * 3. Restart-safe `ToolExecutionJournal` guard so mid-flight side-effecting
 *    tool calls never execute twice across a restart or redeploy.
 */
export function applyOwnerPoliciesToToolSet<
  TTools extends Record<string, unknown>,
>(
  tools: TTools,
  opts: {
    userId: string;
    chatId: string;
    approvalMode: OwnerApprovalMode;
    rules: readonly ToolApprovalRuleRecord[];
    hasUntrustedContext?: boolean;
    journalStore?: ToolExecutionJournalStore;
    bootId?: string;
  }
): TTools {
  const rulesMap = new Map<string, ToolRuleDecision>(
    opts.rules.map((r) => [r.toolName, r.decision])
  );
  const journal = opts.journalStore ?? resolveExecutionJournalStore();
  const wrapped: Record<string, unknown> = {};

  for (const [toolName, rawTool] of Object.entries(tools)) {
    if (!rawTool || typeof rawTool !== "object") {
      wrapped[toolName] = rawTool;
      continue;
    }
    const toolObj = rawTool as {
      needsApproval?:
        | boolean
        | ((input: unknown) => boolean | Promise<boolean>);
      execute?: (
        input: unknown,
        ctx: {
          toolCallId: string;
          messages: unknown[];
          abortSignal?: AbortSignal;
        }
      ) => Promise<unknown>;
      [key: string]: unknown;
    };

    const defaultNeedsApproval = Boolean(toolObj.needsApproval);
    const hasCustomRule = rulesMap.has(toolName);
    const isGuardedSideEffect = SIDE_EFFECT_GUARDED_TOOLS.has(toolName);

    if (!defaultNeedsApproval && !hasCustomRule && !isGuardedSideEffect) {
      wrapped[toolName] = rawTool;
      continue;
    }

    const basePolicy = resolveEffectiveToolApproval({
      toolName,
      defaultNeedsApproval,
      approvalMode: opts.approvalMode,
      rulesMap,
      hasUntrustedContext: opts.hasUntrustedContext,
    });

    const originalExecute = toolObj.execute;
    wrapped[toolName] = {
      ...toolObj,
      needsApproval: basePolicy.needsApproval,
      ...(typeof originalExecute === "function"
        ? {
            execute: async (
              input: unknown,
              ctx: {
                toolCallId: string;
                messages: unknown[];
                abortSignal?: AbortSignal;
              }
            ) => {
              const runtimePolicy = resolveEffectiveToolApproval({
                toolName,
                defaultNeedsApproval,
                approvalMode: opts.approvalMode,
                rulesMap,
                hasUntrustedContext: opts.hasUntrustedContext,
                serializedInput: JSON.stringify(input ?? {}),
              });

              if (runtimePolicy.action === "block_by_rule") {
                return {
                  status: "blocked_by_owner_rule" as const,
                  toolName,
                  message: runtimePolicy.reason,
                };
              }

              if (isGuardedSideEffect) {
                const callId = ctx?.toolCallId || `call_${randomUUID()}`;
                const digest = computeActionDigest(toolName, input);
                const guard = await journal
                  .beginExecution({
                    userId: opts.userId,
                    chatId: opts.chatId,
                    toolCallId: callId,
                    toolName,
                    digest,
                    bootId: opts.bootId,
                  })
                  .catch(() => ({ allowed: true as const }));

                if (!guard.allowed) {
                  return {
                    status: "interrupted_on_restart" as const,
                    reason: guard.reason,
                    toolName,
                    message:
                      "This action was mid-flight during a server restart and was marked interrupted so it cannot run or send twice.",
                  };
                }

                try {
                  const output = await originalExecute.call(
                    toolObj,
                    input,
                    ctx
                  );
                  await journal
                    .finishExecution({
                      chatId: opts.chatId,
                      toolCallId: callId,
                      status: "completed",
                    })
                    .catch(() => undefined);
                  return output;
                } catch (err) {
                  await journal
                    .finishExecution({
                      chatId: opts.chatId,
                      toolCallId: callId,
                      status: "failed",
                    })
                    .catch(() => undefined);
                  throw err;
                }
              }

              return await originalExecute.call(toolObj, input, ctx);
            },
          }
        : {}),
    };
  }

  return wrapped as TTools;
}
