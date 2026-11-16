import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { runWorktreeCoderTask } from "@/lib/subagents/worktree-coder";
import {
  createPostgresTaskStore,
  TaskStoreUnavailableError,
} from "@/lib/tasks/runner";

const coderTaskSchema = z.object({
  title: z.string().trim().min(2).max(160),
  prompt: z.string().trim().min(4).max(4000),
  targetBranch: z.string().trim().min(4).max(80),
  baseRef: z.string().trim().max(80).default("HEAD"),
  requestPush: z.boolean().default(true),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = coderTaskSchema.parse(await request.json());
    const task = await runWorktreeCoderTask({
      store: createPostgresTaskStore(),
      userId: session.user.id,
      title: parsed.title,
      prompt: parsed.prompt,
      targetBranch: parsed.targetBranch,
      baseRef: parsed.baseRef,
      requestPush: parsed.requestPush,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof TaskStoreUnavailableError) {
      return NextResponse.json(
        { error: "BackgroundTask table requires parity-schema.sql setup" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Invalid coding subagent request",
      },
      { status: 400 }
    );
  }
}
