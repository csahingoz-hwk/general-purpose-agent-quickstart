import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBrowserStepSafety,
  runBrowserSubagentTask,
} from "../../lib/subagents/browser-agent";
import { createInMemoryTaskStore } from "../../lib/tasks/runner";

test("browser subagent blocks SSRF, pauses on non-allowlisted domains, password/payment/submit, and CAPTCHA handoffs, and records full trace", async () => {
  // 1. SSRF private/loopback blocked immediately
  const ssrf = evaluateBrowserStepSafety({
    allowedDomains: ["127.0.0.1"],
    step: { url: "http://127.0.0.1:4319/healthz", action: "navigate" },
  });
  assert.equal(ssrf.allowed, false);
  if (!ssrf.allowed) {
    assert.equal(ssrf.hardFail, true);
    assert.equal(ssrf.gate, "ssrf_blocked");
  }

  // 2. Non-allowlisted domain pauses in awaiting_approval
  const store = createInMemoryTaskStore();
  const nonAllowlistedTask = await runBrowserSubagentTask({
    store,
    userId: "owner-1",
    title: "Check UK rail timetable",
    allowedDomains: ["nationalrail.co.uk"],
    steps: [
      { url: "https://www.nationalrail.co.uk/", action: "navigate" },
      { url: "https://untrusted-site.example.org/offer", action: "navigate" },
    ],
  });
  assert.equal(nonAllowlistedTask.status, "awaiting_approval");
  assert.ok(
    nonAllowlistedTask.steps.some((s) =>
      s.message.includes("domain_not_allowlisted")
    )
  );

  // 3. Password field hard-pauses in awaiting_approval
  const passwordTask = await runBrowserSubagentTask({
    store,
    userId: "owner-1",
    title: "Portal read",
    allowedDomains: ["portal.example.com"],
    steps: [
      {
        url: "https://portal.example.com/account",
        action: "type",
        selector: 'input[type="password"]',
      },
    ],
  });
  assert.equal(passwordTask.status, "awaiting_approval");
  assert.ok(
    passwordTask.steps.some((s) => s.message.includes("auth_or_password_field"))
  );

  // 4. Checkout / form submit hard-pauses in awaiting_approval
  const checkoutTask = await runBrowserSubagentTask({
    store,
    userId: "owner-1",
    title: "Order groceries",
    allowedDomains: ["shop.example.com"],
    steps: [
      {
        url: "https://shop.example.com/checkout",
        action: "click",
        selector: "#pay-now",
      },
    ],
  });
  assert.equal(checkoutTask.status, "awaiting_approval");
  assert.ok(
    checkoutTask.steps.some((s) => s.message.includes("payment_or_form_submit"))
  );

  // 5. CAPTCHA challenge is NEVER bypassed -> pauses for human handoff
  const captchaTask = await runBrowserSubagentTask({
    store,
    userId: "owner-1",
    title: "Read article",
    allowedDomains: ["news.example.com"],
    steps: [
      {
        url: "https://news.example.com/story",
        action: "click",
        domContextSnippet: "Cloudflare Turnstile: Verify you are human",
      },
    ],
  });
  assert.equal(captchaTask.status, "awaiting_approval");
  assert.ok(
    captchaTask.steps.some((s) => s.message.includes("captcha_human_handoff"))
  );

  // 6. Clean read-only allowlisted flow succeeds and routes >2 steps to Cloud Run scale-to-zero
  const cleanTask = await runBrowserSubagentTask({
    store,
    userId: "owner-1",
    title: "Read public docs",
    allowedDomains: ["nextjs.org"],
    steps: [
      { url: "https://nextjs.org/docs", action: "navigate" },
      { url: "https://nextjs.org/docs", action: "scroll" },
      { url: "https://nextjs.org/docs", action: "extract", selector: "main" },
    ],
  });
  assert.equal(cleanTask.status, "succeeded");
  assert.match(cleanTask.output ?? "", /cloud_run_scale_to_zero/);
});
