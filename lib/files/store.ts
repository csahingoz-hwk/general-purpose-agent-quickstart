import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import { ensureParitySchema } from "@/lib/db/ensure-parity-schema";
import { getSharedPostgresClient } from "@/lib/db/shared-pool";
import type { ExportedPrivateFileMediaType } from "./attachment-validator";

export type StoredPrivateFile = {
  fileId: string;
  storageRef: string;
};

export interface PrivateFileStore {
  save: (opts: {
    userId: string;
    safeName: string;
    contentType: ExportedPrivateFileMediaType;
    bytes: Uint8Array;
  }) => Promise<StoredPrivateFile>;
  read: (opts: {
    userId: string;
    fileId: string;
    contentType: ExportedPrivateFileMediaType;
    storageRef: string;
  }) => Promise<Uint8Array | null>;
}

const ENVELOPE_MAGIC = Buffer.from("APF1", "ascii"); // Assistant Private File v1

function deriveFileEncryptionKey(explicitSecret?: string): Buffer {
  const raw = (
    explicitSecret ??
    process.env.SECRET_VAULT_KEY ??
    process.env.AUTH_SECRET ??
    ""
  ).trim();
  if (raw.length < 16 || raw === "****") {
    throw new Error(
      "Private file encryption requires SECRET_VAULT_KEY or AUTH_SECRET (>=16 chars)"
    );
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(raw, "utf8"),
      Buffer.from("assistant-private-file-v1", "utf8"),
      Buffer.from("aes-256-gcm", "utf8"),
      32
    )
  );
}

function buildAad(
  userId: string,
  fileId: string,
  contentType: ExportedPrivateFileMediaType
): Buffer {
  return Buffer.from(`${userId}:${fileId}:${contentType}`, "utf8");
}

export function encryptFileBytes(opts: {
  userId: string;
  fileId: string;
  contentType: ExportedPrivateFileMediaType;
  plaintext: Uint8Array;
  secret?: string;
}): Buffer {
  const key = deriveFileEncryptionKey(opts.secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(buildAad(opts.userId, opts.fileId, opts.contentType));
  const encrypted = Buffer.concat([
    cipher.update(opts.plaintext),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Binary layout: [4B magic "APF1"][12B iv][16B authTag][ciphertext...]
  return Buffer.concat([ENVELOPE_MAGIC, iv, authTag, encrypted]);
}

export function decryptFileBytes(opts: {
  userId: string;
  fileId: string;
  contentType: ExportedPrivateFileMediaType;
  envelope: Uint8Array;
  secret?: string;
}): Uint8Array {
  const buf = Buffer.from(opts.envelope);
  if (buf.length < 32 || !buf.subarray(0, 4).equals(ENVELOPE_MAGIC)) {
    throw new Error("Invalid private file envelope");
  }
  const key = deriveFileEncryptionKey(opts.secret);
  const iv = buf.subarray(4, 16);
  const authTag = buf.subarray(16, 32);
  const ciphertext = buf.subarray(32);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(buildAad(opts.userId, opts.fileId, opts.contentType));
  decipher.setAuthTag(authTag);
  return new Uint8Array(
    Buffer.concat([decipher.update(ciphertext), decipher.final()])
  );
}

export function createInMemoryPrivateFileStore(opts?: {
  secret?: string;
}): PrivateFileStore {
  const blobs = new Map<string, Buffer>();

  return {
    save({ userId, contentType, bytes }) {
      try {
        const fileId = randomUUID();
        const storageRef = `mem:${fileId}`;
        const envelope = encryptFileBytes({
          userId,
          fileId,
          contentType,
          plaintext: bytes,
          secret: opts?.secret,
        });
        blobs.set(storageRef, envelope);
        return Promise.resolve({ fileId, storageRef });
      } catch (error) {
        return Promise.reject(error);
      }
    },
    read({ userId, fileId, contentType, storageRef }) {
      try {
        const envelope = blobs.get(storageRef);
        if (!envelope) {
          return Promise.resolve(null);
        }
        return Promise.resolve(
          decryptFileBytes({
            userId,
            fileId,
            contentType,
            envelope,
            secret: opts?.secret,
          })
        );
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

function hasUsableBlobToken(): boolean {
  const token = (process.env.BLOB_READ_WRITE_TOKEN ?? "").trim();
  return token.length > 10 && token !== "****";
}

function resolveLocalCacheDir(): string {
  return path.join(os.tmpdir(), "assistant-private-files");
}

async function getFileSql() {
  const url = (process.env.POSTGRES_URL ?? "").trim();
  if (!url || url === "****") {
    return null;
  }
  const pgFileClient = getSharedPostgresClient(url);
  await ensureParitySchema(pgFileClient);
  return pgFileClient;
}

function isAllowedVercelBlobUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

let defaultStore: PrivateFileStore | null = null;

export function getDefaultPrivateFileStore(): PrivateFileStore {
  if (defaultStore) {
    return defaultStore;
  }

  defaultStore = {
    async save({ userId, safeName, contentType, bytes }) {
      const fileId = randomUUID();
      const envelope = encryptFileBytes({
        userId,
        fileId,
        contentType,
        plaintext: bytes,
      });

      if (hasUsableBlobToken()) {
        const nonce = randomBytes(8).toString("hex");
        const blobKey = `private-attachments/${fileId}-${nonce}/${safeName}.enc`;
        const uploaded = await put(blobKey, envelope, {
          access: "public",
          contentType: "application/octet-stream",
          addRandomSuffix: false,
        });
        return {
          fileId,
          storageRef: `blob:${uploaded.url}`,
        };
      }

      const sql = await getFileSql();
      if (sql) {
        await sql`
          INSERT INTO "PrivateFile" ("id", "userId", "envelope")
          VALUES (${fileId}, ${userId}, ${envelope})
        `;
        return {
          fileId,
          storageRef: `pg:${fileId}`,
        };
      }

      const dir = resolveLocalCacheDir();
      await mkdir(dir, { recursive: true });
      const localFile = `${fileId}.enc`;
      await writeFile(path.join(dir, localFile), envelope, { mode: 0o600 });
      return {
        fileId,
        storageRef: `local:${localFile}`,
      };
    },

    async read({ userId, fileId, contentType, storageRef }) {
      if (storageRef.startsWith("blob:")) {
        const blobUrl = storageRef.slice("blob:".length);
        if (!isAllowedVercelBlobUrl(blobUrl)) {
          return null;
        }
        const response = await fetch(blobUrl, { cache: "no-store" });
        if (!response.ok) {
          return null;
        }
        const envelope = new Uint8Array(await response.arrayBuffer());
        return decryptFileBytes({
          userId,
          fileId,
          contentType,
          envelope,
        });
      }

      if (storageRef.startsWith("pg:")) {
        const sql = await getFileSql();
        if (!sql) {
          return null;
        }
        const rows = await sql`
          SELECT "envelope" FROM "PrivateFile"
          WHERE "id" = ${fileId} AND "userId" = ${userId}
          LIMIT 1
        `;
        const raw = rows[0]?.envelope as Uint8Array | Buffer | undefined;
        if (!raw) {
          return null;
        }
        return decryptFileBytes({
          userId,
          fileId,
          contentType,
          envelope: new Uint8Array(raw),
        });
      }

      if (storageRef.startsWith("local:")) {
        const fileName = path.basename(storageRef.slice("local:".length));
        if (!/^[a-f0-9-]+\.enc$/i.test(fileName)) {
          return null;
        }
        try {
          const envelope = await readFile(
            path.join(resolveLocalCacheDir(), fileName)
          );
          return decryptFileBytes({
            userId,
            fileId,
            contentType,
            envelope,
          });
        } catch {
          return null;
        }
      }

      return null;
    },
  };

  return defaultStore;
}
