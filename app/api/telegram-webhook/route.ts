import { isOwnerIdentity } from "@/lib/access-policy";
import { createPostgresTaskStore } from "@/lib/tasks/runner";
import {
  handleHardenedTelegramUpdate,
  isTelegramWebhookEnabled,
  type TelegramUpdatePayload,
} from "@/lib/telegram-hardened";

export function POST(): Response;
export function POST(request: Request): Response | Promise<Response>;
export function POST(request?: Request): Response | Promise<Response> {
  // Default fail-closed synchronous 503 unless explicitly enabled by owner.
  if (!isTelegramWebhookEnabled() || !request) {
    return Response.json(
      { error: "Telegram execution is disabled pending security review" },
      { status: 503 }
    );
  }

  return (async () => {
    const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
    let update: TelegramUpdatePayload;
    try {
      update = (await request.json()) as TelegramUpdatePayload;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { getUserByTelegramChatId } = await import("@/lib/db/queries");

    const result = await handleHardenedTelegramUpdate({
      secretHeader,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      update,
      resolveOwnerByChatId: async (chatId) => {
        const found = await getUserByTelegramChatId({ telegramChatId: chatId });
        if (!found) {
          return null;
        }
        // Enforce single-owner APP_OWNER_EMAIL policy in addition to DB link!
        if (!isOwnerIdentity({ email: found.email, type: "regular" })) {
          return null;
        }
        return { id: found.id, email: found.email };
      },
      taskStore: createPostgresTaskStore(),
    });

    return Response.json(result.body, { status: result.httpStatus });
  })();
}
