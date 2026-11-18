import { randomUUID } from "node:crypto";
import { HYDROGEN, LUNA, vertexEnabled } from "@/lib/ai/routing/catalog";
import { createUsageLedger, type UsageLedger } from "@/lib/ai/routing/ledger";
import { ModelFailure } from "@/lib/ai/routing/policy";
import {
  getVertexProjectId,
  getVertexWifAccessToken,
} from "@/lib/ai/vertex-auth";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { createSignedFileToken } from "@/lib/files/signed-url";
import {
  getDefaultPrivateFileStore,
  type PrivateFileStore,
} from "@/lib/files/store";
import {
  type BackgroundTaskRecord,
  type BackgroundTaskStore,
  createPostgresTaskStore,
} from "@/lib/tasks/runner";
import {
  createPostgresVaultStore,
  type SecretVaultStore,
  VaultError,
} from "@/lib/vault/secret-vault";

export const DEFAULT_IMAGEN_MODEL = "imagen-4.0-generate-001";
export const DEFAULT_VEO_MODEL = "veo-2.0-generate-001";

/**
 * Conservative USD spend reservations charged against the owner's ModelUsage
 * monthly allowance BEFORE calling upstream Imagen / Veo endpoints.
 */
export const IMAGE_RESERVE_USD = 0.04;
export const VIDEO_RESERVE_USD = 0.35;

export const MEDIA_VAULT_SECRET_NAME = "GEMINI_API_KEY";

export function isMediaStudioEnabled(): boolean {
  return process.env.MEDIA_STUDIO_ENABLED !== "false";
}

export function resolveImagenModelName(): string {
  const configured = (process.env.GEMINI_IMAGEN_MODEL ?? "").trim();
  if (!configured) {
    return DEFAULT_IMAGEN_MODEL;
  }
  if (/gemini-3\.\d|3\.8/i.test(configured)) {
    throw new Error(
      "Blocked media model configuration: 3.x Gemini models are disallowed by owner policy."
    );
  }
  return configured;
}

export function resolveVeoModelName(): string {
  const configured = (process.env.GEMINI_VEO_MODEL ?? "").trim();
  if (!configured) {
    return DEFAULT_VEO_MODEL;
  }
  if (/gemini-3\.\d|3\.8/i.test(configured)) {
    throw new Error(
      "Blocked media model configuration: 3.x Gemini models are disallowed by owner policy."
    );
  }
  return configured;
}

async function readGeminiKeyFromVault(
  userId: string,
  vaultStore?: SecretVaultStore
): Promise<string | null> {
  if (!vaultStore && process.env.GEMINI_API_KEY?.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  const store = vaultStore ?? createPostgresVaultStore();
  try {
    const val = await store.resolveSecret({
      userId,
      name: MEDIA_VAULT_SECRET_NAME,
    });
    return val?.trim() ? val.trim() : null;
  } catch (error) {
    if (error instanceof VaultError) {
      return null;
    }
    throw error;
  }
}

export type ImageGenerationResult =
  | {
      status: "ok";
      kind: "image";
      model: string;
      prompt: string;
      base64Png: string;
      fileId: string;
      fileUrl: string;
      reservedUsd: number;
      reservationId: string;
    }
  | {
      status: "blocked_data_boundary" | "setup_required" | "spend_cap_exceeded";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

export async function generateImageWithImagen(opts: {
  userId: string;
  prompt: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3";
  requestId?: string;
  ledger?: UsageLedger;
  vaultStore?: SecretVaultStore;
  fileStore?: PrivateFileStore;
  signingSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<ImageGenerationResult> {
  const trimmedPrompt = opts.prompt.trim();
  if (!trimmedPrompt || trimmedPrompt.length > 1600) {
    return {
      status: "error",
      message: "Image prompt must be between 1 and 1600 characters.",
    };
  }

  // Hard owner data-governance rule: Korn Ferry / employer material never leaves for personal Google APIs.
  if (containsRestrictedWorkData(trimmedPrompt)) {
    return {
      status: "blocked_data_boundary",
      message:
        "Blocked by data-governance rule: employer or restricted work prompts cannot be sent to personal Google media endpoints.",
    };
  }

  const model = resolveImagenModelName();
  const geminiKey = opts.vaultStore
    ? await readGeminiKeyFromVault(opts.userId, opts.vaultStore)
    : null;
  const useVertex = !geminiKey && vertexEnabled();
  const fallbackVaultKey =
    !geminiKey && !useVertex
      ? await readGeminiKeyFromVault(opts.userId, opts.vaultStore)
      : geminiKey;
  if (!useVertex && !fallbackVaultKey) {
    return {
      status: "setup_required",
      message: "Image generation isn't active on this server yet.",
    };
  }

  const ledger =
    opts.ledger ??
    createUsageLedger(opts.userId, opts.requestId ?? randomUUID());

  let reservationId: string;
  try {
    reservationId = await ledger.reserve({
      model: useVertex ? HYDROGEN : LUNA,
      reserveUsd: useVertex ? 0 : IMAGE_RESERVE_USD,
      fallbackReason: "media:imagen",
    });
  } catch (error) {
    if (error instanceof ModelFailure || error instanceof Error) {
      return {
        status: "spend_cap_exceeded",
        message:
          "Monthly AI spend allowance reached or ledger unavailable; image generation aborted before upstream API call.",
      };
    }
    throw error;
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  if (useVertex) {
    try {
      const projectId = getVertexProjectId();
      const accessToken = await getVertexWifAccessToken(fetchFn);
      if (!projectId) {
        throw new Error("vertex_project_missing");
      }
      const vertexEndpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/us-central1/publishers/google/models/${encodeURIComponent(model)}:predict`;
      const response = await fetchFn(vertexEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          instances: [{ prompt: trimmedPrompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: opts.aspectRatio ?? "1:1",
            outputOptions: { mimeType: "image/png" },
          },
        }),
      });
      if (!response.ok) {
        await ledger
          .settle(
            reservationId,
            HYDROGEN,
            "media_imagen_http_error",
            undefined,
            0
          )
          .catch(() => null);
        return {
          status: "error",
          message: `Imagen generation failed with HTTP ${response.status}.`,
        };
      }
      const payload = (await response.json()) as {
        predictions?: Array<{ bytesBase64Encoded?: string }>;
      };
      const base64Png = payload.predictions?.[0]?.bytesBase64Encoded?.trim();
      if (!base64Png) {
        await ledger
          .settle(reservationId, HYDROGEN, "media_imagen_empty", undefined, 0)
          .catch(() => null);
        return {
          status: "error",
          message: "Imagen response did not include encoded PNG bytes.",
        };
      }
      const bytes = new Uint8Array(Buffer.from(base64Png, "base64"));
      const fileStore = opts.fileStore ?? getDefaultPrivateFileStore();
      const safeName = "generated-image.png";
      const saved = await fileStore.save({
        userId: opts.userId,
        safeName,
        contentType: "image/png",
        bytes,
      });
      const signedToken = createSignedFileToken({
        uid: opts.userId,
        fid: saved.fileId,
        name: safeName,
        ct: "image/png",
        size: bytes.byteLength,
        ref: saved.storageRef,
        secret: opts.signingSecret,
      });
      await ledger.settle(reservationId, HYDROGEN, "media_imagen_ok");
      return {
        status: "ok",
        kind: "image",
        model,
        prompt: trimmedPrompt,
        base64Png,
        fileId: saved.fileId,
        fileUrl: `/api/files/${encodeURIComponent(signedToken)}`,
        reservedUsd: 0,
        reservationId,
      };
    } catch {
      await ledger
        .settle(reservationId, HYDROGEN, "media_imagen_exception", undefined, 0)
        .catch(() => null);
      return {
        status: "error",
        message: "Image generation could not complete right now.",
      };
    }
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:predict`;
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": fallbackVaultKey ?? "",
      },
      body: JSON.stringify({
        instances: [{ prompt: trimmedPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: opts.aspectRatio ?? "1:1",
          outputOptions: { mimeType: "image/png" },
        },
      }),
    });

    if (!response.ok) {
      await ledger
        .settle(reservationId, LUNA, "media_imagen_http_error", undefined, 0)
        .catch(() => null);
      return {
        status: "error",
        message: `Imagen generation failed with HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string }>;
    };
    const base64Png = payload.predictions?.[0]?.bytesBase64Encoded?.trim();
    if (!base64Png) {
      await ledger
        .settle(reservationId, LUNA, "media_imagen_empty", undefined, 0)
        .catch(() => null);
      return {
        status: "error",
        message: "Imagen response did not include encoded PNG bytes.",
      };
    }

    const bytes = new Uint8Array(Buffer.from(base64Png, "base64"));
    const fileStore = opts.fileStore ?? getDefaultPrivateFileStore();
    const safeName = "generated-image.png";
    const saved = await fileStore.save({
      userId: opts.userId,
      safeName,
      contentType: "image/png",
      bytes,
    });

    const signedToken = createSignedFileToken({
      uid: opts.userId,
      fid: saved.fileId,
      name: safeName,
      ct: "image/png",
      size: bytes.byteLength,
      ref: saved.storageRef,
      secret: opts.signingSecret,
    });
    const fileUrl = `/api/files/${encodeURIComponent(signedToken)}`;

    // Settle without token usage so settledEstimate stays null and the full
    // IMAGE_RESERVE_USD reservation remains counted in ModelUsage.
    await ledger.settle(reservationId, LUNA, "media_imagen_ok");

    return {
      status: "ok",
      kind: "image",
      model,
      prompt: trimmedPrompt,
      base64Png,
      fileId: saved.fileId,
      fileUrl,
      reservedUsd: IMAGE_RESERVE_USD,
      reservationId,
    };
  } catch {
    await ledger
      .settle(reservationId, LUNA, "media_imagen_exception", undefined, 0)
      .catch(() => null);
    return {
      status: "error",
      message: "Unexpected network error while calling Imagen endpoint.",
    };
  }
}

export type VideoGenerationResult =
  | {
      status: "queued";
      kind: "video";
      model: string;
      prompt: string;
      task: BackgroundTaskRecord;
      operationName: string;
      reservedUsd: number;
      reservationId: string;
    }
  | {
      status: "blocked_data_boundary" | "setup_required" | "spend_cap_exceeded";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

export async function generateVideoWithVeo(opts: {
  userId: string;
  prompt: string;
  aspectRatio?: "16:9" | "9:16";
  requestId?: string;
  ledger?: UsageLedger;
  vaultStore?: SecretVaultStore;
  taskStore?: BackgroundTaskStore;
  fetchImpl?: typeof fetch;
}): Promise<VideoGenerationResult> {
  const trimmedPrompt = opts.prompt.trim();
  if (!trimmedPrompt || trimmedPrompt.length > 1600) {
    return {
      status: "error",
      message: "Video prompt must be between 1 and 1600 characters.",
    };
  }

  if (containsRestrictedWorkData(trimmedPrompt)) {
    return {
      status: "blocked_data_boundary",
      message:
        "Blocked by data-governance rule: employer or restricted work prompts cannot be sent to personal Google media endpoints.",
    };
  }

  const model = resolveVeoModelName();
  const geminiKey = await readGeminiKeyFromVault(opts.userId, opts.vaultStore);
  if (!geminiKey) {
    return {
      status: "setup_required",
      message:
        "Veo video generation is optional — open /setup to create a key if needed.",
    };
  }

  const ledger =
    opts.ledger ??
    createUsageLedger(opts.userId, opts.requestId ?? randomUUID());

  let reservationId: string;
  try {
    reservationId = await ledger.reserve({
      model: LUNA,
      reserveUsd: VIDEO_RESERVE_USD,
      fallbackReason: "media:veo",
    });
  } catch (error) {
    if (error instanceof ModelFailure || error instanceof Error) {
      return {
        status: "spend_cap_exceeded",
        message:
          "Monthly AI spend allowance reached or ledger unavailable; video generation aborted before upstream API call.",
      };
    }
    throw error;
  }

  const taskStore = opts.taskStore ?? createPostgresTaskStore();
  let operationName = `operations/veo-staged-${randomUUID().slice(0, 8)}`;

  if (opts.fetchImpl) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:predictLongRunning`;
    const response = await opts.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": geminiKey ?? "",
      },
      body: JSON.stringify({
        instances: [{ prompt: trimmedPrompt }],
        parameters: {
          aspectRatio: opts.aspectRatio ?? "16:9",
          durationSeconds: 5,
        },
      }),
    });
    if (!response.ok) {
      await ledger
        .settle(reservationId, LUNA, "media_veo_http_error", undefined, 0)
        .catch(() => null);
      return {
        status: "error",
        message: `Veo video operation failed with HTTP ${response.status}.`,
      };
    }
    const body = (await response.json()) as { name?: string };
    if (body.name?.trim()) {
      operationName = body.name.trim();
    }
  }

  let task = await taskStore.enqueueTask({
    userId: opts.userId,
    kind: "media_gen",
    title: `Veo clip: ${trimmedPrompt.slice(0, 64)}`,
    prompt: trimmedPrompt,
    riskLevel: "medium",
  });

  task =
    (await taskStore.transitionTask({
      userId: opts.userId,
      id: task.id,
      status: "running",
      stepMessage: `Routed Veo generation (${model}, op=${operationName}) off 8 GB Mac mini to Google API / Cloud Run poller.`,
      output: JSON.stringify(
        {
          kind: "video",
          model,
          operationName,
          aspectRatio: opts.aspectRatio ?? "16:9",
          reservedUsd: VIDEO_RESERVE_USD,
          reservationId,
        },
        null,
        2
      ),
    })) ?? task;

  await ledger.settle(reservationId, LUNA, "media_veo_queued");

  return {
    status: "queued",
    kind: "video",
    model,
    prompt: trimmedPrompt,
    task,
    operationName,
    reservedUsd: VIDEO_RESERVE_USD,
    reservationId,
  };
}
