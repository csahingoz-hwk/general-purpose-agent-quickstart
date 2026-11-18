import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { resolveApprovalPreferencesStore } from "@/lib/safety/approval-preferences";

const updateSettingsSchema = z.object({
  approvalMode: z.enum(["ask_every_time", "draft_without_asking"]).optional(),
  uiLocale: z.enum(["auto", "en", "tr"]).optional(),
});

const upsertRuleSchema = z.object({
  toolName: z.string().trim().min(2).max(80),
  decision: z.enum(["always_allow", "never_allow"]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = resolveApprovalPreferencesStore();
  const [settings, rules] = await Promise.all([
    store.getSettings(session.user.id).catch(() => ({
      userId: session.user.id,
      approvalMode: "ask_every_time" as const,
      uiLocale: "auto" as const,
      updatedAt: new Date(0).toISOString(),
    })),
    store.listToolRules(session.user.id).catch(() => []),
  ]);

  return NextResponse.json(
    {
      approvalMode: settings.approvalMode,
      uiLocale: settings.uiLocale,
      rules,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof updateSettingsSchema>;
  try {
    parsed = updateSettingsSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  }

  const store = resolveApprovalPreferencesStore();
  const updated = await store.updateSettings({
    userId: session.user.id,
    approvalMode: parsed.approvalMode,
    uiLocale: parsed.uiLocale,
  });

  return NextResponse.json({
    approvalMode: updated.approvalMode,
    uiLocale: updated.uiLocale,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof upsertRuleSchema>;
  try {
    parsed = upsertRuleSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid rule" }, { status: 400 });
  }

  const store = resolveApprovalPreferencesStore();
  const rule = await store.setToolRule({
    userId: session.user.id,
    toolName: parsed.toolName,
    decision: parsed.decision,
  });

  return NextResponse.json({ rule }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const toolName = searchParams.get("toolName")?.trim();
  if (!toolName) {
    return NextResponse.json({ error: "toolName required" }, { status: 400 });
  }

  const store = resolveApprovalPreferencesStore();
  const deleted = await store.deleteToolRule({
    userId: session.user.id,
    toolName,
  });

  return NextResponse.json({ deleted, toolName });
}
