#!/usr/bin/env node
/**
 * Sandboxed Cloud Computer daemon (`sandboxd`) running on GCE Ubuntu 24.04 VM
 * (`assistant-computer-01`) as unprivileged user `operator` inside `/workspace`.
 *
 * - Listens ONLY on internal VPC interface (protected by GCP internal-only
 *   firewall + constant-time HMAC-SHA256 with 60s replay protection).
 * - Zero database/OAuth credentials stored on the VM.
 * - Hosts the warm GitHub Copilot SDK (`@github/copilot-sdk`) fallback runtime
 *   strictly locked to `claude-haiku-5.5` (`mode: "empty"`, zero built-in VM tools).
 * - Auto-suspends / stops the VM after 20 minutes of inactivity to preserve
 *   the $40/mo Google AI Ultra credit.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

const PORT = Number.parseInt(process.env.SANDBOX_PORT ?? "8787", 10);
const WORKSPACE = path.resolve(process.env.SANDBOX_WORKSPACE ?? "/workspace");
const SECRET = (process.env.CLOUD_COMPUTER_HMAC_SECRET ?? "").trim();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/opt/playwright-browsers";
process.env.COPILOT_TELEMETRY_DISABLED = "true";
const IDLE_SUSPEND_MS = Number.parseInt(
  process.env.SANDBOX_IDLE_MS ?? String(20 * 60 * 1000),
  10
);
const COPILOT_BASE_DIR = "/tmp/copilot-sdk-runtime";
const ALLOWED_COPILOT_MODELS = new Set([
  "claude-haiku-5.5",
  "claude-haiku-4.5",
]);

if (SECRET.length < 16) {
  console.error("FATAL: CLOUD_COMPUTER_HMAC_SECRET (>=16 chars) is required.");
  process.exit(1);
}

let lastActivityAt = Date.now();
let warmCopilot = null; // { tokenDigest: string, client: CopilotClient, startPromise: Promise<CopilotClient> }

function verifyHmac(method, pathname, body, tsHeader, sigHeader) {
  const ts = Number.parseInt(String(tsHeader ?? ""), 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60_000) {
    return false;
  }
  const expected = createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${ts}.${method.toUpperCase()}.${pathname}.`)
    .update(body)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  let b;
  try {
    b = Buffer.from(String(sigHeader ?? ""), "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}

function safePath(raw = "") {
  const cleaned = String(raw || WORKSPACE).trim();
  if (cleaned.includes("\0")) {
    throw new Error("Invalid path");
  }
  const target = cleaned.startsWith(WORKSPACE)
    ? path.resolve(cleaned)
    : path.resolve(WORKSPACE, cleaned.replace(/^\/+/, ""));
  if (target !== WORKSPACE && !target.startsWith(`${WORKSPACE}/`)) {
    throw new Error("Path escapes /workspace");
  }
  return target;
}

function runShell(command, cwd, timeoutSec) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: WORKSPACE,
        USER: "operator",
        LANG: "C.UTF-8",
        DEBIAN_FRONTEND: "noninteractive",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < 65_536) {
        stdout += chunk.toString("utf8").slice(0, 65_536 - stdout.length);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 32_768) {
        stderr += chunk.toString("utf8").slice(0, 32_768 - stderr.length);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        status: code === 0 && !killed ? "ok" : "error",
        exitCode: killed ? 124 : (code ?? 1),
        stdout,
        stderr: killed ? `${stderr}\n[timed out after ${timeoutSec}s]` : stderr,
        cwd,
        durationMs: Date.now() - t0,
        hostname: os.hostname(),
      });
    });
  });
}

function stripHtmlToText(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, " ").trim().slice(0, 160)
    : "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
  return { title, text };
}

async function browseUrl(url, captureScreenshot) {
  try {
    const pw = await import(
      "/opt/sandboxd/node_modules/playwright-core/index.mjs"
    );
    const browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: "AssistantCloudComputer/1.0",
      });
      const page = await context.newPage();
      const resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      const finalUrl = page.url() || resp?.url() || url;
      const title = ((await page.title()) || finalUrl).trim().slice(0, 160);
      const rawBodyText = await page.evaluate(
        () =>
          document.body?.innerText || document.documentElement?.innerText || ""
      );
      const text = String(rawBodyText)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);
      let screenshotBase64;
      if (captureScreenshot) {
        const pngBuf = await page.screenshot({ type: "png", fullPage: false });
        screenshotBase64 = Buffer.from(pngBuf).toString("base64");
      }
      return {
        status: "ok",
        url: finalUrl,
        title,
        text,
        ...(screenshotBase64 ? { screenshotBase64 } : {}),
      };
    } finally {
      await browser.close().catch(() => null);
    }
  } catch {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "AssistantCloudComputer/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const { title, text } = stripHtmlToText(html);
    return {
      status: "ok",
      url: res.url || url,
      title: title || url,
      text,
    };
  }
}

function runMacSsh({ macHost, macUser, taskId, cwd, command, timeoutSec }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const remoteArgs = [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=8",
      `${macUser}@${macHost}`,
      "/Users/botrunner/bin/mac-bridge-exec",
      taskId,
      cwd,
      Buffer.from(command, "utf8").toString("base64"),
    ];
    execFile(
      "ssh",
      remoteArgs,
      { timeout: (timeoutSec || 45) * 1000, maxBuffer: 256 * 1024 },
      (err, stdout, stderr) => {
        const exitCode =
          err && typeof err.code === "number" ? err.code : err ? 1 : 0;
        resolve({
          status: exitCode === 0 ? "ok" : "error",
          exitCode,
          stdout: String(stdout ?? "").slice(0, 16_000),
          stderr: String(stderr ?? "").slice(0, 8000),
          durationMs: Date.now() - t0,
        });
      }
    );
  });
}

function resolveCopilotToken(headerToken) {
  return String(
    headerToken ||
      process.env.COPILOT_GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      ""
  ).trim();
}

async function resetCopilotClient() {
  const prev = warmCopilot;
  warmCopilot = null;
  if (prev?.client) {
    await prev.client.forceStop().catch(() => null);
  }
}

async function getCopilotClient(headerToken) {
  const token = resolveCopilotToken(headerToken);
  if (!token) {
    const err = new Error("copilot_token_missing");
    err.statusCode = 401;
    throw err;
  }
  const tokenDigest = createHash("sha256").update(token).digest("hex");
  if (warmCopilot && warmCopilot.tokenDigest === tokenDigest) {
    return await warmCopilot.startPromise;
  }
  await resetCopilotClient();
  await mkdir(COPILOT_BASE_DIR, { recursive: true });
  const { CopilotClient } = await import(
    "/opt/sandboxd/node_modules/@github/copilot-sdk/dist/index.js"
  );
  const client = new CopilotClient({
    mode: "empty",
    baseDirectory: COPILOT_BASE_DIR,
    gitHubToken: token,
    logLevel: "error",
    env: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: WORKSPACE,
      LANG: "C.UTF-8",
      COPILOT_TELEMETRY_DISABLED: "true",
    },
  });
  const startPromise = client
    .start()
    .then(() => client)
    .catch(async (err) => {
      await resetCopilotClient();
      throw err;
    });
  warmCopilot = { tokenDigest, client, startPromise };
  return await startPromise;
}

async function executeCopilotTurn(payload, headerToken, onDelta) {
  const requestedModel = ALLOWED_COPILOT_MODELS.has(String(payload.model ?? ""))
    ? String(payload.model)
    : "claude-haiku-5.5";
  const timeoutMs = Math.max(
    5000,
    Math.min(75_000, Number(payload.timeoutMs ?? 45_000))
  );
  const customTools = Array.isArray(payload.tools)
    ? payload.tools
        .filter(
          (t) =>
            t &&
            typeof t.name === "string" &&
            /^[a-zA-Z0-9_-]{1,64}$/.test(t.name)
        )
        .map((t) => ({
          name: t.name,
          description: String(t.description ?? ""),
          parameters:
            t.parameters && typeof t.parameters === "object"
              ? t.parameters
              : { type: "object", properties: {} },
          defer: "never",
        }))
    : [];
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments
        .filter(
          (a) =>
            a &&
            a.type === "blob" &&
            typeof a.data === "string" &&
            typeof a.mimeType === "string"
        )
        .map((a) => ({
          type: "blob",
          data: a.data,
          mimeType: a.mimeType,
        }))
    : [];

  let client;
  try {
    client = await getCopilotClient(headerToken);
    await client.ping("ok");
  } catch {
    await resetCopilotClient();
    client = await getCopilotClient(headerToken);
  }

  const session = await client.createSession({
    model: requestedModel,
    streaming: true,
    availableTools: customTools.map((t) => t.name),
    ...(customTools.length > 0 ? { tools: customTools } : {}),
    infiniteSessions: { enabled: false },
    memory: { enabled: false },
    enableSessionStore: false,
    enableSessionTelemetry: false,
    ...(payload.system
      ? {
          systemMessage: {
            mode: "replace",
            content: String(payload.system),
          },
        }
      : {}),
  });

  const sessionId = session.sessionId;
  let emittedDeltas = 0;
  let finalText = "";
  let settled = false;

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          const err = new Error("copilot_timeout");
          err.statusCode = 504;
          reject(err);
        }
      }, timeoutMs);

      const finishOk = (val) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(val);
      };

      const finishErr = (err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(err);
      };

      session.on("assistant.message_delta", (ev) => {
        const delta = ev?.data?.deltaContent;
        if (typeof delta === "string" && delta.length > 0 && !settled) {
          emittedDeltas += 1;
          finalText += delta;
          onDelta?.(delta);
        }
      });

      session.on("assistant.message", (ev) => {
        if (
          typeof ev?.data?.content === "string" &&
          ev.data.content.length > 0 &&
          emittedDeltas === 0
        ) {
          finalText = ev.data.content;
        }
        const toolRequests = Array.isArray(ev?.data?.toolRequests)
          ? ev.data.toolRequests
          : [];
        if (toolRequests.length > 0) {
          finishOk({
            status: "ok",
            model: requestedModel,
            finishReason: "tool-calls",
            text: finalText,
            emittedDeltas,
            toolCalls: toolRequests.map((tr) => ({
              toolCallId:
                typeof tr.toolCallId === "string" && tr.toolCallId
                  ? tr.toolCallId
                  : `cpcall-${Math.random().toString(36).slice(2, 10)}`,
              toolName: String(tr.name ?? ""),
              args:
                tr.arguments && typeof tr.arguments === "object"
                  ? tr.arguments
                  : {},
            })),
          });
        }
      });

      session.on("session.error", (ev) => {
        const err = new Error("copilot_session_error");
        err.statusCode = Number(ev?.data?.statusCode ?? 502);
        finishErr(err);
      });

      session.on("session.idle", () => {
        finishOk({
          status: "ok",
          model: requestedModel,
          finishReason: "stop",
          text: finalText,
          emittedDeltas,
          toolCalls: [],
        });
      });

      session
        .send({
          prompt: String(payload.prompt ?? ""),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(payload.responseSchema &&
          typeof payload.responseSchema === "object"
            ? { responseSchema: payload.responseSchema }
            : {}),
        })
        .catch(finishErr);
    });
  } finally {
    await session.abort().catch(() => null);
    await session.disconnect().catch(() => null);
    await client.deleteSession(sessionId).catch(() => null);
  }
}

await mkdir(WORKSPACE, { recursive: true });

const server = createServer(async (req, res) => {
  const urlObj = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && urlObj.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        hostname: os.hostname(),
        uptimeSec: Math.round(os.uptime()),
        idleSec: Math.round((Date.now() - lastActivityAt) / 1000),
      })
    );
    return;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");

  if (
    !verifyHmac(
      req.method || "POST",
      urlObj.pathname,
      rawBody,
      req.headers["x-sandbox-timestamp"],
      req.headers["x-sandbox-signature"]
    )
  ) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid sandbox signature" }));
    return;
  }

  lastActivityAt = Date.now();
  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  try {
    if (urlObj.pathname === "/exec") {
      const cwd = safePath(payload.cwd || WORKSPACE);
      await mkdir(cwd, { recursive: true });
      const out = await runShell(
        String(payload.command || "echo ok"),
        cwd,
        Math.max(2, Math.min(90, Number(payload.timeoutSec ?? 30)))
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }

    if (urlObj.pathname === "/files/write") {
      const filePath = safePath(payload.path);
      await mkdir(path.dirname(filePath), { recursive: true });
      const buf = Buffer.from(String(payload.contentBase64 ?? ""), "base64");
      if (buf.byteLength > 15 * 1024 * 1024) {
        throw new Error("File exceeds 15 MB limit");
      }
      await writeFile(filePath, buf);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          path: filePath,
          bytesWritten: buf.byteLength,
        })
      );
      return;
    }

    if (urlObj.pathname === "/files/read") {
      const filePath = safePath(payload.path);
      const info = await stat(filePath);
      if (!info.isFile() || info.size > 15 * 1024 * 1024) {
        throw new Error("Not a readable file <= 15 MB");
      }
      const buf = await readFile(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          path: filePath,
          sizeBytes: buf.byteLength,
          base64: buf.toString("base64"),
        })
      );
      return;
    }

    if (urlObj.pathname === "/browse") {
      const out = await browseUrl(
        String(payload.url ?? ""),
        payload.captureScreenshot === true
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }

    if (urlObj.pathname === "/mac-exec") {
      const out = await runMacSsh({
        macHost: String(payload.macHost ?? ""),
        macUser: "botrunner",
        taskId: String(payload.taskId ?? "task").replace(/[^a-zA-Z0-9_-]/g, ""),
        cwd: String(payload.cwd ?? "/Users/botrunner/workspaces"),
        command: String(payload.command ?? ""),
        timeoutSec: Math.max(
          2,
          Math.min(120, Number(payload.timeoutSec ?? 45))
        ),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }

    if (urlObj.pathname === "/copilot/status") {
      const client = await getCopilotClient(req.headers["x-copilot-token"]);
      const auth = await client.getAuthStatus();
      const models = await client.listModels();
      const haiku =
        models.find((m) => m.id === "claude-haiku-5.5") ||
        models.find((m) => m.id === "claude-haiku-4.5");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          isAuthenticated: Boolean(auth?.isAuthenticated),
          model: haiku?.id ?? null,
          modelName: haiku?.name ?? "Claude Haiku 5.5",
        })
      );
      return;
    }

    if (urlObj.pathname === "/copilot/chat") {
      if (payload.stream === true) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        try {
          const out = await executeCopilotTurn(
            payload,
            req.headers["x-copilot-token"],
            (delta) => {
              res.write(
                `data: ${JSON.stringify({ type: "text-delta", delta })}\n\n`
              );
            }
          );
          if (
            out.emittedDeltas === 0 &&
            typeof out.text === "string" &&
            out.text.length > 0 &&
            out.toolCalls.length === 0
          ) {
            res.write(
              `data: ${JSON.stringify({ type: "text-delta", delta: out.text })}\n\n`
            );
          }
          if (out.toolCalls.length > 0) {
            res.write(
              `data: ${JSON.stringify({ type: "tool-calls", toolCalls: out.toolCalls })}\n\n`
            );
          }
          res.write(
            `data: ${JSON.stringify({
              type: "finish",
              finishReason: out.finishReason,
              model: out.model,
            })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          res.end();
        } catch (streamErr) {
          const statusCode =
            streamErr && typeof streamErr.statusCode === "number"
              ? streamErr.statusCode
              : 502;
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              code: "copilot_stream_failed",
              statusCode,
            })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          res.end();
        }
        return;
      }

      const out = await executeCopilotTurn(
        payload,
        req.headers["x-copilot-token"]
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unknown route" }));
  } catch (err) {
    const statusCode =
      err && typeof err.statusCode === "number" ? err.statusCode : 400;
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Sandbox error",
      })
    );
  }
});

// Auto-stop/suspend watchdog after 20 minutes idle so VM compute costs ~$0 when unused.
setInterval(() => {
  if (Date.now() - lastActivityAt > IDLE_SUSPEND_MS) {
    execFile("/usr/local/bin/assistant-idle-stop", [], () => null);
  }
}, 60_000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`sandboxd listening on :${PORT} (workspace=${WORKSPACE})`);
});
