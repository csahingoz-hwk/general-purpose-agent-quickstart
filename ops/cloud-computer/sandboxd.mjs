#!/usr/bin/env node
/**
 * Sandboxed Cloud Computer daemon (`sandboxd`) running on GCE Ubuntu 24.04 VM
 * (`assistant-computer-01`) as unprivileged user `operator` inside `/workspace`.
 *
 * - Listens ONLY on internal VPC interface (protected by GCP internal-only
 *   firewall + constant-time HMAC-SHA256 with 60s replay protection).
 * - Zero database/OAuth credentials stored on the VM.
 * - Auto-suspends / stops the VM after 20 minutes of inactivity to preserve
 *   the $40/mo Google AI Ultra credit.
 */
import { execFile, spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

const PORT = Number.parseInt(process.env.SANDBOX_PORT ?? "8787", 10);
const WORKSPACE = path.resolve(process.env.SANDBOX_WORKSPACE ?? "/workspace");
const SECRET = (process.env.CLOUD_COMPUTER_HMAC_SECRET ?? "").trim();
const IDLE_SUSPEND_MS = Number.parseInt(
  process.env.SANDBOX_IDLE_MS ?? String(20 * 60 * 1000),
  10
);

if (SECRET.length < 16) {
  console.error("FATAL: CLOUD_COMPUTER_HMAC_SECRET (>=16 chars) is required.");
  process.exit(1);
}

let lastActivityAt = Date.now();

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
  // Prefer Chromium headless if installed; fall back to clean HTTP fetch.
  const shotPath = path.join(os.tmpdir(), `shot-${Date.now()}.png`);
  if (captureScreenshot) {
    await new Promise((resolve) => {
      execFile(
        "chromium-browser",
        [
          "--headless",
          "--disable-gpu",
          "--no-sandbox",
          "--window-size=1280,800",
          `--screenshot=${shotPath}`,
          url,
        ],
        { timeout: 20_000 },
        () => resolve(null)
      );
    });
  }
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "AssistantCloudComputer/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await res.text();
  const { title, text } = stripHtmlToText(html);
  let screenshotBase64;
  if (captureScreenshot) {
    try {
      const buf = await readFile(shotPath);
      screenshotBase64 = buf.toString("base64");
    } catch {
      /* optional */
    }
  }
  return {
    status: "ok",
    url: res.url || url,
    title: title || url,
    text,
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
  };
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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unknown route" }));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
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
