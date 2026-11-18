import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import postgres from "postgres";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";

export type VaultErrorCode =
  | "vault_key_missing"
  | "vault_integrity_failed"
  | "vault_invalid_input"
  | "vault_unavailable";

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type VaultSecretMetadata = {
  id: string;
  name: string;
  provider: string;
  keyHint: string;
  createdAt: string;
  updatedAt: string;
};

export interface SecretVaultStore {
  upsertSecret: (opts: {
    userId: string;
    name: string;
    provider?: string;
    plaintext: string;
  }) => Promise<VaultSecretMetadata>;
  listSecrets: (userId: string) => Promise<VaultSecretMetadata[]>;
  deleteSecret: (opts: { userId: string; name: string }) => Promise<boolean>;
  resolveSecret: (opts: {
    userId: string;
    name: string;
  }) => Promise<string | null>;
}

function resolveMasterSecret(rawKey?: string): string {
  const candidate = (
    rawKey ??
    process.env.SECRET_VAULT_KEY ??
    process.env.AUTH_SECRET ??
    ""
  ).trim();
  return candidate === "****" ? "" : candidate;
}

export function isVaultConfigured(rawKey?: string): boolean {
  return resolveMasterSecret(rawKey).length >= 32;
}

function deriveVaultKey(rawKey?: string): Buffer {
  const candidate = resolveMasterSecret(rawKey);
  if (candidate.length < 32) {
    throw new VaultError(
      "vault_key_missing",
      "SECRET_VAULT_KEY or AUTH_SECRET must be at least 32 characters"
    );
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(candidate, "utf8"),
      Buffer.from("assistant-parity-vault-v1", "utf8"),
      Buffer.from("aes-256-gcm", "utf8"),
      32
    )
  );
}

function normalizeSecretName(name: string): string {
  return name.trim().toUpperCase();
}

function aadFor(userId: string, name: string): Buffer {
  return Buffer.from(`${userId}:${normalizeSecretName(name)}`, "utf8");
}

export function maskSecretHint(plaintext: string): string {
  if (plaintext.length <= 4) {
    return "••••";
  }
  return `••••${plaintext.slice(-4)}`;
}

export function encryptSecretPayload({
  userId,
  name,
  plaintext,
  masterKey,
}: {
  userId: string;
  name: string;
  plaintext: string;
  masterKey?: string;
}): {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyHint: string;
} {
  if (!userId.trim() || !name.trim() || !plaintext) {
    throw new VaultError("vault_invalid_input", "Invalid secret input");
  }
  const key = deriveVaultKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(userId, name));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyHint: maskSecretHint(plaintext),
  };
}

export function decryptSecretPayload({
  userId,
  name,
  ciphertext,
  iv,
  authTag,
  masterKey,
}: {
  userId: string;
  name: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  masterKey?: string;
}): string {
  const candidates: Buffer[] = [deriveVaultKey(masterKey)];
  if (
    !masterKey &&
    process.env.SECRET_VAULT_KEY?.trim() &&
    (process.env.AUTH_SECRET?.trim()?.length ?? 0) >= 32 &&
    process.env.SECRET_VAULT_KEY.trim() !== process.env.AUTH_SECRET?.trim()
  ) {
    candidates.push(deriveVaultKey(process.env.AUTH_SECRET));
  }

  for (const key of candidates) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64")
      );
      decipher.setAAD(aadFor(userId, name));
      decipher.setAuthTag(Buffer.from(authTag, "base64"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64")),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch {
      /* try next candidate key */
    }
  }
  throw new VaultError(
    "vault_integrity_failed",
    "Secret failed authenticity verification"
  );
}

type StoredRow = VaultSecretMetadata & {
  userId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
};

function toPublicMetadata(row: StoredRow): VaultSecretMetadata {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    keyHint: row.keyHint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createInMemoryVaultStore(masterKey?: string): SecretVaultStore {
  const rows = new Map<string, StoredRow>();
  const mapKey = (userId: string, name: string) =>
    `${userId}:${normalizeSecretName(name)}`;

  return {
    upsertSecret({ userId, name, provider = "custom", plaintext }) {
      const trimmedName = normalizeSecretName(name);
      const encrypted = encryptSecretPayload({
        userId,
        name: trimmedName,
        plaintext,
        masterKey,
      });
      const existing = rows.get(mapKey(userId, trimmedName));
      const now = new Date().toISOString();
      const stored: StoredRow = {
        id: existing?.id ?? randomUUID(),
        userId,
        name: trimmedName,
        provider: provider.trim() || "custom",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyHint: encrypted.keyHint,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      rows.set(mapKey(userId, trimmedName), stored);
      return Promise.resolve(toPublicMetadata(stored));
    },
    listSecrets(userId) {
      const list = [...rows.values()]
        .filter((row) => row.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(toPublicMetadata);
      return Promise.resolve(list);
    },
    deleteSecret({ userId, name }) {
      return Promise.resolve(rows.delete(mapKey(userId, name)));
    },
    resolveSecret({ userId, name }) {
      const found = rows.get(mapKey(userId, name));
      if (!found) {
        return Promise.resolve(null);
      }
      return Promise.resolve(
        decryptSecretPayload({
          userId,
          name: found.name,
          ciphertext: found.ciphertext,
          iv: found.iv,
          authTag: found.authTag,
          masterKey,
        })
      );
    },
  };
}

let pgClient: ReturnType<typeof postgres> | undefined;
function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new VaultError("vault_unavailable", "POSTGRES_URL is not configured");
  }
  pgClient ??= postgres(process.env.POSTGRES_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 0,
  });
  return pgClient;
}

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

async function readySql() {
  const sql = getSql();
  await ensureParitySchema(sql);
  return sql;
}

export function createPostgresVaultStore(masterKey?: string): SecretVaultStore {
  return {
    async upsertSecret({ userId, name, provider = "custom", plaintext }) {
      const trimmedName = normalizeSecretName(name);
      const encrypted = encryptSecretPayload({
        userId,
        name: trimmedName,
        plaintext,
        masterKey,
      });
      const id = randomUUID();
      try {
        const sql = await readySql();
        const [row] = await sql`
          INSERT INTO "VaultSecret" ("id", "userId", "name", "provider", "ciphertext", "iv", "authTag", "keyHint")
          VALUES (${id}, ${userId}, ${trimmedName}, ${provider.trim() || "custom"}, ${encrypted.ciphertext}, ${encrypted.iv}, ${encrypted.authTag}, ${encrypted.keyHint})
          ON CONFLICT ("userId", "name")
          DO UPDATE SET
            "provider" = EXCLUDED."provider",
            "ciphertext" = EXCLUDED."ciphertext",
            "iv" = EXCLUDED."iv",
            "authTag" = EXCLUDED."authTag",
            "keyHint" = EXCLUDED."keyHint",
            "updatedAt" = now()
          RETURNING "id", "name", "provider", "keyHint", "createdAt", "updatedAt"
        `;
        return {
          id: String(row.id),
          name: String(row.name),
          provider: String(row.provider),
          keyHint: String(row.keyHint),
          createdAt: new Date(row.createdAt).toISOString(),
          updatedAt: new Date(row.updatedAt).toISOString(),
        };
      } catch (error) {
        if (isMissingTable(error)) {
          throw new VaultError(
            "vault_unavailable",
            "VaultSecret table is not provisioned"
          );
        }
        throw error;
      }
    },
    async listSecrets(userId) {
      try {
        const sql = await readySql();
        const rows = await sql`
          SELECT "id", "name", "provider", "keyHint", "createdAt", "updatedAt"
          FROM "VaultSecret"
          WHERE "userId" = ${userId}
          ORDER BY "updatedAt" DESC
        `;
        return rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          provider: String(row.provider),
          keyHint: String(row.keyHint),
          createdAt: new Date(row.createdAt).toISOString(),
          updatedAt: new Date(row.updatedAt).toISOString(),
        }));
      } catch (error) {
        if (isMissingTable(error)) {
          throw new VaultError(
            "vault_unavailable",
            "VaultSecret table is not provisioned"
          );
        }
        throw error;
      }
    },
    async deleteSecret({ userId, name }) {
      try {
        const sql = await readySql();
        const deleted = await sql`
          DELETE FROM "VaultSecret"
          WHERE "userId" = ${userId} AND "name" = ${normalizeSecretName(name)}
          RETURNING "id"
        `;
        return deleted.length > 0;
      } catch (error) {
        if (isMissingTable(error)) {
          throw new VaultError(
            "vault_unavailable",
            "VaultSecret table is not provisioned"
          );
        }
        throw error;
      }
    },
    async resolveSecret({ userId, name }) {
      try {
        const sql = await readySql();
        const [row] = await sql`
          SELECT "name", "ciphertext", "iv", "authTag"
          FROM "VaultSecret"
          WHERE "userId" = ${userId} AND "name" = ${normalizeSecretName(name)}
          LIMIT 1
        `;
        if (!row) {
          return null;
        }
        return decryptSecretPayload({
          userId,
          name: String(row.name),
          ciphertext: String(row.ciphertext),
          iv: String(row.iv),
          authTag: String(row.authTag),
          masterKey,
        });
      } catch (error) {
        if (isMissingTable(error)) {
          throw new VaultError(
            "vault_unavailable",
            "VaultSecret table is not provisioned"
          );
        }
        throw error;
      }
    },
  };
}
