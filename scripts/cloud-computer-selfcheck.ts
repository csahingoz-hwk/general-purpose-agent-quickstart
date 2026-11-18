import { isCopilotFallbackConfigured } from "../lib/ai/copilot-vm-model";
import {
  callCloudRelay,
  cloudRunExec,
  isCloudComputerConfigured,
} from "../lib/cloud-computer/client";

async function main() {
  if (!isCloudComputerConfigured()) {
    console.log(
      "Cloud Computer self-check: SKIPPED (relay env not configured)"
    );
    return;
  }

  const res = await cloudRunExec({
    command:
      "uname -n && python3 -c \"import urllib.request; m='http://'+'169.254'+'.169.254';\ntry:\n urllib.request.urlopen(m,timeout=2); raise SystemExit(1)\nexcept Exception:\n print('metadata_blocked')\"",
    cwd: "/workspace",
    timeoutSec: 25,
  });

  if (res.exitCode !== 0 || !res.stdout.includes("metadata_blocked")) {
    throw new Error(
      `Cloud Computer self-check failed: exit=${res.exitCode} stdout=${res.stdout} stderr=${res.stderr}`
    );
  }

  let copilotSummary = "unconfigured";
  if (isCopilotFallbackConfigured()) {
    const cp = await callCloudRelay<{
      status: string;
      isAuthenticated: boolean;
      model: string | null;
    }>({
      pathname: "/copilot/status",
      payload: {},
      timeoutMs: 35_000,
    });
    if (!cp.isAuthenticated || !cp.model) {
      throw new Error(
        `Copilot VM fallback check failed: authenticated=${cp.isAuthenticated} model=${cp.model}`
      );
    }
    copilotSummary = `ready(${cp.model})`;
  }

  const hostLine = res.stdout.split("\n")[0]?.trim() || res.hostname || "vm";
  console.log(
    `Cloud Computer self-check: PASS vm=${hostLine} wake=${res.vmWakeMs ?? 0}ms exec=${res.durationMs}ms metadataBlocked=true copilotFallback=${copilotSummary}`
  );
}

main().catch((err) => {
  console.error(
    "Cloud Computer self-check FAILED:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
