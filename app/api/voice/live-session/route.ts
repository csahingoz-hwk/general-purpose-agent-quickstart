import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { createLiveVoiceSessionDescriptor } from "@/lib/voice/voice-service";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const descriptor = await createLiveVoiceSessionDescriptor({
      userId: session.user.id,
    });
    return NextResponse.json(descriptor, {
      status: descriptor.status === "ready" ? 200 : 503,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to initialize live voice session",
      },
      { status: 400 }
    );
  }
}
