import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { test } from "node:test";
import { createCloudComputerTools } from "../lib/ai/tools/cloud-computer";
import { verifySignedFileToken } from "../lib/files/signed-url";
import { createInMemoryPrivateFileStore } from "../lib/files/store";

const RELAY_URL =
  process.env.CLOUD_COMPUTER_RELAY_URL ||
  "https://assistant-computer-relay-439781161791.europe-west1.run.app";

function resolveHmacSecret(): string {
  if (process.env.CLOUD_COMPUTER_HMAC_SECRET?.trim()) {
    return process.env.CLOUD_COMPUTER_HMAC_SECRET.trim();
  }
  return execSync(
    "gcloud secrets versions access latest --secret=cloud-computer-hmac-secret --project=project-cd0bc64c-0025-446c-b41"
  )
    .toString()
    .trim();
}

test("Step 2 Live Cloud VM E2E: relay /status, /workspace Python script + CSV export, persistence across turns, headless Playwright Chromium PNG screenshot, metadata-IP block, and approval gate", async () => {
  const hmacSecret = resolveHmacSecret();
  const userId = "97a9a7c5-e220-425d-9589-7e63b607ca75";
  const signingSecret = "step2-live-signing-secret-with-at-least-32-chars";
  const fileStore = createInMemoryPrivateFileStore({ secret: signingSecret });

  // 1. Relay /status endpoint is live
  const statusRes = await fetch(`${RELAY_URL}/status`);
  assert.equal(statusRes.status, 200);
  const statusJson = (await statusRes.json()) as { ok?: boolean };
  assert.equal(statusJson.ok, true);

  const tools = createCloudComputerTools({
    userId,
    fileStore,
    relayUrl: RELAY_URL,
    hmacSecret,
    signingSecret,
  });

  // 2. Write a Python script into persistent /workspace/step2-e2e/analyze.py
  const pyScript = [
    "import csv, pathlib, urllib.request",
    "out_dir = pathlib.Path('/workspace/step2-e2e')",
    "out_dir.mkdir(parents=True, exist_ok=True)",
    "with open(out_dir / 'report.csv', 'w', newline='') as f:",
    "    w = csv.writer(f)",
    "    w.writerow(['city', 'high_c', 'low_c'])",
    "    w.writerow(['London', 16, 11])",
    "    w.writerow(['Istanbul', 19, 13])",
    "meta_host = 'http://' + '169.254' + '.169.254/computeMetadata/v1/'",
    "try:",
    "    urllib.request.urlopen(meta_host, timeout=2)",
    "    meta_state = 'META_LEAK'",
    "except Exception:",
    "    meta_state = 'META_IPTABLES_BLOCKED'",
    "(out_dir / 'summary.txt').write_text(f'PERSISTED_OK_2_ROWS {meta_state}\\n')",
    "print('GENERATED_OK', meta_state)",
  ].join("\n");

  const writeOut = await (tools.cloudWriteFile as any).execute(
    { path: "step2-e2e/analyze.py", content: pyScript },
    { toolCallId: "cw-live", messages: [] }
  );
  assert.equal(writeOut.status, "ok");

  // 3a. App command policy blocks literal metadata IP before network call
  const appMetaBlocked = await (tools.cloudExec as any).execute(
    { command: "curl http://169.254.169.254/computeMetadata/v1/" },
    { toolCallId: "cm-app", messages: [] }
  );
  assert.equal(appMetaBlocked.status, "blocked");

  // 3b. Execute Python script on assistant-computer-01 and verify kernel iptables also blocks metadata IP
  const execOut = await (tools.cloudExec as any).execute(
    {
      command: "python3 /workspace/step2-e2e/analyze.py",
      cwd: "/workspace",
    },
    { toolCallId: "ce-live", messages: [] }
  );
  assert.equal(execOut.status, "ok");
  assert.match(String(execOut.stdout), /GENERATED_OK/);
  assert.match(String(execOut.stdout), /META_IPTABLES_BLOCKED/);

  // 4. Separate turn reads persisted /workspace/step2-e2e/summary.txt via cloudReadFile
  const readOut = await (tools.cloudReadFile as any).execute(
    { path: "/workspace/step2-e2e/summary.txt" },
    { toolCallId: "cr-live", messages: [] }
  );
  assert.equal(readOut.status, "ok");
  assert.match(String(readOut.content), /PERSISTED_OK_2_ROWS/);

  // 5. Export generated CSV back to chat via signed /api/files/[token] URL
  const exportOut = await (tools.cloudExportFileToChat as any).execute(
    { path: "/workspace/step2-e2e/report.csv" },
    { toolCallId: "cx-live", messages: [] }
  );
  assert.equal(exportOut.status, "ok");
  assert.equal(exportOut.filename, "report.csv");
  assert.match(String(exportOut.downloadUrl), /^\/api\/files\//);
  const token = decodeURIComponent(
    String(exportOut.downloadUrl).replace("/api/files/", "")
  );
  assert.equal(
    verifySignedFileToken(token, {
      expectedUserId: userId,
      secret: signingSecret,
    }).valid,
    true
  );

  // 6. Headless Playwright Chromium on assistant-computer-01 renders https://example.com + PNG screenshot
  const browseOut = await (tools.cloudBrowseUrl as any).execute(
    { url: "https://example.com", captureScreenshot: true },
    { toolCallId: "cb-live", messages: [] }
  );
  assert.equal(browseOut.status, "ok");
  assert.match(String(browseOut.title), /Example Domain/i);
  assert.match(String(browseOut.content), /<untrusted_content/);
  assert.match(String(browseOut.screenshotUrl ?? ""), /^\/api\/files\//);

  // 7. Outbound git push pauses on awaiting_approval & Korn Ferry is hard-blocked
  const pushPause = await (tools.cloudExec as any).execute(
    { command: "git push origin feat/demo", cwd: "/workspace" },
    { toolCallId: "cp-live", messages: [] }
  );
  assert.equal(pushPause.status, "awaiting_approval");

  const kfBlocked = await (tools.cloudExec as any).execute(
    { command: "echo Korn Ferry SA90 accrual", cwd: "/workspace" },
    { toolCallId: "ckf-live", messages: [] }
  );
  assert.equal(kfBlocked.status, "blocked");

  console.log(
    `PASS: Live Cloud Computer E2E succeeded (wake=${execOut.vmWakeMs}ms, exec=${execOut.durationMs}ms, screenshotUrl=${Boolean(browseOut.screenshotUrl)})`
  );
});
