import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  buildPrivateFileHttpResponse,
  resolveFileDisposition,
} from "@/lib/files/http-response";
import { verifySignedFileToken } from "@/lib/files/signed-url";
import { getDefaultPrivateFileStore } from "@/lib/files/store";

export async function GET(
  request: Request,
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

  const dispositionParam = new URL(request.url).searchParams.get("disposition");
  const disposition = resolveFileDisposition(dispositionParam, payload.ct);

  return buildPrivateFileHttpResponse({
    bytes,
    filename: payload.name,
    contentType: payload.ct,
    disposition,
  });
}
