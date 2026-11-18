import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import { IMPORT_MEMORY_SOURCES } from "@/lib/memory/bulk-import";
import { mergeMemoryExports } from "@/lib/memory/multi-source-merge";
import {
  createPostgresMemoryStore,
  MemoryStoreUnavailableError,
  type ProfileFact,
} from "@/lib/memory/store";

export const maxDuration = 300;

const mergeRequestSchema = z.object({
  sources: z
    .array(
      z.object({
        id: z.string().max(80).optional(),
        source: z.enum(IMPORT_MEMORY_SOURCES).default("pasted"),
        rawText: z.string().max(250_000),
        fileName: z.string().max(200).optional(),
        exportedAt: z.string().max(64).optional(),
      })
    )
    .min(1)
    .max(12),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof mergeRequestSchema>;
  try {
    body = mergeRequestSchema.parse(await request.json());
  } catch {
    return Response.json(
      { error: "Invalid memory import payload" },
      { status: 400 }
    );
  }

  const nonEmptySources = body.sources.filter(
    (s) => s.rawText.trim().length > 0
  );
  if (nonEmptySources.length === 0) {
    return Response.json(
      { error: "Paste or upload at least one memory export." },
      { status: 400 }
    );
  }

  let existingFacts: ProfileFact[] = [];
  try {
    const store = createPostgresMemoryStore();
    existingFacts = await store.listProfileFacts({ userId: session.user.id });
  } catch (error) {
    if (!(error instanceof MemoryStoreUnavailableError)) {
      existingFacts = [];
    }
  }

  const wantsStream = (request.headers.get("accept") ?? "").includes(
    "application/x-ndjson"
  );

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const writeObj = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        };
        try {
          const result = await mergeMemoryExports({
            sources: nonEmptySources,
            existingFacts,
            onProgress: (progress) => {
              writeObj({ type: "progress", ...progress });
            },
          });
          writeObj({ type: "result", data: result });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "unknown_error";
          console.error("memory multi-source merge error", { msg });
          writeObj({
            type: "error",
            error:
              "Could not complete the memory merge right now. Nothing was charged or saved — please tap Merge & preview again.",
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  try {
    const result = await mergeMemoryExports({
      sources: nonEmptySources,
      existingFacts,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown_error";
    console.error("memory multi-source merge error", { msg });
    return Response.json(
      {
        error:
          "Could not complete the memory merge right now. Nothing was charged or saved — please tap Merge & preview again.",
      },
      { status: 503 }
    );
  }
}
