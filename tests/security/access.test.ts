import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { GET as guest } from "../../app/(auth)/api/auth/guest/route";
import { GET as cron } from "../../app/api/cron/tick/route";
import { POST as telegram } from "../../app/api/telegram-webhook/route";
import { POST as memoryDemo } from "../../app/memory-demo/api/chat/route";
import { isOwnerIdentity } from "../../lib/access-policy";
import { proxy } from "../../proxy";

const secret = "test-only-secret-with-at-least-32-characters";

test("owner policy and protected requests fail closed, including old guest/nonowner cookies", async () => {
  process.env.AUTH_SECRET = secret;
  Reflect.deleteProperty(process.env, "APP_OWNER_EMAIL");
  assert.equal(
    isOwnerIdentity({ email: "owner@example.test", type: "regular" }),
    false
  );
  process.env.APP_OWNER_EMAIL = " Owner@example.test ";
  assert.equal(
    isOwnerIdentity({ email: "owner@example.test", type: "regular" }),
    true
  );
  assert.equal(
    isOwnerIdentity({ email: "owner@example.test", type: "guest" }),
    false
  );
  assert.equal(
    (await proxy(new NextRequest("http://localhost/api/history"))).status,
    401
  );
  const login = await proxy(new NextRequest("http://localhost/"));
  assert.equal(login.headers.get("location"), "http://localhost/login");
  assert.equal(
    (await proxy(new NextRequest("http://localhost/login"))).status,
    200
  );
  for (const [email, type, expected] of [
    ["owner@example.test", "regular", 200],
    ["other@example.test", "regular", 401],
    ["owner@example.test", "guest", 401],
  ] as const) {
    const cookie = await encode({
      secret,
      salt: "authjs.session-token",
      token: { email, type, id: "test-owner" },
    });
    const request = new NextRequest("http://localhost/api/chat", {
      headers: { cookie: `authjs.session-token=${cookie}` },
    });
    assert.equal((await proxy(request)).status, expected);
    Reflect.deleteProperty(process.env, "APP_OWNER_EMAIL");
    assert.equal((await proxy(request)).status, 401);
    process.env.APP_OWNER_EMAIL = "owner@example.test";
  }
});

test("cron requires a configured matching secret in every environment and never executes", () => {
  for (const env of ["development", "test", "production"]) {
    Object.assign(process.env, { NODE_ENV: env });
    Reflect.deleteProperty(process.env, "CRON_SECRET");
    assert.equal(
      cron(
        new Request("http://localhost/api/cron/tick", {
          headers: { authorization: "Bearer undefined" },
        })
      ).status,
      401
    );
    process.env.CRON_SECRET = secret;
    assert.equal(
      cron(new Request("http://localhost/api/cron/tick")).status,
      401
    );
    assert.equal(
      cron(
        new Request("http://localhost/api/cron/tick", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
      401
    );
    process.env.ENABLE_SCHEDULE_EXECUTION = "true";
    assert.equal(
      cron(
        new Request("http://localhost/api/cron/tick", {
          headers: { authorization: `Bearer ${secret}` },
        })
      ).status,
      503
    );
  }
});

test("home-screen install assets skip the auth redirect", async () => {
  for (const path of [
    "/manifest.webmanifest",
    "/apple-touch-icon.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-192.png",
    "/icons/icon-maskable-512.png",
  ]) {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
  }
});

test("alternate execution and guest endpoints are disabled", () => {
  assert.equal(guest().status, 403);
  assert.equal(telegram().status, 503);
  assert.equal(memoryDemo().status, 503);
});
