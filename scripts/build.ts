import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { verifyGroqModels } from "../lib/ai/groq-verification";

async function main() {
  const verification = await verifyGroqModels(process.env.GROQ_API_KEY);
  // Only non-secret verification metadata is inlined. The key stays server-only.
  console.log(
    `Chat readiness: ${verification.status}; verified candidates: ${verification.modelIds.length}; check: ${verification.diagnostic ?? "ok"}`
  );
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/next/dist/bin/next"), "build"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        VERIFIED_GROQ_MODELS: JSON.stringify(verification),
      },
    }
  );
  process.exitCode = result.status ?? 1;
}
main().catch(() => {
  console.error("Build preparation failed");
  process.exitCode = 1;
});
