import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { runBrowserSubagentTask } from "@/lib/subagents/browser-agent";
import {
  createPostgresTaskStore,
  TaskStoreUnavailableError,
} from "@/lib/tasks/runner";

const browserTaskSchema = z.object({
  title: z.string().trim().min(2).max(160),
  allowedDomains: z.array(z.string().trim().min(3).max(120)).min(1).max(10),
  steps: z
    .array(
      z.object({
        url: z.string().url().max(1024),
        action: z.enum([
          "navigate",
          "click",
          "type",
          "submit",
          "scroll",
          "extract",
        ]),
        selector: z.string().max(240).optional(),
        inputValue: z.string().max(500).optional(),
        domContextSnippet: z.string().max(1000).optional(),
      })
    )
    .min(1)
    .max(15),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = browserTaskSchema.parse(await request.json());
    const task = await runBrowserSubagentTask({
      store: createPostgresTaskStore(),
      userId: session.user.id,
      title: parsed.title,
      allowedDomains: parsed.allowedDomains,
      steps: parsed.steps,
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
            : "Invalid browser subagent request",
      },
      { status: 400 }
    );
  }
}
