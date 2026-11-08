import { hash } from "bcrypt-ts";
import { config } from "dotenv";
import postgres from "postgres";
import { isOwnerEmail } from "../lib/access-policy";

config({ path: ".env.local" });

async function main() {
  const email = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_INITIAL_PASSWORD;
  const url = process.env.POSTGRES_URL;
  if (
    !(
      email &&
      isOwnerEmail(email) &&
      email.includes("@") &&
      email.length <= 64 &&
      url &&
      password &&
      password.length >= 16 &&
      Buffer.byteLength(password) <= 72
    )
  ) {
    throw new Error(
      "Configure APP_OWNER_EMAIL, POSTGRES_URL and a 16+ character OWNER_INITIAL_PASSWORD (at most 72 bytes) through cloud secrets."
    );
  }
  const sql = postgres(url, { max: 1 });
  try {
    const passwordHash = await hash(password, 12);
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(748391002)`;
      const users =
        await tx`SELECT id FROM "User" WHERE lower(email) = ${email}`;
      if (users.length > 0) {
        throw new Error(
          "Owner already exists; no account or password was changed."
        );
      }
      await tx`INSERT INTO "User" (email, password) VALUES (${email}, ${passwordHash})`;
    });
    console.log(
      "Owner provisioned. Remove OWNER_INITIAL_PASSWORD from cloud secrets now."
    );
  } finally {
    await sql.end();
  }
}

main().catch(() => {
  console.error(
    "Owner provisioning failed. Verify configuration and whether the owner already exists. No credentials are logged."
  );
  process.exitCode = 1;
});
