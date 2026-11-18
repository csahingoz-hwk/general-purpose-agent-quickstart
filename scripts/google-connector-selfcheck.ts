import { config } from "dotenv";
import postgres from "postgres";
import { createGoogleConnectorTools } from "@/lib/ai/tools/google-connectors";
import { extractGoogleClientProjectNumber } from "@/lib/connectors/google-vault-auth";

config({ path: ".env.local" });

async function main() {
  const oauthClientProject = extractGoogleClientProjectNumber(
    process.env.AUTH_GOOGLE_ID
  );
  const pgUrl =
    process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();
  const ownerEmail = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();

  if (!pgUrl || !ownerEmail || !oauthClientProject) {
    console.log(
      `Google connector self-check: SKIPPED (oauthClientProject=${oauthClientProject ?? "unset"})`
    );
    process.exit(0);
  }

  const sql = postgres(pgUrl, { max: 1, connect_timeout: 10 });
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM "User" WHERE LOWER(email) = ${ownerEmail} LIMIT 1
    `;
    const ownerId = rows[0]?.id;
    if (!ownerId) {
      console.log(
        `Google connector self-check: OWNER_NOT_SIGNED_IN_YET oauthClientProject=${oauthClientProject}`
      );
      process.exit(0);
    }

    const tools = createGoogleConnectorTools({ userId: ownerId });
    // Execute gmailReadMessages({}) end-to-end (defaults to latest 10 inbox messages, read-only).
    // Never log message subjects, senders, bodies, client IDs, or tokens.
    const res = await (tools.gmailReadMessages as any).execute(
      {},
      { toolCallId: "google-selfcheck", messages: [] }
    );

    if (res.status === "ok") {
      console.log(
        `Google connector self-check: PASS oauthClientProject=${oauthClientProject} inboxCount=${res.count} (read-only latest 10)`
      );
    } else if (res.code === "service_disabled") {
      console.log(
        `Google connector self-check: API_DISABLED oauthClientProject=${oauthClientProject} errorProject=${res.projectNumber ?? oauthClientProject} enableUrl=${res.enableApiUrl ?? "none"}`
      );
    } else {
      console.log(
        `Google connector self-check: ${String(res.status).toUpperCase()} code=${String(res.code ?? "unknown")} oauthClientProject=${oauthClientProject}`
      );
    }
  } catch (err) {
    console.log(
      `Google connector self-check: WARN oauthClientProject=${oauthClientProject} reason=${err instanceof Error ? err.name : "error"}`
    );
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
  process.exit(0);
}

main();
