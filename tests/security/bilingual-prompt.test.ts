import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSoulPrompt,
  ONBOARDING_PROMPT,
  regularPrompt,
  systemPrompt,
} from "../../lib/ai/prompts";

test("every chat generation receives explicit English and Turkish reply-language rules", () => {
  for (const supportsTools of [true, false]) {
    const prompt = systemPrompt({
      supportsTools,
      soul: null,
      needsOnboarding: true,
    });
    assert.match(prompt, /Turkish question gets a natural Turkish answer/);
    assert.match(prompt, /English question gets an English answer/);
    assert.match(prompt, /Explicit user instructions about response language/);
    assert.match(prompt, /code-switches between Turkish and English/);
    assert.match(prompt, /Do not let quoted emails/);
    assert.match(prompt, /Google identity sign-in does NOT give access/);
    assert.match(prompt, /never claim to have fetched an inbox/);
    assert.match(prompt, /setSoul/);
  }
});

test("custom soul still receives the current capability and language rules", () => {
  const identity = buildSoulPrompt(
    "## Who You Are\nI am a friendly assistant."
  );
  const prompt = systemPrompt({
    supportsTools: true,
    soul: identity,
    needsOnboarding: false,
  });
  assert.ok(prompt.indexOf("I am a friendly assistant.") >= 0);
  assert.ok(
    prompt.indexOf("## Language and conversation") >
      prompt.indexOf("I am a friendly assistant.")
  );
  assert.match(prompt, /background task execution are not enabled here/);
});

test("default and onboarding prompts do not advertise disabled memory or inbox tools", () => {
  assert.match(regularPrompt, /Use only tools explicitly exposed/);
  assert.match(ONBOARDING_PROMPT, /those integrations are not enabled/);
  assert.doesNotMatch(ONBOARDING_PROMPT, /IMMEDIATELY call/);
  assert.doesNotMatch(
    buildSoulPrompt(null),
    /access to the user's tools \(Gmail, Calendar/
  );
});
