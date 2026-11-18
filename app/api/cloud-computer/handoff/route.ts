import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { recordScreenHandoffDecision } from "@/lib/cloud-computer/screen-handoff";

const decisionSchema = z.object({
  handoffId: z.string().min(3).max(160),
  decision: z.enum(["im_here", "not_now"]),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof decisionSchema>;
  try {
    parsed = decisionSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid handoff payload" },
      { status: 400 }
    );
  }

  const saved = recordScreenHandoffDecision({
    userId: session.user.id,
    handoffId: parsed.handoffId,
    decision: parsed.decision,
  });

  return NextResponse.json({ status: "ok", ...saved });
}
