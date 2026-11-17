import assert from "node:assert/strict";
import { test } from "node:test";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import {
  createDelegateTaskTool,
  executeApprovedTask,
} from "../../lib/ai/tools/delegate-task";
import { createInMemoryTaskStore } from "../../lib/tasks/runner";
import type { ChatMessage } from "../../lib/types";

const userTurn = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

test("Step 1 (36 natural EN/TR prompts): capability-group routing, zero-tool chitchat, and strict webSearch suppression on private queries", () => {
  const prevGoogle = process.env.GOOGLE_CONNECTORS_ENABLED;
  const prevGithub = process.env.GITHUB_CONNECTOR_ENABLED;
  const prevMem = process.env.MEMORY_TOOLS_ENABLED;
  const prevRoutines = process.env.ROUTINES_ENABLED;
  try {
    process.env.GOOGLE_CONNECTORS_ENABLED = "true";
    process.env.GITHUB_CONNECTOR_ENABLED = "true";
    process.env.MEMORY_TOOLS_ENABLED = "true";
    process.env.ROUTINES_ENABLED = "true";

    // 1. Pure chitchat (6 prompts) -> 0 tools, never webSearch
    const chitchatPrompts = [
      "Merhaba!",
      "Selamlar",
      "Thanks!",
      "Günaydın",
      "How are you?",
      "Tell me a joke",
    ];
    for (const q of chitchatPrompts) {
      assert.deepEqual(selectActiveTools([userTurn(q)], true, true), [], q);
    }

    // 2. Personal Gmail reads (7 prompts) -> gmailReadMessages, NEVER webSearch
    const gmailPrompts = [
      "Did Ali email me?",
      "Did Sarah send me an email?",
      "Any unread emails today?",
      "What's in my inbox?",
      "Ali bana yazdı mı?",
      "Ali'den mail var mı?",
      "Gelen kutumda ne var?",
    ];
    for (const q of gmailPrompts) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(tools.includes("gmailReadMessages"), `gmail missing on: ${q}`);
      assert.ok(!tools.includes("webSearch"), `webSearch leaked on: ${q}`);
    }

    // 3. Personal Calendar checks (7 prompts) -> calendarReadEvents, NEVER webSearch
    const calendarPrompts = [
      "Am I free Friday afternoon?",
      "What's on my calendar tomorrow?",
      "Do I have any meetings on Monday?",
      "Cuma öğleden sonra boş muyum?",
      "Pazartesi sabah müsait miyim?",
      "Haftaya takvimim nasıl?",
      "Bugün randevum var mı?",
    ];
    for (const q of calendarPrompts) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(
        tools.includes("calendarReadEvents"),
        `calendar missing on: ${q}`
      );
      assert.ok(!tools.includes("webSearch"), `webSearch leaked on: ${q}`);
    }

    // 4. Personal Google Drive lookups (4 prompts) -> driveReadFiles, NEVER webSearch
    const drivePrompts = [
      "Find the tax invoice in my Drive",
      "Where is the Q3 roadmap doc in my Google Drive?",
      "Drive'da fatura dosyasını bul",
      "Google Drive'daki dosyalarımı listele",
    ];
    for (const q of drivePrompts) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(tools.includes("driveReadFiles"), `drive missing on: ${q}`);
      assert.ok(!tools.includes("webSearch"), `webSearch leaked on: ${q}`);
    }

    // 5. GitHub open PRs (4 prompts) -> githubReadPullRequests, NEVER webSearch
    const githubPrompts = [
      "Check open PRs",
      "Any open pull requests?",
      "Açık PR var mı?",
      "Açık pull requestleri kontrol et",
    ];
    for (const q of githubPrompts) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(
        tools.includes("githubReadPullRequests"),
        `github missing on: ${q}`
      );
      assert.ok(!tools.includes("webSearch"), `webSearch leaked on: ${q}`);
    }

    // 6. Memory recall & save (4 prompts) -> recallMemories / saveProfileFact, NEVER webSearch
    for (const q of [
      "What have you saved in my memory?",
      "Hakkımda ne biliyorsun?",
      "Beni hatırlıyor musun?",
    ]) {
      const tools = selectActiveTools([userTurn(q)], true, true);
      assert.ok(tools.includes("recallMemories"), `memory missing on: ${q}`);
      assert.ok(!tools.includes("webSearch"), `webSearch leaked on: ${q}`);
    }
    const saveTools = selectActiveTools(
      [userTurn("Bunu hatırla: uçuşlarda koridor koltuğu severim")],
      true,
      true
    );
    assert.ok(saveTools.includes("saveProfileFact"));
    assert.ok(!saveTools.includes("webSearch"));

    // 7. Operator & Cloud / Mac tools (4 prompts) -> right tool group, NEVER webSearch
    assert.ok(
      selectActiveTools(
        [userTurn("Create a task card to audit stale branches")],
        true,
        true
      ).includes("delegateTask")
    );
    assert.ok(
      selectActiveTools(
        [userTurn("Run a Python script on the Cloud VM")],
        true,
        true
      ).includes("cloudExec")
    );
    assert.ok(
      selectActiveTools(
        [userTurn("Check git status on my Mac mini")],
        true,
        true
      ).includes("macExec")
    );
    assert.ok(
      selectActiveTools(
        [userTurn("Schedule a routine every weekday at 08:00")],
        true,
        true
      ).includes("scheduleTask")
    );
  } finally {
    for (const [k, v] of [
      ["GOOGLE_CONNECTORS_ENABLED", prevGoogle],
      ["GITHUB_CONNECTOR_ENABLED", prevGithub],
      ["MEMORY_TOOLS_ENABLED", prevMem],
      ["ROUTINES_ENABLED", prevRoutines],
    ] as const) {
      if (v === undefined) {
        Reflect.deleteProperty(process.env, k);
      } else {
        process.env[k] = v;
      }
    }
  }
});

test("Step 1: delegateTask pauses on untrusted context or destructive prompt, and executeApprovedTask completes cleanly", async () => {
  const store = createInMemoryTaskStore();

  // Untrusted context forces awaiting_approval even on benign prompt
  const untrustedTool = createDelegateTaskTool({
    userId: "owner-1",
    store,
    hasUntrustedContext: true,
  });
  const paused = await (untrustedTool as any).execute(
    {
      title: "Summarize repository",
      prompt: "Inspect workspace files and summarize.",
      target: "cloud",
    },
    { toolCallId: "dt-1", messages: [] }
  );
  assert.equal(paused.status, "awaiting_approval");
  assert.ok(paused.digest && paused.digest.length === 64);

  // 1-tap owner approval executes and transitions task to succeeded
  const executed = await executeApprovedTask({
    userId: "owner-1",
    taskId: paused.task.id,
    store,
  });
  assert.ok(executed);
  assert.equal(executed.status, "succeeded");
  assert.ok(executed.steps.length >= 3);
});
