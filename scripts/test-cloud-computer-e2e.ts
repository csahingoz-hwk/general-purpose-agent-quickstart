/**
 * Live end-to-end smoke test against the provisioned GCE Ubuntu 24.04 VM
 * (`assistant-computer-01`) via the scale-to-zero Cloud Run relay
 * (`assistant-computer-relay`). Never logs secrets.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloudBrowsePublicUrl,
  cloudReadWorkspaceFile,
  cloudRunExec,
  cloudWriteWorkspaceFile,
} from "../lib/cloud-computer/client";

test("live Cloud Computer E2E smoke test", async () => {
  const relayUrl = process.env.CLOUD_COMPUTER_RELAY_URL?.trim();
  const hmacSecret = process.env.CLOUD_COMPUTER_HMAC_SECRET?.trim();
  if (!relayUrl || !hmacSecret) {
    console.log("SKIP: CLOUD_COMPUTER_RELAY_URL / SECRET not set");
    return;
  }

  // 1. Write a Python script to persistent /workspace
  const pyScript = [
    "import platform, pathlib",
    "out = pathlib.Path('/workspace/smoke-report.csv')",
    "out.write_text('metric,value\\nos,' + platform.system() + '\\npersistent,yes\\n')",
    "print('OK', platform.platform())",
  ].join("\n");

  const written = await cloudWriteWorkspaceFile({
    path: "smoke/run_check.py",
    contentBase64: Buffer.from(pyScript, "utf8").toString("base64"),
    relayUrl,
    hmacSecret,
  });
  assert.equal(written.status, "ok");

  // 2. Run Python + git check + verify GCE metadata server (169.254.169.254) is unreachable from operator UID!
  const ran = await cloudRunExec({
    command:
      "python3 /workspace/smoke/run_check.py && git --version && (curl -s --max-time 2 http://169.254.169.254 >/dev/null && echo META_LEAK || echo META_BLOCKED)",
    cwd: "/workspace",
    relayUrl,
    hmacSecret,
  });
  assert.equal(ran.exitCode, 0, `Cloud exec failed: ${ran.stderr}`);
  assert.match(ran.stdout, /OK Linux/);
  assert.match(ran.stdout, /git version/);
  assert.match(ran.stdout, /META_BLOCKED/);

  // 3. Read back the generated CSV from /workspace
  const csv = await cloudReadWorkspaceFile({
    path: "/workspace/smoke-report.csv",
    relayUrl,
    hmacSecret,
  });
  const text = Buffer.from(csv.base64, "base64").toString("utf8");
  assert.match(text, /persistent,yes/);

  // 4. Browse a public page from the Cloud VM (0 MB RAM on Mac mini)
  const page = await cloudBrowsePublicUrl({
    url: "https://example.com",
    relayUrl,
    hmacSecret,
  });
  assert.equal(page.status, "ok");
  assert.match(page.title, /Example Domain/);
  assert.match(page.fencedText, /<untrusted_content/);

  console.log(
    `PASS: Live Cloud Computer E2E verified (host=${ran.hostname ?? "vm"}, exec=${ran.durationMs}ms, wake=${ran.vmWakeMs ?? 0}ms, metadata=BLOCKED, /workspace=persistent)`
  );
});
