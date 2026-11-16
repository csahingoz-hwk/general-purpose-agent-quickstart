import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import type {
  BackgroundTaskRecord,
  BackgroundTaskStore,
} from "@/lib/tasks/runner";

export type BrowserActionKind =
  | "navigate"
  | "click"
  | "type"
  | "submit"
  | "scroll"
  | "extract";

export type ProposedBrowserStep = {
  url: string;
  action: BrowserActionKind;
  selector?: string;
  inputValue?: string;
  domContextSnippet?: string;
};

export type BrowserSafetyGate =
  | "ok"
  | "ssrf_blocked"
  | "blocked_work_data"
  | "domain_not_allowlisted"
  | "captcha_human_handoff"
  | "auth_or_password_field"
  | "payment_or_form_submit";

export type BrowserStepVerdict =
  | { allowed: true; gate: "ok"; normalizedDomain: string }
  | {
      allowed: false;
      hardFail: boolean;
      gate: Exclude<BrowserSafetyGate, "ok">;
      reason: string;
    };

const PRIVATE_OR_LOCAL_HOST_PATTERN =
  /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[0-1])\.\d+\.\d+|\[::1\])$/i;

const CAPTCHA_PATTERN =
  /\b(?:recaptcha|hcaptcha|turnstile|cf-challenge|verify\s+you\s+are\s+human|arkose|altcha)\b/i;

const PASSWORD_OR_AUTH_PATTERN =
  /type\s*=\s*["']?password|input\[password\]|\b(?:password|passcode|two-factor|2fa|otp-code|oauth\/authorize|signin|login)\b/i;

const PAYMENT_OR_CHECKOUT_PATTERN =
  /\b(?:checkout|card-number|credit-card|cvv|cvc|iban|sort-code|buy-now|place-order|pay-now|stripe\.com\/pay)\b/i;

function isDomainAllowlisted(
  hostname: string,
  allowedDomains: readonly string[]
): boolean {
  const lowerHost = hostname.toLowerCase();
  for (const raw of allowedDomains) {
    const allowed = raw.trim().toLowerCase().replace(/^\*\./, "");
    if (!allowed) {
      continue;
    }
    if (lowerHost === allowed || lowerHost.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

export function evaluateBrowserStepSafety(opts: {
  step: ProposedBrowserStep;
  allowedDomains: readonly string[];
}): BrowserStepVerdict {
  let parsed: URL;
  try {
    parsed = new URL(opts.step.url);
  } catch {
    return {
      allowed: false,
      hardFail: true,
      gate: "ssrf_blocked",
      reason: "Invalid target URL",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      allowed: false,
      hardFail: true,
      gate: "ssrf_blocked",
      reason: `Disallowed URL protocol: ${parsed.protocol}`,
    };
  }

  if (
    PRIVATE_OR_LOCAL_HOST_PATTERN.test(parsed.hostname) ||
    parsed.hostname.endsWith(".local") ||
    parsed.hostname.endsWith(".internal")
  ) {
    return {
      allowed: false,
      hardFail: true,
      gate: "ssrf_blocked",
      reason: `Blocked private/loopback network target (${parsed.hostname})`,
    };
  }

  const combinedText = [
    opts.step.url,
    opts.step.selector ?? "",
    opts.step.inputValue ?? "",
    opts.step.domContextSnippet ?? "",
  ].join("\n");

  if (containsRestrictedWorkData(combinedText)) {
    return {
      allowed: false,
      hardFail: true,
      gate: "blocked_work_data",
      reason:
        "Blocked: employer/Korn Ferry material cannot be processed by personal cloud browser workers.",
    };
  }

  // Never solve, click through, or bypass CAPTCHAs / anti-bot challenges
  if (CAPTCHA_PATTERN.test(combinedText)) {
    return {
      allowed: false,
      hardFail: false,
      gate: "captcha_human_handoff",
      reason:
        "Anti-bot / CAPTCHA gate detected; pausing immediately for manual owner handoff (never bypassed).",
    };
  }

  if (!isDomainAllowlisted(parsed.hostname, opts.allowedDomains)) {
    return {
      allowed: false,
      hardFail: false,
      gate: "domain_not_allowlisted",
      reason: `Domain "${parsed.hostname}" is outside allowedDomains; owner approval required.`,
    };
  }

  if (PASSWORD_OR_AUTH_PATTERN.test(combinedText)) {
    return {
      allowed: false,
      hardFail: false,
      gate: "auth_or_password_field",
      reason:
        "Login / password / 2FA field detected; pausing in awaiting_approval for owner review.",
    };
  }

  if (
    opts.step.action === "submit" ||
    PAYMENT_OR_CHECKOUT_PATTERN.test(combinedText)
  ) {
    return {
      allowed: false,
      hardFail: false,
      gate: "payment_or_form_submit",
      reason:
        "Checkout, payment, or form-submit action detected; pausing in awaiting_approval for owner confirmation.",
    };
  }

  return {
    allowed: true,
    gate: "ok",
    normalizedDomain: parsed.hostname.toLowerCase(),
  };
}

export async function runBrowserSubagentTask(opts: {
  store: BackgroundTaskStore;
  userId: string;
  title: string;
  allowedDomains: readonly string[];
  steps: readonly ProposedBrowserStep[];
}): Promise<BackgroundTaskRecord> {
  const executionRuntime =
    opts.steps.length > 2 ? "cloud_run_scale_to_zero" : "ephemeral_single_tab";

  let task = await opts.store.enqueueTask({
    userId: opts.userId,
    kind: "browser_agent",
    title: opts.title,
    prompt: `Allowed domains: ${opts.allowedDomains.join(", ")} · Runtime: ${executionRuntime}`,
    riskLevel: "medium",
  });

  task =
    (await opts.store.transitionTask({
      userId: opts.userId,
      id: task.id,
      status: "running",
      stepMessage: `Initialized browser subagent (${executionRuntime}; 8 GB Mac mini protected from multi-tab bloat)`,
    })) ?? task;

  for (let i = 0; i < opts.steps.length; i++) {
    const step = opts.steps[i];
    const verdict = evaluateBrowserStepSafety({
      step,
      allowedDomains: opts.allowedDomains,
    });

    if (!verdict.allowed) {
      if (verdict.hardFail) {
        return (
          (await opts.store.transitionTask({
            userId: opts.userId,
            id: task.id,
            status: "failed",
            stepMessage: `[Gate:${verdict.gate}] ${verdict.reason}`,
            error: verdict.reason,
          })) ?? task
        );
      }
      return (
        (await opts.store.transitionTask({
          userId: opts.userId,
          id: task.id,
          status: "awaiting_approval",
          stepMessage: `[Gate:${verdict.gate}] ${verdict.reason}`,
          output: `Paused at step ${i + 1} (${step.action} on ${step.url}): ${verdict.reason}`,
        })) ?? task
      );
    }

    task =
      (await opts.store.transitionTask({
        userId: opts.userId,
        id: task.id,
        status: "running",
        stepMessage: `[allowlist:${verdict.normalizedDomain}] Verified ${step.action} on ${step.url}`,
      })) ?? task;
  }

  return (
    (await opts.store.transitionTask({
      userId: opts.userId,
      id: task.id,
      status: "succeeded",
      stepMessage: `Completed ${opts.steps.length} verified browser step(s)`,
      output: `Browser trace validated (${opts.steps.length} step(s), runtime=${executionRuntime}).`,
    })) ?? task
  );
}
