import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  generateImageWithImagen,
  generateVideoWithVeo,
  isMediaStudioEnabled,
} from "@/lib/media/media-studio";

const generateRequestSchema = z.object({
  kind: z.enum(["image", "video"]),
  prompt: z.string().min(3).max(1600),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).optional(),
});

export async function POST(request: Request) {
  if (!isMediaStudioEnabled()) {
    return NextResponse.json(
      {
        error: "Image and video generation is turned off right now.",
      },
      { status: 503 }
    );
  }

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

  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid media generation request" },
      { status: 400 }
    );
  }

  if (parsed.data.kind === "image") {
    const result = await generateImageWithImagen({
      userId: session.user.id,
      prompt: parsed.data.prompt,
      aspectRatio: parsed.data.aspectRatio,
    });
    const status =
      result.status === "ok"
        ? 200
        : result.status === "blocked_data_boundary"
          ? 403
          : result.status === "spend_cap_exceeded"
            ? 429
            : result.status === "setup_required"
              ? 428
              : 502;
    if (result.status === "ok") {
      // Omit raw base64Png from REST response payload when signed fileUrl is available
      const { base64Png: _omitted, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(result, { status });
  }

  const videoAspect =
    parsed.data.aspectRatio === "9:16" ? "9:16" : ("16:9" as const);
  const result = await generateVideoWithVeo({
    userId: session.user.id,
    prompt: parsed.data.prompt,
    aspectRatio: videoAspect,
  });
  const status =
    result.status === "queued"
      ? 202
      : result.status === "blocked_data_boundary"
        ? 403
        : result.status === "spend_cap_exceeded"
          ? 429
          : result.status === "setup_required"
            ? 428
            : 502;
  return NextResponse.json(result, { status });
}
