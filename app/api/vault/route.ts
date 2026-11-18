import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isOwnerIdentity } from "@/lib/access-policy";
import {
  createPostgresVaultStore,
  isVaultConfigured,
  VaultError,
} from "@/lib/vault/secret-vault";

const upsertSecretSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[A-Za-z0-9._-]+$/),
  provider: z.string().trim().min(1).max(64).default("custom"),
  plaintext: z.string().min(1).max(8192),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isVaultConfigured()) {
    return Response.json({ status: "key_missing", secrets: [] });
  }

  try {
    const store = createPostgresVaultStore();
    const secrets = await store.listSecrets(session.user.id);
    return Response.json({ status: "ready", secrets });
  } catch (error) {
    if (error instanceof VaultError && error.code === "vault_unavailable") {
      return Response.json({ status: "setup_required", secrets: [] });
    }
    return Response.json(
      { error: "Secret vault is currently unavailable" },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isVaultConfigured()) {
    return Response.json(
      { error: "SECRET_VAULT_KEY is not configured" },
      { status: 503 }
    );
  }

  let parsed: z.infer<typeof upsertSecretSchema>;
  try {
    parsed = upsertSecretSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid secret payload" }, { status: 400 });
  }

  try {
    const store = createPostgresVaultStore();
    const saved = await store.upsertSecret({
      userId: session.user.id,
      name: parsed.name,
      provider: parsed.provider,
      plaintext: parsed.plaintext,
    });
    return Response.json({ secret: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof VaultError && error.code === "vault_unavailable") {
      return Response.json(
        { error: "VaultSecret table requires parity-schema.sql setup" },
        { status: 503 }
      );
    }
    return Response.json({ error: "Could not store secret" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user || !isOwnerIdentity(session.user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (!name) {
    return Response.json({ error: "Missing secret name" }, { status: 400 });
  }

  try {
    const store = createPostgresVaultStore();
    const deleted = await store.deleteSecret({
      userId: session.user.id,
      name,
    });
    if (!deleted) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ deleted: true, name });
  } catch {
    return Response.json({ error: "Could not delete secret" }, { status: 503 });
  }
}
