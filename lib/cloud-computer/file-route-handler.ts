import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import {
  cloudReadWorkspaceFile,
  isCloudComputerConfigured,
  resolveSafeWorkspacePath,
} from "@/lib/cloud-computer/client";
import { resolveCloudLifecycleStore } from "@/lib/cloud-computer/lifecycle";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import {
  inferPrivateFileMediaType,
  sanitizeAttachmentFilename,
} from "@/lib/files/attachment-validator";
import {
  buildPrivateFileHttpResponse,
  resolveFileDisposition,
} from "@/lib/files/http-response";

export async function handleCloudComputerFileGet(
  request: Request,
  deps?: {
    getSession?: () => Promise<Session | null>;
    relayUrl?: string;
    hmacSecret?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<Response> {
  const session = deps?.getSession ? await deps.getSession() : null;
  if (!session?.user?.id || session.user.type === "guest") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path")?.trim() ?? "";
  if (!rawPath) {
    return NextResponse.json({ error: "Missing file path" }, { status: 400 });
  }

  let safePath: string;
  try {
    safePath = resolveSafeWorkspacePath(rawPath);
  } catch {
    return NextResponse.json(
      { error: "Invalid workspace path" },
      { status: 403 }
    );
  }

  if (
    containsRestrictedWorkData(safePath) ||
    containsRestrictedWorkData(safePath.replace(/[_-]+/g, " "))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!deps?.relayUrl && !isCloudComputerConfigured()) {
    return NextResponse.json(
      { error: "Cloud Computer is not configured" },
      { status: 503 }
    );
  }

  try {
    const lifecycle = resolveCloudLifecycleStore();
    await lifecycle
      .ensureAwakeForTask({ userId: session.user.id })
      .catch(() => null);
    const read = await cloudReadWorkspaceFile({
      path: safePath,
      relayUrl: deps?.relayUrl,
      hmacSecret: deps?.hmacSecret,
      fetchImpl: deps?.fetchImpl,
    });
    await lifecycle
      .recordActivity({ userId: session.user.id })
      .catch(() => null);

    const bytes = new Uint8Array(Buffer.from(read.base64, "base64"));
    const safeName = sanitizeAttachmentFilename(safePath);
    const contentType = inferPrivateFileMediaType(safeName);

    if (
      contentType.startsWith("text/") ||
      contentType === "application/json" ||
      contentType === "image/svg+xml"
    ) {
      const sample = Buffer.from(bytes.subarray(0, 65_536)).toString("utf8");
      if (containsRestrictedWorkData(sample)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const disposition = resolveFileDisposition(
      url.searchParams.get("disposition"),
      contentType
    );

    return buildPrivateFileHttpResponse({
      bytes,
      filename: safeName,
      contentType,
      disposition,
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
