import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { verifySignedFileToken } from "@/lib/files/signed-url";
import { getDefaultPrivateFileStore } from "@/lib/files/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await context.params;
  if (!token) {
    return NextResponse.json({ error: "Missing file token" }, { status: 400 });
  }

  const verified = verifySignedFileToken(token, {
    expectedUserId: session.user.id,
  });

  if (!verified.valid) {
    if (verified.reason === "secret_missing") {
      return NextResponse.json(
        { error: "File proxy is not configured" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { payload } = verified;
  const store = getDefaultPrivateFileStore();
  const bytes = await store.read({
    userId: session.user.id,
    fileId: payload.fid,
    contentType: payload.ct,
    storageRef: payload.ref,
  });

  if (!bytes) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const dispositionType = payload.ct.startsWith("image/")
    ? "inline"
    : "attachment";
  const safeFilename = payload.name.replace(/["\\\r\n]/g, "_");

  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": payload.ct,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${dispositionType}; filename="${safeFilename}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
