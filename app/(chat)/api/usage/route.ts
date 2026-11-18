import { auth } from "@/app/(auth)/auth";
import { clearSetupStatusCache } from "@/app/api/setup-status/route";
import { MAX_MONTHLY_ALLOWANCE_USD } from "@/lib/ai/routing/catalog";
import { saveOwnerAllowanceUsd, usageSummary } from "@/lib/ai/routing/ledger";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await usageSummary(session.user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Usage tracking is not set up yet. Chat remains paused until it is ready.",
      },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { allowanceUsd?: unknown } = {};
  try {
    body = (await request.json()) as { allowanceUsd?: unknown };
  } catch {
    return Response.json(
      { error: "Invalid request payload." },
      { status: 400 }
    );
  }
  const value = Number(body.allowanceUsd);
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_MONTHLY_ALLOWANCE_USD
  ) {
    return Response.json(
      {
        error: `Enter a monthly safety cap between $0.01 and $${MAX_MONTHLY_ALLOWANCE_USD}.`,
      },
      { status: 400 }
    );
  }
  try {
    const allowanceUsd = await saveOwnerAllowanceUsd(session.user.id, value);
    clearSetupStatusCache(session.user.id);
    return Response.json({ allowanceUsd });
  } catch {
    return Response.json(
      { error: "Could not save monthly safety cap." },
      { status: 500 }
    );
  }
}
