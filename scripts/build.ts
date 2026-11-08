import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { verifyGroqModels } from "../lib/ai/groq-verification";
import { legacyEnabled, openAIEnabled } from "../lib/ai/routing/catalog";

async function main() {
  const verification = await verifyGroqModels(
    legacyEnabled() ? process.env.GROQ_API_KEY : undefined
  );
  // Only non-secret verification metadata is inlined. The key stays server-only.
  console.log(
    legacyEnabled()
      ? `Legacy readiness: ${verification.status}; verified candidates: ${verification.modelIds.length}; check: ${verification.diagnostic ?? "ok"}`
      : `OpenAI integration: ${openAIEnabled() ? "configured (access untested)" : "disabled or missing credentials"}; build does not perform inference`
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
