import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { validateAttachmentBuffer } from "@/lib/files/attachment-validator";
import {
  buildSignedFileProxyUrl,
  createSignedFileToken,
} from "@/lib/files/signed-url";
import { getDefaultPrivateFileStore } from "@/lib/files/store";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return NextResponse.json(
      { error: "Request body is empty" },
      { status: 400 }
    );
  }

  try {
    const formData = await request.formData();
    const entry = formData.get("file");

    if (!(entry instanceof Blob)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const rawFilename =
      entry instanceof File && entry.name ? entry.name : "attachment";
    const bytes = new Uint8Array(await entry.arrayBuffer());

    const validation = validateAttachmentBuffer({
      filename: rawFilename,
      declaredType: entry.type,
      bytes,
    });

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    try {
      const store = getDefaultPrivateFileStore();
      const stored = await store.save({
        userId: session.user.id,
        safeName: validation.safeName,
        contentType: validation.mediaType,
        bytes,
      });

      const token = createSignedFileToken({
        uid: session.user.id,
        fid: stored.fileId,
        name: validation.safeName,
        ct: validation.mediaType,
        size: validation.size,
        ref: stored.storageRef,
      });

      const requestUrl = new URL(request.url);
      const proxyUrl = buildSignedFileProxyUrl({
        origin: requestUrl.origin,
        basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
        token,
      });

      return NextResponse.json({
        url: proxyUrl,
        pathname: validation.safeName,
        contentType: validation.mediaType,
        size: validation.size,
      });
    } catch (_error) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
