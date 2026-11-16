import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createInMemoryVaultStore,
  decryptSecretPayload,
  encryptSecretPayload,
  isVaultConfigured,
  maskSecretHint,
  VaultError,
} from "../../lib/vault/secret-vault";

const TEST_MASTER_KEY = "unit-test-only-vault-master-key-at-least-32-bytes";

test("secret vault fails closed when SECRET_VAULT_KEY is missing or too short", () => {
  const prev = process.env.SECRET_VAULT_KEY;
  try {
    Reflect.deleteProperty(process.env, "SECRET_VAULT_KEY");
    assert.equal(isVaultConfigured(), false);
    assert.throws(
      () =>
        encryptSecretPayload({
          userId: "user-1",
          name: "GITHUB_PAT",
          plaintext: "ghp_supersecret1234",
        }),
      (err: unknown) =>
        err instanceof VaultError && err.code === "vault_key_missing"
    );
    assert.throws(
      () =>
        encryptSecretPayload({
          userId: "user-1",
          name: "GITHUB_PAT",
          plaintext: "ghp_supersecret1234",
          masterKey: "too-short-key",
        }),
      (err: unknown) =>
        err instanceof VaultError && err.code === "vault_key_missing"
    );
  } finally {
    if (prev !== undefined) {
      process.env.SECRET_VAULT_KEY = prev;
    }
  }
});

test("AES-256-GCM binds ciphertext to owner userId and secret name via AAD", () => {
  const encrypted = encryptSecretPayload({
    userId: "owner-uuid-1",
    name: "GMAIL_REFRESH_TOKEN",
    plaintext: "1//0gVerySensitiveRefreshToken9876",
    masterKey: TEST_MASTER_KEY,
  });

  assert.equal(encrypted.keyHint, "••••9876");
  assert.ok(!encrypted.ciphertext.includes("VerySensitive"));

  const roundTrip = decryptSecretPayload({
    userId: "owner-uuid-1",
    name: "GMAIL_REFRESH_TOKEN",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    masterKey: TEST_MASTER_KEY,
  });
  assert.equal(roundTrip, "1//0gVerySensitiveRefreshToken9876");

  // Cross-user AAD mismatch must fail closed
  assert.throws(
    () =>
      decryptSecretPayload({
        userId: "other-user-uuid",
        name: "GMAIL_REFRESH_TOKEN",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        masterKey: TEST_MASTER_KEY,
      }),
    (err: unknown) =>
      err instanceof VaultError && err.code === "vault_integrity_failed"
  );

  // Cross-secret-name AAD mismatch must fail closed
  assert.throws(
    () =>
      decryptSecretPayload({
        userId: "owner-uuid-1",
        name: "DIFFERENT_SECRET_NAME",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        masterKey: TEST_MASTER_KEY,
      }),
    (err: unknown) =>
      err instanceof VaultError && err.code === "vault_integrity_failed"
  );
});

test("vault store lists masked metadata only and isolates owners", async () => {
  assert.equal(maskSecretHint("abc"), "••••");
  assert.equal(maskSecretHint("sk-proj-1234567890abcd"), "••••abcd");

  const store = createInMemoryVaultStore(TEST_MASTER_KEY);
  await store.upsertSecret({
    userId: "owner-1",
    name: "LINEAR_KEY",
    provider: "linear",
    plaintext: "lin_api_secret_xyz9",
  });
  await store.upsertSecret({
    userId: "owner-2",
    name: "LINEAR_KEY",
    provider: "linear",
    plaintext: "lin_api_other_0000",
  });

  const list = await store.listSecrets("owner-1");
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "LINEAR_KEY");
  assert.equal(list[0].keyHint, "••••xyz9");
  assert.equal("plaintext" in list[0], false);
  assert.equal("ciphertext" in list[0], false);

  assert.equal(
    await store.resolveSecret({ userId: "owner-1", name: "linear_key" }),
    "lin_api_secret_xyz9"
  );
  assert.equal(
    await store.deleteSecret({ userId: "owner-1", name: "LINEAR_KEY" }),
    true
  );
  assert.equal(
    await store.resolveSecret({ userId: "owner-1", name: "LINEAR_KEY" }),
    null
  );
});
