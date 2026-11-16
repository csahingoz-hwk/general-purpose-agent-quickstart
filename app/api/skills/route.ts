import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import {
  BUILT_IN_SKILLS,
  createPostgresSkillStore,
  normalizeSkillSlug,
  SkillStoreUnavailableError,
} from "@/lib/skills/library";

const upsertSkillSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .refine((s) => normalizeSkillSlug(s).length >= 2, {
      message: "Slug must contain at least 2 alphanumeric characters",
    }),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(4).max(280),
  instructions: z.string().trim().min(10).max(2000),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const store = createPostgresSkillStore();
    const skills = await store.listSkills(session.user.id);
    return Response.json({ skills });
  } catch {
    return Response.json({ skills: BUILT_IN_SKILLS });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof upsertSkillSchema>;
  try {
    parsed = upsertSkillSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid skill payload" }, { status: 400 });
  }

  try {
    const store = createPostgresSkillStore();
    const skill = await store.upsertSkill({
      userId: session.user.id,
      ...parsed,
    });
    return Response.json({ skill }, { status: 201 });
  } catch (error) {
    if (error instanceof SkillStoreUnavailableError) {
      return Response.json(
        { error: "Custom skills require applying lib/db/parity-schema.sql" },
        { status: 503 }
      );
    }
    return Response.json({ error: "Could not save skill" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = new URL(request.url).searchParams.get("slug")?.trim() ?? "";
  if (!slug) {
    return Response.json({ error: "Missing skill slug" }, { status: 400 });
  }

  try {
    const store = createPostgresSkillStore();
    const deleted = await store.deleteSkill({ userId: session.user.id, slug });
    if (!deleted) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ deleted: true, slug });
  } catch {
    return Response.json({ error: "Could not delete skill" }, { status: 503 });
  }
}
