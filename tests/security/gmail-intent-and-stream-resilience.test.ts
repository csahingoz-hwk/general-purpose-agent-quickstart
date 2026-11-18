import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isOpenQuestion,
  selectActiveTools,
  shouldOfferWebSearch,
} from "../../lib/ai/context/select-tools";
import {
  canRetryReply,
  hasNonRetryableToolExecution,
  interruptedReply,
  prepareRetry,
  replyForStorage,
} from "../../lib/ai/conversation-state";
import { resolveTurnModelAndEffort } from "../../lib/ai/escalation";
import { systemPrompt } from "../../lib/ai/prompts";
import { ARGON, HYDROGEN, TERRA } from "../../lib/ai/routing/catalog";
import type { ChatMessage } from "../../lib/types";
import { getCopy } from "../../lib/ui-copy";

const userTurn = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

const EXACT_OWNER_SENTENCE =
  "selam asistan, bana x.ai'den gelen son emaili bulup bir cevap taslağı oluşturur musun?";

const FIVE_TR_EN_VARIANTS = [
  "Merhaba, Stripe'tan gelen son maili bulup kısa bir yanıt taslağı yazar mısın?",
  "Can you find the latest email from x.ai and draft a reply?",
  "Could you check the last email from GitHub in my inbox and prepare a response draft?",
  "May you look at my recent email from Sarah and create a Gmail draft reply?",
  "Bana gelen son e-postayı kontrol edip kibar bir cevap taslağı hazırlar mısın?",
] as const;

test("Exact owner sentence + 5 TR/EN variants select Gmail read & draft tools, suppress webSearch, and stay on Gemini 4 Hydrogen", () => {
  const prevGoogle = process.env.GOOGLE_CONNECTORS_ENABLED;
  try {
    process.env.GOOGLE_CONNECTORS_ENABLED = "true";

    const allSix = [EXACT_OWNER_SENTENCE, ...FIVE_TR_EN_VARIANTS];

    for (const sentence of allSix) {
      // 1) Connected & healthy owner: Gmail read+draft + Calendar/Drive read always offered, ranked Gmail-first, NO webSearch
      const connectedTools = selectActiveTools(
        [userTurn(sentence)],
        true,
        true,
        { googleConnectedAndHealthy: true }
      );
      assert.ok(
        connectedTools.includes("gmailReadMessages"),
        `gmailReadMessages missing (connected) for: ${sentence}`
      );
      assert.ok(
        connectedTools.includes("gmailCreateDraft"),
        `gmailCreateDraft missing (connected) for: ${sentence}`
      );
      assert.ok(
        connectedTools.includes("calendarReadEvents"),
        `calendarReadEvents missing (connected) for: ${sentence}`
      );
      assert.ok(
        connectedTools.includes("driveReadFiles"),
        `driveReadFiles missing (connected) for: ${sentence}`
      );
      assert.ok(
        !connectedTools.includes("webSearch"),
        `webSearch must NOT be offered for: ${sentence}`
      );
      // Regex acts as ranking hint: Gmail tools rank ahead of fallback Drive/Calendar baseline
      assert.ok(
        connectedTools.indexOf("gmailReadMessages") <
          connectedTools.indexOf("driveReadFiles"),
        `Expected Gmail tools ranked ahead of Drive baseline for: ${sentence}`
      );

      // 2) Even before Google health cache is warm (options omitted), personal inbox+draft intent never falls back to webSearch alone
      const unconnectedTools = selectActiveTools(
        [userTurn(sentence)],
        true,
        true
      );
      assert.ok(
        unconnectedTools.includes("gmailReadMessages"),
        `gmailReadMessages missing (unconnected) for: ${sentence}`
      );
      assert.ok(
        unconnectedTools.includes("gmailCreateDraft"),
        `gmailCreateDraft missing (unconnected) for: ${sentence}`
      );
      assert.ok(
        !unconnectedTools.includes("webSearch"),
        `webSearch leaked (unconnected) for: ${sentence}`
      );

      // 3) Model routing stays on Gemini 4 Hydrogen (low effort), NEVER escalates to Argon
      const routing = resolveTurnModelAndEffort({
        selectedModelId: HYDROGEN,
        availableModelIds: [HYDROGEN, ARGON, TERRA],
        userText: sentence,
        requestedTools: connectedTools,
        baseEffort: "low",
      });
      assert.equal(
        routing.modelId,
        HYDROGEN,
        `Unexpected escalation to ${routing.modelId} for: ${sentence}`
      );
      assert.equal(routing.reasoningEffort, "low");
      assert.equal(routing.escalated, false);
    }

    // 4) When Google is connected & healthy, even an unhinted phrasing offers Google baseline tools
    const unhintedConnected = selectActiveTools(
      [userTurn("Selam, önemli bir gelişme var mı bir göz atalım")],
      true,
      true,
      { googleConnectedAndHealthy: true }
    );
    assert.ok(unhintedConnected.includes("gmailReadMessages"));
    assert.ok(unhintedConnected.includes("gmailCreateDraft"));
    assert.ok(unhintedConnected.includes("calendarReadEvents"));
    assert.ok(unhintedConnected.includes("driveReadFiles"));
    assert.ok(!unhintedConnected.includes("webSearch"));
  } finally {
    if (prevGoogle === undefined) {
      Reflect.deleteProperty(process.env, "GOOGLE_CONNECTORS_ENABLED");
    } else {
      process.env.GOOGLE_CONNECTORS_ENABLED = prevGoogle;
    }
  }
});

test("isOpenQuestion treats polite TR/EN task sentences (mısın/misin/musun/müsün/may you/can you ...?) as tasks, not open web questions", () => {
  const politeTasks = [
    EXACT_OWNER_SENTENCE,
    "Bu paragrafı daha kısa özetler misin?",
    "Bana kibar bir teşekkür mesajı yazar mısın?",
    "Toplantı notlarını maddeler halinde düzenler misin?",
    "Şu metni İngilizceye çevirir müsün?",
    "Takvimime bakıp yarınki programımı söyler misiniz?",
    "Can you rewrite this paragraph more concisely?",
    "Could you summarize these notes into bullet points?",
    "May you draft a polite follow-up note?",
    "Would you help me organize my afternoon tasks?",
  ];

  for (const task of politeTasks) {
    assert.equal(
      isOpenQuestion(task.toLocaleLowerCase("en").normalize("NFC")),
      false,
      `Polite task misclassified as open web question: ${task}`
    );
    assert.equal(
      shouldOfferWebSearch(task.toLocaleLowerCase("en").normalize("NFC"), true),
      false,
      `Polite task wrongly offered webSearch: ${task}`
    );
  }

  // Genuine open factual questions still return true
  for (const openFact of [
    "who won the match last night?",
    "how many people live in lisbon?",
    "portekiz'in başkenti neresidir?",
  ]) {
    assert.equal(isOpenQuestion(openFact), true, openFact);
  }
});

test("systemPrompt never claims Gmail/Calendar is unavailable when Google is connected and includes operatorToolsPrompt", () => {
  const connectedPrompt = systemPrompt({
    supportsTools: true,
    includeOperatorTools: true,
    googleConnected: true,
  });
  assert.match(connectedPrompt, /Active Personal Connectors & Operator Tools/);
  assert.doesNotMatch(
    connectedPrompt,
    /Personal Gmail\/Calendar access.*not enabled here/i
  );
  assert.doesNotMatch(
    connectedPrompt,
    /Google identity sign-in does NOT give access/i
  );

  // Unconnected / guest prompt retains the truthful guardrail
  const disconnectedPrompt = systemPrompt({
    supportsTools: true,
    includeOperatorTools: false,
    googleConnected: false,
  });
  assert.match(
    disconnectedPrompt,
    /Personal Gmail\/Calendar access.*not enabled here/
  );
});

test("escalation does NOT auto-escalate to Argon merely because webSearch is in requestedTools", () => {
  const simpleWebFact = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, ARGON, TERRA],
    userText: "Bugün dolar kaç TL?",
    requestedTools: ["webSearch"],
    baseEffort: "low",
  });
  assert.equal(simpleWebFact.modelId, HYDROGEN);
  assert.equal(simpleWebFact.escalated, false);

  const hardResearch = resolveTurnModelAndEffort({
    selectedModelId: HYDROGEN,
    availableModelIds: [HYDROGEN, ARGON, TERRA],
    userText:
      "Kapsamlı bir karşılaştırma yap: Avrupa bulut bölgeleri ve gecikme süreleri",
    requestedTools: ["webSearch"],
    baseEffort: "low",
  });
  assert.equal(hardResearch.modelId, ARGON);
  assert.equal(hardResearch.escalated, true);
});

test("route onError logs failureKind only, Turkish partial break shows 'Yarıda kesildi, tekrar dene', and retry works after partial text or read-only Gmail lookup", () => {
  const routeSrc = readFileSync("app/(chat)/api/chat/route.ts", "utf8");
  assert.match(routeSrc, /failureKind\(error\)/);
  assert.doesNotMatch(
    routeSrc,
    /console\.(?:error|warn|log)\([^)]*error\.(?:message|stack|responseBody|requestBody)/
  );

  assert.equal(getCopy("tr").statusInterrupted, "Yarıda kesildi, tekrar dene");

  const uMsg = userTurn(EXACT_OWNER_SENTENCE);
  const partialAfterGmailRead: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "tool-gmailReadMessages",
        toolCallId: "call_gm_read_1",
        state: "output-available",
        input: { query: "from:x.ai", maxResults: 5 },
        output: { status: "ok", count: 1, messages: [] },
      } as any,
      {
        type: "text",
        text: "x.ai'den gelen son e-postayı buldum, yanıt taslağını ",
      },
    ],
  };

  assert.equal(hasNonRetryableToolExecution(partialAfterGmailRead), false);
  const stored = replyForStorage(partialAfterGmailRead, false);
  assert.ok(stored);
  assert.deepEqual(interruptedReply(stored), {
    status: "interrupted",
    retryable: true,
  });
  assert.equal(canRetryReply([uMsg, stored]), true);

  const prepared = prepareRetry([uMsg, stored], uMsg.id);
  assert.deepEqual(prepared.messages, [uMsg]);
  assert.equal(prepared.replaceId, stored.id);

  // Completed write tool (e.g., gmailCreateDraft output-available) remains non-retryable
  const completedDraftWrite: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "tool-gmailCreateDraft",
        toolCallId: "call_gm_draft_1",
        state: "output-available",
        input: {
          recipient: "support@x.ai",
          subject: "Re: API",
          body: "Merhaba",
        },
        output: { status: "draft_created_unsent", draftId: "d1" },
      } as any,
    ],
  };
  assert.equal(hasNonRetryableToolExecution(completedDraftWrite), true);
  const storedWrite = replyForStorage(completedDraftWrite, false);
  assert.ok(storedWrite);
  assert.equal(canRetryReply([uMsg, storedWrite]), false);
});
