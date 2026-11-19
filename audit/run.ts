import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { selectActiveTools } from "@/lib/ai/context/select-tools";
import {
  isResearchOrHardTurn,
  resolveTurnModelAndEffort,
} from "@/lib/ai/escalation";
import { systemPrompt } from "@/lib/ai/prompts";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { extractExplicitRememberFact } from "@/lib/memory/bulk-import";
import { isVisualCandidateTurn } from "@/lib/openui/structured-answer";
import type { ChatMessage } from "@/lib/types";
import { scenarios } from "./scenarios";

const OPERATOR = [
  "gmailReadMessages",
  "driveReadFiles",
  "calendarReadEvents",
  "githubReadPullRequests",
  "gmailCreateDraft",
  "driveCreateDraftDoc",
  "calendarCreateDraftEvent",
  "githubCreateDraftReview",
  "saveProfileFact",
  "addJournalEntry",
  "recallMemories",
  "scheduleTask",
  "listMySchedules",
  "cancelSchedule",
  "draftOutboundMessage",
  "delegateTask",
  "cloudExec",
  "cloudWriteFile",
  "cloudReadFile",
  "cloudExportFileToChat",
  "cloudBrowseUrl",
  "macExec",
  "macRunAgentCli",
];

let n = 0;
const msg = (role: "user" | "assistant", text: string): ChatMessage =>
  ({
    id: `m${n++}`,
    role,
    parts: [{ type: "text", text }],
  }) as ChatMessage;

const rows: Record<string, unknown>[] = [];

for (const s of scenarios) {
  const hist: ChatMessage[] = (s.history ?? []).map((t) =>
    t.approvedTool
      ? ({
          id: `m${n++}`,
          role: "assistant",
          parts: [
            {
              type: `tool-${t.approvedTool}`,
              toolCallId: "c1",
              state: "approval-responded",
              input: {},
              approval: { id: "a1", approved: true },
            },
          ],
        } as unknown as ChatMessage)
      : msg(t.role, t.text)
  );
  const msgs = s.prompt.startsWith("(approve")
    ? hist
    : [...hist, msg("user", s.prompt)];
  const tools = selectActiveTools(msgs, !s.guest, true);
  const esc = resolveTurnModelAndEffort({
    selectedModelId: "gemini-4-hydrogen",
    availableModelIds: ["gemini-4-hydrogen", "gemini-4-neon"],
    userText: s.prompt.startsWith("(approve")
      ? (s.history?.[0]?.text ?? "")
      : s.prompt,
    requestedTools: tools,
  });
  const hard = isResearchOrHardTurn(s.prompt, tools);
  const op = tools.some((t) => OPERATOR.includes(t));
  const sp = systemPrompt({
    supportsTools: true,
    soul: null,
    needsOnboarding: tools.length === 0,
    includeArtifacts: tools.some((t) =>
      [
        "createDocument",
        "editDocument",
        "updateDocument",
        "requestSuggestions",
      ].includes(t)
    ),
    includeWebSearch: tools.includes("webSearch"),
    includeFixtures: tools.includes("getFixtures"),
    includeOperatorTools: op,
    includeVisual: isVisualCandidateTurn(s.prompt, tools),
    context: "",
  });
  const variant =
    [
      op ? "operator" : null,
      tools.includes("webSearch") ? "websearch" : null,
      tools.includes("getFixtures") ? "fixtures" : null,
      isVisualCandidateTurn(s.prompt, tools) ? "visual" : null,
      tools.length === 0 ? "onboarding" : null,
    ]
      .filter(Boolean)
      .join("+") || "base";
  const sayNoGmail = sp.includes("Personal Gmail/Calendar access") && !op;
  const remember = s.guest ? null : extractExplicitRememberFact(s.prompt);
  const kf = containsRestrictedWorkData(s.prompt);
  const model = esc.modelId.includes("neon") ? "neon" : "hydrogen";
  const reasons: string[] = [];

  for (const t of s.include ?? []) {
    if (!tools.includes(t as never)) {
      if (t === "saveProfileFact" && remember?.kind === "ok") {
        continue; // deterministic save path
      }
      reasons.push(`missing ${t}`);
    }
  }
  for (const t of s.exclude ?? []) {
    if (tools.includes(t as never)) {
      reasons.push(`unexpected ${t}`);
    }
  }
  if (s.model && s.model !== model) {
    reasons.push(`model ${model} (want ${s.model})`);
  }
  if (
    s.search === false &&
    tools.includes("webSearch") &&
    !reasons.some((r) => r.includes("webSearch"))
  ) {
    reasons.push("unexpected webSearch");
  }
  if (s.id === "M05" && remember?.kind !== "sensitive_blocked") {
    reasons.push(`sensitive card not blocked (${remember?.kind})`);
  }
  if (s.id === "G11" && !kf) {
    reasons.push("KF data not detected by containsRestrictedWorkData");
  }
  if (sayNoGmail) {
    reasons.push("base_prompt_denies_gmail");
  }

  const row = {
    id: s.id,
    feature: s.feature,
    lang: s.lang,
    prompt: s.prompt,
    history: (s.history ?? []).length,
    guest: Boolean(s.guest),
    tools: tools.join(" ") || "(none)",
    variant,
    model: `${model}/${esc.reasoningEffort}`,
    hardAnalytical: hard.hardAnalytical,
    baseSaysNoGmail: sayNoGmail,
    remember: remember?.kind ?? "-",
    kf,
    status: reasons.length > 0 ? "FAIL" : "PASS",
    reason: reasons.join("; ") || "ok",
    note: s.note ?? "",
  };
  rows.push(row);
}

const outPath = process.env.AUDIT_RESULTS_PATH?.trim();
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(rows, null, 2));
}

for (const r of rows) {
  console.log(
    `${r.status}\t${r.id}\t${r.model}\t[${r.tools}]\t${r.reason}\t${r.remember}`
  );
}

const passCount = rows.filter((r) => r.status === "PASS").length;
const failCount = rows.filter((r) => r.status === "FAIL").length;
console.log("PASS", passCount, "FAIL", failCount);

if (failCount > 0) {
  process.exitCode = 1;
}
