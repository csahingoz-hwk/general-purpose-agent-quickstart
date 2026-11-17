import assert from "node:assert/strict";
import { test } from "node:test";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import { createCloudComputerTools } from "../../lib/ai/tools/cloud-computer";
import {
  classifyCloudCommand,
  resolveSafeWorkspacePath,
  signCloudRelayRequest,
  validateCloudBrowseUrl,
  verifyCloudRelayRequest,
} from "../../lib/cloud-computer/client";
import { verifySignedFileToken } from "../../lib/files/signed-url";
import { createInMemoryPrivateFileStore } from "../../lib/files/store";
import type { ChatMessage } from "../../lib/types";

const userTurn = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

const SECRET = "test-cloud-computer-hmac-secret-32-chars-long";
const USER_ID = "97a9a7c5-e220-425d-9589-7e63b607ca75";

test("Step 2: HMAC relay signing rejects tampering and replay skew", () => {
  const now = 1_795_000_000_000;
  const body = JSON.stringify({ command: "python3 --version" });
  const { timestamp, signature } = signCloudRelayRequest({
    secret: SECRET,
    method: "POST",
    pathname: "/exec",
    body,
    timestampMs: now,
  });

  assert.equal(
    verifyCloudRelayRequest({
      secret: SECRET,
      method: "POST",
      pathname: "/exec",
      body,
      timestamp,
      signature,
      nowMs: now + 5000,
    }),
    true
  );

  // Tampered command rejected
  assert.equal(
    verifyCloudRelayRequest({
      secret: SECRET,
      method: "POST",
      pathname: "/exec",
      body: JSON.stringify({ command: "rm -rf /" }),
      timestamp,
      signature,
      nowMs: now + 5000,
    }),
    false
  );

  // Stale (>60s) replay rejected
  assert.equal(
    verifyCloudRelayRequest({
      secret: SECRET,
      method: "POST",
      pathname: "/exec",
      body,
      timestamp,
      signature,
      nowMs: now + 120_000,
    }),
    false
  );
});

test("Step 2: workspace path confinement, metadata/private SSRF block, Korn Ferry firewall, and approval gate", () => {
  assert.equal(
    resolveSafeWorkspacePath("project/main.py"),
    "/workspace/project/main.py"
  );
  assert.throws(() => resolveSafeWorkspacePath("../../etc/passwd"));
  assert.throws(() => resolveSafeWorkspacePath("/etc/shadow"));

  // SSRF blocks metadata IP, localhost, RFC1918, and Tailscale CGNAT
  for (const blockedUrl of [
    "http://169.254.169.254/computeMetadata/v1/",
    "http://metadata.google.internal/",
    "http://127.0.0.1:8787/healthz",
    "http://10.132.0.2:8787/exec",
    "http://192.168.1.1/",
    "http://100.88.1.5:22/",
    "file:///etc/passwd",
    "https://example.com/korn-ferry-confidential",
  ]) {
    assert.throws(() => validateCloudBrowseUrl(blockedUrl), blockedUrl);
  }
  assert.equal(
    validateCloudBrowseUrl("https://example.com/docs").hostname,
    "example.com"
  );

  // Command policy tiers
  assert.equal(classifyCloudCommand("python3 script.py").tier, "allow");
  assert.equal(classifyCloudCommand("sudo apt install vim").tier, "blocked");
  assert.equal(
    classifyCloudCommand("curl http://169.254.169.254").tier,
    "blocked"
  );
  assert.equal(classifyCloudCommand("tailscale funnel 8080").tier, "blocked");
  assert.equal(
    classifyCloudCommand("echo Korn Ferry trial balance").tier,
    "blocked"
  );
  assert.equal(
    classifyCloudCommand("git push origin feat/demo").tier,
    "needs_approval"
  );
  assert.equal(
    classifyCloudCommand("rm -rf /workspace").tier,
    "needs_approval"
  );
});

test("Step 2: selectActiveTools routes Cloud Computer & Cloud Browser prompts and isolates untrusted browse from writes", () => {
  const execTools = selectActiveTools(
    [userTurn("Run a python script in /workspace on the Cloud Computer")],
    true,
    true
  );
  assert.ok(execTools.includes("cloudExec"));
  assert.ok(execTools.includes("cloudWriteFile"));
  assert.ok(execTools.includes("cloudExportFileToChat"));
  assert.ok(!execTools.includes("webSearch"));

  const browseTools = selectActiveTools(
    [userTurn("Open https://example.com in headless browser and summarize")],
    true,
    true
  );
  assert.deepEqual(browseTools, ["cloudBrowseUrl"]);
});

test("Step 2: Cloud Computer tools write, execute, and export encrypted CSV files to owner-only /api/files/[token] links", async () => {
  const virtualDisk = new Map<string, string>();
  const fileStore = createInMemoryPrivateFileStore({ secret: SECRET });

  const mockFetch: typeof fetch = (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    if (url.endsWith("/files/write")) {
      virtualDisk.set(String(body.path), String(body.contentBase64));
      return Promise.resolve(
        Response.json({
          status: "ok",
          path: body.path,
          bytesWritten: Buffer.from(String(body.contentBase64), "base64")
            .byteLength,
        })
      );
    }
    if (url.endsWith("/exec")) {
      const csv = Buffer.from("city,temp_c\nLondon,15\n", "utf8").toString(
        "base64"
      );
      virtualDisk.set("/workspace/out.csv", csv);
      return Promise.resolve(
        Response.json({
          status: "ok",
          exitCode: 0,
          stdout: "Wrote /workspace/out.csv\n",
          stderr: "",
          cwd: "/workspace",
          durationMs: 48,
        })
      );
    }
    if (url.endsWith("/files/read")) {
      const b64 = virtualDisk.get(String(body.path)) ?? "";
      return Promise.resolve(
        Response.json({
          status: "ok",
          path: body.path,
          sizeBytes: Buffer.from(b64, "base64").byteLength,
          base64: b64,
        })
      );
    }
    return Promise.resolve(
      Response.json({ error: "unexpected" }, { status: 404 })
    );
  };

  const tools = createCloudComputerTools({
    userId: USER_ID,
    fileStore,
    relayUrl: "https://relay.example.test",
    hmacSecret: SECRET,
    signingSecret: SECRET,
    fetchImpl: mockFetch,
  });

  const writeRes = await (tools.cloudWriteFile as any).execute(
    { path: "gen.py", content: "print('hi')\n" },
    { toolCallId: "cw1", messages: [] }
  );
  assert.equal(writeRes.status, "ok");

  const execRes = await (tools.cloudExec as any).execute(
    { command: "python3 gen.py", cwd: "/workspace" },
    { toolCallId: "ce1", messages: [] }
  );
  assert.equal(execRes.status, "ok");
  assert.equal(execRes.exitCode, 0);

  const pushPaused = await (tools.cloudExec as any).execute(
    { command: "git push origin main", cwd: "/workspace" },
    { toolCallId: "ce2", messages: [] }
  );
  assert.equal(pushPaused.status, "awaiting_approval");

  const exported = await (tools.cloudExportFileToChat as any).execute(
    { path: "/workspace/out.csv" },
    { toolCallId: "cx1", messages: [] }
  );
  assert.equal(exported.status, "ok");
  assert.match(String(exported.downloadUrl), /^\/api\/files\//);
  const rawToken = decodeURIComponent(
    String(exported.downloadUrl).replace("/api/files/", "")
  );
  const verified = verifySignedFileToken(rawToken, {
    expectedUserId: USER_ID,
    secret: SECRET,
  });
  assert.equal(verified.valid, true);

  const readBack = await (tools.cloudReadFile as any).execute(
    { path: "/workspace/out.csv" },
    { toolCallId: "cr1", messages: [] }
  );
  assert.equal(readBack.status, "ok");
  assert.match(String(readBack.content), /London,15/);

  const blockedRead = await (tools.cloudReadFile as any).execute(
    { path: "/workspace/korn-ferry-sa90.csv" },
    { toolCallId: "cr2", messages: [] }
  );
  assert.equal(blockedRead.status, "blocked");
});
