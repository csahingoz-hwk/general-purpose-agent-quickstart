import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { createPostgresBotRosterStore } from "@/lib/bots/roster";
import { isMascotVariant } from "@/lib/mascot";

const upsertBotSchema = z.object({
  slug: z.string().trim().min(2).max(64),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).default(""),
  soul: z.string().trim().min(4).max(4000),
  defaultModel: z
    .enum(["gemini-4-hydrogen", "gemini-4-argon"])
    .default("gemini-4-hydrogen"),
  mascotVariant: z
    .string()
    .refine(isMascotVariant, "Invalid mascot variant")
    .default("blue"),
  skillSlugs: z.array(z.string().trim().max(80)).max(8).default([]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bots = await createPostgresBotRosterStore().listBots(session.user.id);
  return NextResponse.json({ bots });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json = await request.json();
    const parsed = upsertBotSchema.parse(json);
    const bot = await createPostgresBotRosterStore().upsertBot({
      userId: session.user.id,
      ...parsed,
    });
    return NextResponse.json({ bot }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not save bot teammate",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug") ?? "";
  if (!slug.trim()) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const deleted = await createPostgresBotRosterStore().deleteCustomBot({
    userId: session.user.id,
    slug,
  });
  return NextResponse.json({ deleted });
}
