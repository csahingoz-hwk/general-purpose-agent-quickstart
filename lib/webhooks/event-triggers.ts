import { createHmac, timingSafeEqual } from "node:crypto";
import { fenceUntrustedContent } from "@/lib/safety/untrusted-content";
import {
  type BackgroundTaskRecord,
  type BackgroundTaskStore,
  createPostgresTaskStore,
} from "@/lib/tasks/runner";

export type RoutineTriggerRule = {
  id: string;
  userId: string;
  source: string;
  eventFilter: string; // e.g. "*" or "pull_request.opened"
  title: string;
  promptTemplate: string;
  enabled: boolean;
};

export function isWebhooksEnabled(): boolean {
  return process.env.WEBHOOK_TRIGGERS_ENABLED === "true";
}

export function verifyWebhookHmacSignature(opts: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string | null | undefined;
}): boolean {
  const secret = (opts.secret ?? "").trim();
  const header = (opts.signatureHeader ?? "").trim();
  if (secret.length < 16 || secret === "****" || !header) {
    return false;
  }

  const normalizedHex = header.startsWith("sha256=")
    ? header.slice("sha256=".length)
    : header;
  if (!/^[0-9a-fA-F]{64}$/.test(normalizedHex)) {
    return false;
  }

  const expected = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(opts.rawBody, "utf8")
    .digest();
  const provided = Buffer.from(normalizedHex, "hex");

  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export async function processSignedWebhookEvent(opts: {
  source: string;
  eventType: string;
  rawBody: string;
  signatureHeader: string | null;
  secret: string | null | undefined;
  ownerUserId: string;
  rules?: RoutineTriggerRule[];
  taskStore?: BackgroundTaskStore;
}): Promise<
  | { status: "unauthorized" }
  | { status: "ignored_no_matching_rule" }
  | { status: "enqueued"; tasks: BackgroundTaskRecord[] }
> {
  const validSig = verifyWebhookHmacSignature({
    rawBody: opts.rawBody,
    signatureHeader: opts.signatureHeader,
    secret: opts.secret,
  });
  if (!validSig) {
    return { status: "unauthorized" };
  }

  const normalizedSource = opts.source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  const normalizedEvent = opts.eventType.trim().toLowerCase() || "event";

  const fenced = fenceUntrustedContent({
    text: opts.rawBody,
    source: `webhook:${normalizedSource}:${normalizedEvent}`,
    maxChars: 4000,
  });

  const activeRules = (opts.rules ?? []).filter(
    (r) =>
      r.enabled &&
      r.userId === opts.ownerUserId &&
      r.source.toLowerCase() === normalizedSource &&
      (r.eventFilter === "*" || r.eventFilter.toLowerCase() === normalizedEvent)
  );

  if (activeRules.length === 0) {
    return { status: "ignored_no_matching_rule" };
  }

  const store = opts.taskStore ?? createPostgresTaskStore();
  const enqueued: BackgroundTaskRecord[] = [];

  for (const rule of activeRules) {
    const task = await store.enqueueTask({
      userId: opts.ownerUserId,
      kind: "routine",
      title: `[Webhook:${normalizedSource}] ${rule.title}`.slice(0, 180),
      prompt: `${rule.promptTemplate}\n\nEvent (${normalizedEvent}):\n${fenced.fencedText}`,
      riskLevel: fenced.suspicious ? "high" : "low",
    });
    enqueued.push(task);
  }

  return { status: "enqueued", tasks: enqueued };
}
