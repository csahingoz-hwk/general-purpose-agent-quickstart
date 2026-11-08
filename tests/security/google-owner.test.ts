import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOOGLE_IDENTITY_SCOPE,
  isGoogleSignInConfigured,
  resolveGoogleOwner,
} from "../../lib/google-owner";

test("Google login requires owner configuration and both private OAuth settings", () => {
  process.env.APP_OWNER_EMAIL = "owner@example.test";
  Reflect.deleteProperty(process.env, "AUTH_GOOGLE_ID");
  Reflect.deleteProperty(process.env, "AUTH_GOOGLE_SECRET");
  assert.equal(isGoogleSignInConfigured(), false);
  process.env.AUTH_GOOGLE_ID = "synthetic-test-client";
  assert.equal(isGoogleSignInConfigured(), false);
  process.env.AUTH_GOOGLE_SECRET = "synthetic-test-secret";
  assert.equal(isGoogleSignInConfigured(), true);
  Reflect.deleteProperty(process.env, "APP_OWNER_EMAIL");
  assert.equal(isGoogleSignInConfigured(), false);
  assert.deepEqual(GOOGLE_IDENTITY_SCOPE.split(" "), [
    "openid",
    "email",
    "profile",
  ]);
});

test("only a Google-verified owner can reach account lookup or provisioning", async () => {
  process.env.APP_OWNER_EMAIL = "owner@example.test";
  let calls = 0;
  const lookup = (email: string) => {
    calls += 1;
    return Promise.resolve({ id: "existing-database-user-id", email });
  };
  for (const profile of [
    undefined,
    {},
    { email: "owner@example.test" },
    { email: "owner@example.test", email_verified: false },
    { email: "owner@example.test", email_verified: "true" },
    { email: "other@example.test", email_verified: true },
  ]) {
    assert.equal(await resolveGoogleOwner(profile, lookup), null);
  }
  assert.equal(calls, 0);
  Reflect.deleteProperty(process.env, "APP_OWNER_EMAIL");
  assert.equal(
    await resolveGoogleOwner(
      { email: "owner@example.test", email_verified: true },
      lookup
    ),
    null
  );
  assert.equal(calls, 0);
  process.env.APP_OWNER_EMAIL = "owner@example.test";
  const identity = await resolveGoogleOwner(
    { email: "Owner@Example.Test", email_verified: true },
    lookup
  );
  assert.deepEqual(identity, {
    id: "existing-database-user-id",
    email: "owner@example.test",
    type: "regular",
  });
  assert.equal(calls, 1);
  assert.equal(
    await resolveGoogleOwner(
      { email: "owner@example.test", email_verified: true },
      () => Promise.resolve({ id: "unexpected", email: "other@example.test" })
    ),
    null
  );
});
