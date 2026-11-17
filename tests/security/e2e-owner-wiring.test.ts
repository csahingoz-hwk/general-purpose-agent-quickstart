import assert from "node:assert/strict";
import { test } from "node:test";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import { getCapabilities } from "../../lib/ai/models";
import { filterFactsForBot } from "../../lib/bots/roster";
import { isGithubConnectorEnabled } from "../../lib/connectors/calendar-and-github";
import { isGoogleConnectorsEnabled } from "../../lib/connectors/google-vault-auth";
import { isRoutinesEnabled } from "../../lib/cron/routine-presets";
import { isMediaStudioEnabled } from "../../lib/media/media-studio";
import {
  createInMemoryMemoryStore,
  isMemoryToolsEnabled,
} from "../../lib/memory/store";
import {
  createInMemoryVaultStore,
  isVaultConfigured,
} from "../../lib/vault/secret-vault";
import {
  createLiveVoiceSessionDescriptor,
  isVoiceEnabled,
} from "../../lib/voice/voice-service";

function userTurn(text: string) {
  return {
    id: "turn-1",
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  };
}

test("after owner verification, AUTH_SECRET + default flags embed vault, voice, memory, routines, connectors, vision, and media out of the box", async () => {
  const savedEnv = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    SECRET_VAULT_KEY: process.env.SECRET_VAULT_KEY,
    MEMORY_TOOLS_ENABLED: process.env.MEMORY_TOOLS_ENABLED,
    ROUTINES_ENABLED: process.env.ROUTINES_ENABLED,
    VOICE_ENABLED: process.env.VOICE_ENABLED,
    GOOGLE_CONNECTORS_ENABLED: process.env.GOOGLE_CONNECTORS_ENABLED,
    GITHUB_CONNECTOR_ENABLED: process.env.GITHUB_CONNECTOR_ENABLED,
    MEDIA_STUDIO_ENABLED: process.env.MEDIA_STUDIO_ENABLED,
  };

  try {
    Reflect.deleteProperty(process.env, "SECRET_VAULT_KEY");
    Reflect.deleteProperty(process.env, "MEMORY_TOOLS_ENABLED");
    Reflect.deleteProperty(process.env, "ROUTINES_ENABLED");
    Reflect.deleteProperty(process.env, "VOICE_ENABLED");
    Reflect.deleteProperty(process.env, "GOOGLE_CONNECTORS_ENABLED");
    Reflect.deleteProperty(process.env, "GITHUB_CONNECTOR_ENABLED");
    Reflect.deleteProperty(process.env, "MEDIA_STUDIO_ENABLED");
    process.env.AUTH_SECRET =
      "verified-owner-auth-secret-with-at-least-32-chars";

    // 1. Vault is immediately ready via domain-separated HKDF over AUTH_SECRET
    assert.equal(isVaultConfigured(), true);
    const vault = createInMemoryVaultStore();

    // 2. Mixed-case secret name ("Gemini_API_Key") normalizes to GEMINI_API_KEY and unlocks Live Voice
    const stored = await vault.upsertSecret({
      userId: "owner-1",
      name: "Gemini_API_Key",
      provider: "gemini",
      plaintext: "AIzaSyTestOwnerPersonalKey987654",
    });
    assert.equal(stored.name, "GEMINI_API_KEY");
    assert.equal(isVoiceEnabled(), true);

    const live = await createLiveVoiceSessionDescriptor({
      userId: "owner-1",
      vaultStore: vault,
    });
    assert.equal(live.status, "ready");

    // 3. Owner capabilities default on without extra *_ENABLED env vars
    assert.equal(isMemoryToolsEnabled(), true);
    assert.equal(isRoutinesEnabled(), true);
    assert.equal(isGoogleConnectorsEnabled(), true);
    assert.equal(isGithubConnectorEnabled(), true);
    assert.equal(isMediaStudioEnabled(), true);

    // 4. Premium models support vision attachments out of the box
    const caps = getCapabilities();
    assert.equal(caps["gpt-6-luna"]?.vision, true);
    assert.equal(caps["gpt-6.1-terra"]?.vision, true);

    // 5. Ordinary chat stays zero-tool (fast & economical), while explicit owner intents select tools
    assert.deepEqual(
      selectActiveTools([userTurn("Hello, how are you today?")], true, false),
      []
    );
    assert.deepEqual(
      selectActiveTools(
        [userTurn("Schedule a routine every weekday at 8am for my briefing")],
        true,
        false
      ),
      ["scheduleTask"]
    );
    assert.deepEqual(
      selectActiveTools(
        [userTurn("Generate an image of a calm coastal lighthouse")],
        true,
        false
      ),
      ["generateImageAsset"]
    );

    // 6. Durable profile facts filter cleanly for active teammate context injection
    const mem = createInMemoryMemoryStore();
    await mem.upsertProfileFact({
      userId: "owner-1",
      category: "preference",
      key: "currency",
      value: "GBP",
      sharedAcrossBots: true,
    });
    await mem.upsertProfileFact({
      userId: "owner-1",
      category: "finance",
      key: "materiality_threshold",
      value: "£25k",
      sharedAcrossBots: false,
      botSlug: "finance-controller",
    });
    const allFacts = await mem.listProfileFacts({ userId: "owner-1" });
    assert.equal(filterFactsForBot(allFacts, "chief-of-staff").length, 1);
    assert.equal(filterFactsForBot(allFacts, "finance-controller").length, 2);
  } finally {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = val;
      }
    }
  }
});
