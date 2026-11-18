import { config } from "dotenv";
import postgres from "postgres";
import { createGoogleConnectorTools } from "@/lib/ai/tools/google-connectors";
import { probeGoogleWorkspaceApiHealth } from "@/lib/connectors/google-health";
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

    const health = await probeGoogleWorkspaceApiHealth({
      userId: ownerId,
      forceRefresh: true,
    });
    const tools = createGoogleConnectorTools({ userId: ownerId });
    // Execute gmailReadMessages({}) end-to-end (defaults to latest 10 inbox messages, read-only).
    // Never log message subjects, senders, bodies, client IDs, or tokens.
    const res = await (tools.gmailReadMessages as any).execute(
      {},
      { toolCallId: "google-selfcheck", messages: [] }
    );

    if (res.status === "ok" && health.status === "ready") {
      console.log(
        `Google connector self-check: PASS oauthClientProject=${oauthClientProject} health=ready(gmail,calendar,drive) gmailReadMessages=ok(inboxCount=${res.count})`
      );
    } else if (health.status === "service_disabled") {
      console.log(
        `Google connector self-check: API_DISABLED oauthClientProject=${oauthClientProject} disabled=${health.disabledServices.join(",")} setupChecklistUrl=${health.enableApiUrl}`
      );
    } else {
      console.log(
        `Google connector self-check: ${String(res.status).toUpperCase()} health=${health.status} code=${String(res.code ?? "none")} oauthClientProject=${oauthClientProject} inboxCount=${String(res.count ?? 0)}`
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
