import { randomUUID } from "node:crypto";

export type ScreenHandoffReason = "login" | "two_factor" | "captcha";

export type ScreenHandoffDecision = "pending" | "im_here" | "not_now";

export type ScreenHandoffPayload = {
  kind: "screen-handoff";
  status: "screen_handoff_required";
  handoffId: string;
  reason: ScreenHandoffReason;
  serviceName: string;
  url?: string;
  screenUrl?: string;
  neverAskPasswordInChat: true;
  decision?: ScreenHandoffDecision;
};

export function isScreenHandoffPayload(
  value: unknown
): value is ScreenHandoffPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as { kind?: string }).kind === "screen-handoff" ||
        (value as { status?: string }).status === "screen_handoff_required")
  );
}

const CAPTCHA_GATE_RE =
  /\b(?:verify you are human|are you a robot|cloudflare turnstile|cf-turnstile|recaptcha|hcaptcha|complete the security check|bot verification|insan olduğunuzu doğrulayın|robot olmadığınızı)\b/iu;

const TWO_FACTOR_GATE_RE =
  /\b(?:two[- ]factor|2fa|2-step verification|authenticator code|enter the 6[- ]digit code|verification code sent to|one[- ]time passcode|iki aşamalı doğrulama|doğrulama kodunu girin)\b/iu;

const LOGIN_WALL_RE =
  /\b(?:sign in to continue|log in to continue|please sign in|enter your password to continue|session expired,?\s*please log in|devam etmek için giriş yapın)\b/iu;

/**
 * Inspects a Cloud Browser response (URL, title, extracted text) for login walls,
 * 2FA prompts, or CAPTCHA challenges so the assistant pauses and renders an
 * "I'm here / Not now" Screen Handoff card instead of attempting to bypass
 * challenges or asking for credentials in chat.
 */
export function detectScreenHandoffChallenge(opts: {
  url: string;
  title?: string;
  text?: string;
}): ScreenHandoffReason | null {
  const combined = `${opts.title ?? ""}\n${opts.text ?? ""}`;
  if (CAPTCHA_GATE_RE.test(combined)) {
    return "captcha";
  }
  if (TWO_FACTOR_GATE_RE.test(combined)) {
    return "two_factor";
  }
  const urlLower = opts.url.toLowerCase();
  const isAuthPath =
    /\/(?:login|signin|sign-in|auth|sso|2fa|mfa)(?:\/|\?|$)/.test(urlLower);
  if (
    LOGIN_WALL_RE.test(combined) ||
    (isAuthPath && /password|sign in|log in|giriş/i.test(combined))
  ) {
    return "login";
  }
  return null;
}

export function buildScreenHandoffPayload(opts: {
  reason: ScreenHandoffReason;
  serviceName?: string;
  url?: string;
}): ScreenHandoffPayload {
  let derivedService = opts.serviceName?.trim() || "";
  if (!derivedService && opts.url) {
    try {
      derivedService = new URL(opts.url).hostname.replace(/^www\./, "");
    } catch {
      derivedService = "Cloud Browser";
    }
  }
  const screenUrl = process.env.CLOUD_COMPUTER_SCREEN_URL?.trim() || undefined;
  return {
    kind: "screen-handoff",
    status: "screen_handoff_required",
    handoffId: `handoff-${randomUUID()}`,
    reason: opts.reason,
    serviceName: derivedService || "Cloud Computer",
    ...(opts.url ? { url: opts.url } : {}),
    ...(screenUrl ? { screenUrl } : {}),
    neverAskPasswordInChat: true,
    decision: "pending",
  };
}

const handoffDecisions = new Map<
  string,
  { userId: string; decision: "im_here" | "not_now"; updatedAt: string }
>();

export function recordScreenHandoffDecision(opts: {
  userId: string;
  handoffId: string;
  decision: "im_here" | "not_now";
}) {
  const entry = {
    userId: opts.userId,
    decision: opts.decision,
    updatedAt: new Date().toISOString(),
  };
  handoffDecisions.set(`${opts.userId}:${opts.handoffId}`, entry);
  return entry;
}

export function getScreenHandoffDecision(opts: {
  userId: string;
  handoffId: string;
}) {
  return handoffDecisions.get(`${opts.userId}:${opts.handoffId}`) ?? null;
}
