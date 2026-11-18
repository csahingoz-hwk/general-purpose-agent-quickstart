import { auth } from "@/app/(auth)/auth";
import { usageSummary } from "@/lib/ai/routing/ledger";

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
        timezone: "UTC",
        totalInputTokens: 0,
        totalOutputTokens: 0,
        invocations: 0,
        requests: 0,
        fallbackInvocations: 0,
        calls: [],
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
