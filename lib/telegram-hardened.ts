import { createHmac, timingSafeEqual } from "node:crypto";
import { computeActionDigest } from "@/lib/safety/action-review";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";
import type {
  BackgroundTaskRecord,
  BackgroundTaskStore,
} from "@/lib/tasks/runner";

export function isTelegramWebhookEnabled(): boolean {
  return process.env.TELEGRAM_WEBHOOK_ENABLED === "true";
}

export function verifyTelegramSecretHeader(
  providedHeader: string | null,
  configuredSecret: string | null | undefined
): boolean {
  const secret = (configuredSecret ?? "").trim();
  const provided = (providedHeader ?? "").trim();
  if (secret.length < 16 || secret === "****" || !provided) {
    return false;
  }
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function compactUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

function expandUuid(hex32: string): string {
  if (!/^[0-9a-f]{32}$/i.test(hex32)) {
    return hex32;
  }
  const h = hex32.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Produces a <= 60-byte Telegram `callback_data` token signed with HMAC-SHA256
 * binding the owner's decision (`a` = approve, `d` = deny), `taskId`, and
 * the first 8 hex chars of the canonical action SHA-256 digest.
 */
export function signTelegramApprovalCallback(opts: {
  decision: "approve" | "deny";
  taskId: string;
  actionDigest: string;
  secret: string;
}): string {
  const flag = opts.decision === "approve" ? "a" : "d";
  const compactId = compactUuid(opts.taskId);
  const digest8 = opts.actionDigest.slice(0, 8).toLowerCase();
  const base = `${flag}:${compactId}:${digest8}`;
  const sig16 = createHmac("sha256", Buffer.from(opts.secret, "utf8"))
    .update(`tg-approval-v1:${base}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `${base}:${sig16}`;
}

export function verifyTelegramApprovalCallback(opts: {
  callbackData: string;
  secret: string;
}):
  | {
      valid: true;
      decision: "approve" | "deny";
      taskId: string;
      digestPrefix: string;
    }
  | { valid: false } {
  const secret = opts.secret.trim();
  if (secret.length < 16 || secret === "****") {
    return { valid: false };
  }
  const parts = opts.callbackData.split(":");
  if (parts.length !== 4) {
    return { valid: false };
  }
  const [flag, compactId, digest8, sig16] = parts;
  if (
    (flag !== "a" && flag !== "d") ||
    !/^[0-9a-f]{32}$/.test(compactId ?? "") ||
    !/^[0-9a-f]{8}$/.test(digest8 ?? "") ||
    !/^[0-9a-f]{16}$/.test(sig16 ?? "")
  ) {
    return { valid: false };
  }
  const base = `${flag}:${compactId}:${digest8}`;
  const expectedSig = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`tg-approval-v1:${base}`, "utf8")
    .digest("hex")
    .slice(0, 16);

  if (
    !timingSafeEqual(
      Buffer.from(sig16, "utf8"),
      Buffer.from(expectedSig, "utf8")
    )
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    decision: flag === "a" ? "approve" : "deny",
    taskId: expandUuid(compactId),
    digestPrefix: digest8,
  };
}

export function computeTaskApprovalDigest(
  task: Pick<BackgroundTaskRecord, "kind" | "title" | "prompt">
): string {
  return computeActionDigest("telegramTaskApproval", {
    kind: task.kind,
    title: task.title,
    prompt: task.prompt,
  });
}

export type TelegramUpdatePayload = {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: number | string } };
  };
};

export async function handleHardenedTelegramUpdate(opts: {
  secretHeader: string | null;
  webhookSecret: string | null | undefined;
  update: TelegramUpdatePayload;
  resolveOwnerByChatId: (
    chatId: string
  ) => Promise<{ id: string; email: string } | null>;
  checkMonthlyBudgetOk?: (userId: string) => Promise<boolean>;
  taskStore: BackgroundTaskStore;
}): Promise<
  | { httpStatus: 401; body: { error: string } }
  | {
      httpStatus: 200;
      body: {
        ok: true;
        ignored?: boolean;
        action?: "enqueued" | "approved" | "denied" | "budget_exhausted";
        taskId?: string;
      };
    }
> {
  if (!verifyTelegramSecretHeader(opts.secretHeader, opts.webhookSecret)) {
    return { httpStatus: 401, body: { error: "Invalid webhook secret" } };
  }

  const rawChatId =
    opts.update.callback_query?.message?.chat?.id ??
    opts.update.message?.chat?.id;
  if (rawChatId === undefined || rawChatId === null) {
    return { httpStatus: 200, body: { ok: true, ignored: true } };
  }

  const chatId = String(rawChatId);
  const linkedOwner = await opts.resolveOwnerByChatId(chatId);
  if (!linkedOwner) {
    // Unlinked Telegram chat IDs are ignored with zero DB writes or model spend.
    return { httpStatus: 200, body: { ok: true, ignored: true } };
  }

  if (opts.update.callback_query?.data) {
    const verified = verifyTelegramApprovalCallback({
      callbackData: opts.update.callback_query.data,
      secret: String(opts.webhookSecret),
    });
    if (!verified.valid) {
      return { httpStatus: 401, body: { error: "Invalid callback signature" } };
    }

    const existing = await opts.taskStore.getTask({
      userId: linkedOwner.id,
      id: verified.taskId,
    });
    if (!existing || existing.status !== "awaiting_approval") {
      return { httpStatus: 200, body: { ok: true, ignored: true } };
    }

    const expectedDigest = computeTaskApprovalDigest(existing);
    if (!expectedDigest.startsWith(verified.digestPrefix)) {
      return { httpStatus: 401, body: { error: "Action digest mismatch" } };
    }

    if (verified.decision === "approve") {
      await opts.taskStore.transitionTask({
        userId: linkedOwner.id,
        id: existing.id,
        status: "queued",
        stepMessage: `Approved by owner via signed Telegram inline button (digest ${verified.digestPrefix})`,
      });
      return {
        httpStatus: 200,
        body: { ok: true, action: "approved", taskId: existing.id },
      };
    }

    await opts.taskStore.cancelTask({
      userId: linkedOwner.id,
      id: existing.id,
    });
    return {
      httpStatus: 200,
      body: { ok: true, action: "denied", taskId: existing.id },
    };
  }

  const text = opts.update.message?.text?.trim() ?? "";
  if (!text) {
    return { httpStatus: 200, body: { ok: true, ignored: true } };
  }

  if (opts.checkMonthlyBudgetOk) {
    const budgetOk = await opts.checkMonthlyBudgetOk(linkedOwner.id);
    if (!budgetOk) {
      return {
        httpStatus: 200,
        body: { ok: true, action: "budget_exhausted" },
      };
    }
  }

  const fenced = fenceUntrustedContent({
    text,
    source: `telegram:chat:${chatId}`,
    maxChars: 2000,
  });

  const task = await opts.taskStore.enqueueTask({
    userId: linkedOwner.id,
    kind: "executor",
    title: `[Telegram] ${text.slice(0, 80)}`,
    prompt: fenced.fencedText,
    riskLevel: fenced.suspicious ? "high" : "low",
  });

  return {
    httpStatus: 200,
    body: { ok: true, action: "enqueued", taskId: task.id },
  };
}
