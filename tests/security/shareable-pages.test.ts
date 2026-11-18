import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  createInMemoryPublishedPageStore,
  hashShareToken,
} from "../../lib/share/published-pages";
import { proxy } from "../../proxy";

test("PublishedPage snapshots scrub owner email, block work data, allow GET /share/[token] only, and return null immediately on revoke", async () => {
  const store = createInMemoryPublishedPageStore();

  // Work/Korn Ferry material cannot be published publicly
  await assert.rejects(() =>
    store.publish({
      userId: "owner-1",
      title: "Korn Ferry SA90 summary",
      items: [{ kind: "summary", title: "EOSB", subtitle: "Confidential" }],
    })
  );

  // Publish frozen snapshot scrubbing owner email & HTML scripts
  const published = await store.publish({
    userId: "owner-1",
    title: "London Weather & Fixtures for owner@example.test",
    items: [
      {
        kind: "weather",
        title: "London 14°C",
        subtitle: "Prepared for owner@example.test",
        bodyText: "Sunny afternoon <script>alert(1)</script>",
      },
    ],
    ownerEmailToScrub: "owner@example.test",
  });

  // Raw token is high entropy and distinct from stored SHA-256 hash
  assert.ok(published.token.length >= 24);
  assert.notEqual(published.token, hashShareToken(published.token));

  // Proxy permits GET /share/[token] without session cookie, blocks POST /share/[token], and keeps /api/share owner-locked
  process.env.AUTH_SECRET = "test-only-secret-with-at-least-32-characters";
  process.env.APP_OWNER_EMAIL = "owner@example.test";

  const publicGet = await proxy(
    new NextRequest(`http://localhost/share/${published.token}`)
  );
  assert.equal(publicGet.status, 200);
  assert.equal(publicGet.headers.get("location"), null);

  const blockedPost = await proxy(
    new NextRequest(`http://localhost/share/${published.token}`, {
      method: "POST",
    })
  );
  assert.equal(blockedPost.headers.get("location"), "http://localhost/login");

  const lockedApi = await proxy(new NextRequest("http://localhost/api/share"));
  assert.equal(lockedApi.status, 401);

  // Resolve snapshot returns scrubbed read-only data without userId or email
  const resolved = await store.resolveByToken({ token: published.token });
  assert.ok(resolved);
  const serialized = JSON.stringify(resolved);
  assert.equal(serialized.includes("owner@example.test"), false);
  assert.equal(serialized.includes("<script>"), false);
  assert.equal(serialized.includes("owner-1"), false);

  // Cross-user revoke fails; owner 1-click revoke immediately invalidates snapshot (404)
  assert.equal(
    await store.revoke({ userId: "intruder-2", id: published.page.id }),
    false
  );
  assert.equal(
    await store.revoke({ userId: "owner-1", id: published.page.id }),
    true
  );
  assert.equal(await store.resolveByToken({ token: published.token }), null);
});
