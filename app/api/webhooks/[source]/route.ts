import { NextResponse } from "next/server";
import {
  isWebhooksEnabled,
  processSignedWebhookEvent,
} from "@/lib/webhooks/event-triggers";

export async function POST(
  request: Request,
  context: { params: Promise<{ source: string }> }
) {
  if (!isWebhooksEnabled()) {
    return NextResponse.json(
      { error: "Inbound webhook triggers are disabled" },
      { status: 503 }
    );
  }

  const ownerUserId = (process.env.WEBHOOK_OWNER_USER_ID ?? "").trim();
  const webhookSecret = process.env.WEBHOOK_HMAC_SECRET ?? "";
  if (!ownerUserId || !webhookSecret) {
    return NextResponse.json(
      { error: "Webhook secret or owner binding is not configured" },
      { status: 503 }
    );
  }

  const { source } = await context.params;
  const rawBody = await request.text();
  if (rawBody.length > 256 * 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const signatureHeader =
    request.headers.get("x-hub-signature-256") ??
    request.headers.get("x-webhook-signature-256");
  const eventType =
    request.headers.get("x-github-event") ??
    request.headers.get("x-webhook-event") ??
    "event";

  const result = await processSignedWebhookEvent({
    source,
    eventType,
    rawBody,
    signatureHeader,
    secret: webhookSecret,
    ownerUserId,
    rules: [
      {
        id: "default-owner-webhook-rule",
        userId: ownerUserId,
        source: source.toLowerCase(),
        eventFilter: "*",
        title: `Inbound ${source} ${eventType}`,
        promptTemplate:
          "Review fenced webhook event and summarize required actions.",
        enabled: true,
      },
    ],
  });

  if (result.status === "unauthorized") {
    return NextResponse.json(
      { error: "Invalid HMAC signature" },
      { status: 401 }
    );
  }

  return NextResponse.json(result, { status: 200 });
}
