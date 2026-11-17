import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const SECRET = (process.env.CLOUD_COMPUTER_HMAC_SECRET ?? "").trim();
const GCP_PROJECT = process.env.GCP_PROJECT ?? "project-cd0bc64c-0025-446c-b41";
const GCP_ZONE = process.env.GCP_ZONE ?? "europe-west1-b";
const VM_NAME = process.env.VM_NAME ?? "assistant-computer-01";
const SANDBOX_PORT = Number.parseInt(process.env.SANDBOX_PORT ?? "8787", 10);

function signHmac(method, pathname, body, ts) {
  return createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${ts}.${method.toUpperCase()}.${pathname}.`)
    .update(body)
    .digest("hex");
}

function verifyHmac(method, pathname, body, tsHeader, sigHeader) {
  const ts = Number.parseInt(String(tsHeader ?? ""), 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60_000) {
    return false;
  }
  const expected = signHmac(method, pathname, body, ts);
  const a = Buffer.from(expected, "hex");
  let b;
  try {
    b = Buffer.from(String(sigHeader ?? ""), "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}

async function getMetadataAccessToken() {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  const json = await res.json();
  return json.access_token;
}

async function ensureVmRunningAndGetInternalIp() {
  const t0 = Date.now();
  const token = await getMetadataAccessToken();
  const baseUrl = `https://compute.googleapis.com/compute/v1/projects/${GCP_PROJECT}/zones/${GCP_ZONE}/instances/${VM_NAME}`;

  const getVm = async () => {
    const r = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      throw new Error(`Compute API returned ${r.status}`);
    }
    return await r.json();
  };

  let vm = await getVm();
  if (vm.status === "SUSPENDED") {
    await fetch(`${baseUrl}/resume`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } else if (vm.status === "TERMINATED" || vm.status === "STOPPED") {
    await fetch(`${baseUrl}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  for (let i = 0; i < 30; i += 1) {
    if (vm.status === "RUNNING") {
      const ip = vm.networkInterfaces?.[0]?.networkIP;
      if (ip) {
        // Confirm sandboxd HTTP socket is ready after wake/boot
        try {
          const h = await fetch(`http://${ip}:${SANDBOX_PORT}/healthz`, {
            signal: AbortSignal.timeout(2500),
          });
          if (h.ok) {
            return { ip, vmWakeMs: Date.now() - t0 };
          }
        } catch {
          /* wait 1s */
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
    vm = await getVm();
  }
  throw new Error(
    "Cloud Computer VM is still waking up; try again in a few seconds."
  );
}

const server = createServer(async (req, res) => {
  const urlObj = new URL(req.url || "/", "http://localhost");
  if (
    req.method === "GET" &&
    (urlObj.pathname === "/healthz" || urlObj.pathname === "/status")
  ) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, relay: "assistant-computer-relay" }));
    return;
  }

  const chunks = [];
  for await (const c of req) {
    chunks.push(c);
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
    res.end(JSON.stringify({ error: "Unauthorized relay request" }));
    return;
  }

  try {
    const { ip, vmWakeMs } = await ensureVmRunningAndGetInternalIp();
    const ts = String(Date.now());
    const sig = signHmac("POST", urlObj.pathname, rawBody, ts);
    const upstream = await fetch(
      `http://${ip}:${SANDBOX_PORT}${urlObj.pathname}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sandbox-Timestamp": ts,
          "X-Sandbox-Signature": sig,
        },
        body: rawBody,
        signal: AbortSignal.timeout(95_000),
      }
    );
    const text = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        parsed.vmWakeMs = vmWakeMs;
      }
    } catch {
      parsed = null;
    }
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(parsed ? JSON.stringify(parsed) : text);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Relay failed",
      })
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`assistant-computer-relay listening on :${PORT}`);
});
