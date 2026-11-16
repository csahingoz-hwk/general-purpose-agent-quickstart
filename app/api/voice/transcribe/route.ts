import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  transcribeVoiceMemo,
  validateAudioUpload,
} from "@/lib/voice/voice-service";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await audio.arrayBuffer());
    const validated = validateAudioUpload({
      declaredType: audio.type,
      bytes,
    });

    if (!validated.valid) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const result = await transcribeVoiceMemo({
      userId: session.user.id,
      mimeType: validated.mimeType,
      bytes,
    });

    if (result.status === "setup_required") {
      return NextResponse.json(result, { status: 503 });
    }
    if (result.status === "blocked_data_boundary") {
      return NextResponse.json(result, { status: 422 });
    }
    if (result.status === "error") {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to process voice memo" },
      { status: 500 }
    );
  }
}
