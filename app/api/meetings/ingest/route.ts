import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  buildPreMeetingBrief,
  commitApprovedMeetingReview,
  ingestMeetingSession,
} from "@/lib/meetings/meeting-copilot";
import { createPostgresMemoryStore } from "@/lib/memory/store";

const ingestSchema = z.object({
  action: z.enum(["ingest", "approve", "brief"]).default("ingest"),
  meetingTitle: z.string().min(1).max(200).optional(),
  attendees: z.array(z.string().max(120)).max(25).optional(),
  rawTranscript: z.string().min(1).max(60_000).optional(),
  taskId: z.string().min(1).max(120).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid meeting copilot payload" },
      { status: 400 }
    );
  }

  if (parsed.data.action === "brief") {
    const memoryStore = createPostgresMemoryStore();
    const [profileFacts, recentJournal] = await Promise.all([
      memoryStore.listProfileFacts({ userId: session.user.id }).catch(() => []),
      memoryStore
        .listJournalEntries({ userId: session.user.id, limit: 5 })
        .catch(() => []),
    ]);
    const brief = buildPreMeetingBrief({
      meetingTitle: parsed.data.meetingTitle ?? "Upcoming Meeting",
      attendees: parsed.data.attendees,
      profileFacts,
      recentJournal,
    });
    return NextResponse.json(brief);
  }

  if (parsed.data.action === "approve") {
    if (!parsed.data.taskId) {
      return NextResponse.json(
        { error: "taskId is required for approval" },
        { status: 400 }
      );
    }
    try {
      const committed = await commitApprovedMeetingReview({
        userId: session.user.id,
        taskId: parsed.data.taskId,
      });
      return NextResponse.json(committed);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not commit meeting review",
        },
        { status: 400 }
      );
    }
  }

  const result = await ingestMeetingSession({
    userId: session.user.id,
    meetingTitle: parsed.data.meetingTitle ?? "Recorded Meeting",
    rawTranscript: parsed.data.rawTranscript,
  });

  if (result.status !== "awaiting_approval") {
    const status =
      result.status === "blocked_data_boundary"
        ? 403
        : result.status === "setup_required"
          ? 428
          : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 202 });
}
