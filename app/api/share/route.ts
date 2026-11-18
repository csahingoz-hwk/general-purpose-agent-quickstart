import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { createPostgresPublishedPageStore } from "@/lib/share/published-pages";

const publishSchema = z.object({
  title: z.string().trim().min(1).max(140),
  items: z
    .array(
      z.object({
        kind: z.enum(["openui", "fixture", "weather", "document", "summary"]),
        title: z.string().trim().min(1).max(160),
        subtitle: z.string().trim().max(200).default(""),
        bodyText: z.string().max(8000).optional(),
      })
    )
    .min(1)
    .max(25),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pages = await createPostgresPublishedPageStore().listForOwner(
    session.user.id
  );
  return NextResponse.json({ pages });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json = await request.json();
    const parsed = publishSchema.parse(json);
    const created = await createPostgresPublishedPageStore().publish({
      userId: session.user.id,
      title: parsed.title,
      items: parsed.items,
      ownerEmailToScrub: session.user.email,
    });
    const reqUrl = new URL(request.url);
    const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
    return NextResponse.json(
      {
        url: `${reqUrl.origin}${base}/share/${created.token}`,
        page: created.page,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to publish snapshot",
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
  const id = searchParams.get("id") ?? "";
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Invalid snapshot id" }, { status: 400 });
  }

  const revoked = await createPostgresPublishedPageStore().revoke({
    userId: session.user.id,
    id,
  });
  return NextResponse.json({ revoked });
}
