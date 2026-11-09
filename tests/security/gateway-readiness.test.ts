import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createGateway } from "ai";
import { LUNA, TERRA } from "../../lib/ai/routing/catalog";
import {
  classifyGatewayFailure,
  discoverGatewayReadiness,
  gatewaySlug,
} from "../../lib/ai/routing/gateway";
import {
  createGatewayAdapter,
  createRoutedModel,
} from "../../lib/ai/routing/model";
import type { InferenceSession } from "../../lib/ai/routing/session";

// What a deployed Vercel Function receives: the OIDC token only arrives in the
// `x-vercel-oidc-token` request header, never as process.env.VERCEL_OIDC_TOKEN.
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const syntheticOidcToken = () =>
  `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic`;

const lunaEntry = { id: gatewaySlug(LUNA), name: "GPT-6 Luna" };
const terraEntry = { id: gatewaySlug(TERRA), name: "GPT-6.1 Terra" };
// Mirrors the Gateway /config schema enforced by the SDK, including `specification`.
const catalogResponse = (...models: { id: string; name: string }[]) =>
  Response.json({
    models: models.map((model) => ({
      ...model,
      modelType: "language",
      specification: {
        specificationVersion: "v4",
        provider: "openai",
        modelId: model.id.replace("openai/", ""),
      },
    })),
  });

let priorEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  priorEnv = { ...process.env };
  for (const name of [
    "AI_GATEWAY_API_KEY",
    "VERCEL_OIDC_TOKEN",
    "AI_GATEWAY_USAGE_ENABLED",
    "AI_MONTHLY_ALLOWANCE_USD",
    "CHAT_PROVIDER",
    "ENABLE_LEGACY_GROQ",
  ]) {
    delete process.env[name];
  }
});
afterEach(() => {
  process.env = priorEnv;
  (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = undefined;
});
function deployedWithOidc(token = syntheticOidcToken()) {
  (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
    get: () => ({ headers: { "x-vercel-oidc-token": token } }),
  };
  return token;
}

test("Vercel deployment with automatic OIDC is ready without any credential in process.env", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  const token = deployedWithOidc();
  assert.equal(process.env.AI_GATEWAY_API_KEY, undefined);
  assert.equal(process.env.VERCEL_OIDC_TOKEN, undefined);
  const seen: { url: string; headers: Headers }[] = [];
  const provider = createGateway({
    fetch: (input, init) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers) });
      return Promise.resolve(catalogResponse(lunaEntry, terraEntry));
    },
  });
  const result = await discoverGatewayReadiness({ provider });
  assert.equal(result.status, "ready");
  assert.equal(result.reason, "ready");
  assert.deepEqual(
    result.models.map((model) => model.id),
    [LUNA, TERRA]
  );
  assert.equal(result.defaultModelId, LUNA);
  assert.deepEqual(result.unavailableModels, []);
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /\/config$/);
  // The native provider attached the request-scoped OIDC token itself.
  assert.equal(seen[0].headers.get("authorization"), `Bearer ${token}`);
  assert.equal(seen[0].headers.get("ai-gateway-auth-method"), "oidc");
});

test("an explicit Gateway API key is also resolved natively and wins over OIDC", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  process.env.AI_GATEWAY_API_KEY = "synthetic-gateway-key";
  deployedWithOidc();
  const seen: Headers[] = [];
  const provider = createGateway({
    fetch: (_input, init) => {
      seen.push(new Headers(init?.headers));
      return Promise.resolve(catalogResponse(lunaEntry));
    },
  });
  const result = await discoverGatewayReadiness({ provider });
  assert.equal(result.status, "ready");
  assert.equal(seen[0].get("authorization"), "Bearer synthetic-gateway-key");
  assert.equal(seen[0].get("ai-gateway-auth-method"), "api-key");
});

test("Terra missing keeps Luna ready and reports the exact missing slug; Luna is never replaced", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  deployedWithOidc();
  const onlyLuna = await discoverGatewayReadiness({
    provider: createGateway({
      fetch: () => Promise.resolve(catalogResponse(lunaEntry)),
    }),
  });
  assert.equal(onlyLuna.status, "ready");
  assert.deepEqual(
    onlyLuna.models.map((model) => model.id),
    [LUNA]
  );
  assert.deepEqual(onlyLuna.unavailableModels, ["openai/gpt-6.1-terra"]);

  const onlyTerra = await discoverGatewayReadiness({
    provider: createGateway({
      fetch: () => Promise.resolve(catalogResponse(terraEntry)),
    }),
  });
  assert.equal(onlyTerra.status, "temporarily_unavailable");
  assert.equal(onlyTerra.reason, "model_unavailable");
  assert.deepEqual(onlyTerra.models, []);
  assert.equal(onlyTerra.defaultModelId, null);
});

test("negative: no opt-in means setup_required and the catalog is never contacted", async () => {
  deployedWithOidc();
  const result = await discoverGatewayReadiness({
    provider: {
      getAvailableModels() {
        throw new Error("must not call the network");
      },
    },
  });
  assert.equal(result.status, "setup_required");
  assert.equal(result.reason, "provider_opt_in_missing");
  assert.deepEqual(result.models, []);
  assert.match(result.hint ?? "", /AI_GATEWAY_USAGE_ENABLED/);
});

test("negative: legacy Groq mode never reports the Gateway lane as ready", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  process.env.CHAT_PROVIDER = "groq-legacy";
  process.env.ENABLE_LEGACY_GROQ = "true";
  deployedWithOidc();
  const result = await discoverGatewayReadiness({
    provider: createGateway({
      fetch: () => Promise.resolve(catalogResponse(lunaEntry)),
    }),
  });
  assert.equal(result.reason, "provider_opt_in_missing");
});

test("negative: invalid spend allowance is reported before any network call", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  deployedWithOidc();
  for (const bad of ["0", "-1", "11", "abc"]) {
    process.env.AI_MONTHLY_ALLOWANCE_USD = bad;
    const result = await discoverGatewayReadiness({
      provider: {
        getAvailableModels() {
          throw new Error("must not call the network");
        },
      },
    });
    assert.equal(result.reason, "spend_configuration_invalid", bad);
    assert.equal(result.status, "setup_required");
  }
});

test("negative: opted in with no credential anywhere is gateway_auth_missing and never ready", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  // No API key, no OIDC request header, no VERCEL_OIDC_TOKEN.
  let networkCalls = 0;
  const result = await discoverGatewayReadiness({
    provider: createGateway({
      fetch: () => {
        networkCalls += 1;
        return Promise.resolve(catalogResponse(lunaEntry, terraEntry));
      },
    }),
  });
  assert.equal(result.status, "setup_required");
  assert.equal(result.reason, "gateway_auth_missing");
  assert.deepEqual(result.models, []);
  assert.equal(result.defaultModelId, null);
  assert.equal(networkCalls, 0);
  assert.match(result.hint ?? "", /OIDC/);
});

test("negative: a rejected credential is gateway_auth_rejected without leaking the upstream body", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  process.env.AI_GATEWAY_API_KEY = "synthetic-bad-key";
  const result = await discoverGatewayReadiness({
    provider: createGateway({
      fetch: () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                message: "secret-upstream-detail",
                type: "authentication_error",
              },
            },
            { status: 401 }
          )
        ),
    }),
  });
  assert.equal(result.status, "setup_required");
  assert.equal(result.reason, "gateway_auth_rejected");
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret-upstream-detail|synthetic-bad-key/
  );
});

test("negative: catalog outage and timeout are temporary, not setup problems, and never cached as ready", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  deployedWithOidc();
  const down = await discoverGatewayReadiness({
    provider: createGateway({
      fetch: () => Promise.resolve(new Response("upstream", { status: 503 })),
    }),
  });
  assert.equal(down.status, "temporarily_unavailable");
  assert.equal(down.reason, "catalog_unavailable");
  const slow = await discoverGatewayReadiness({
    timeoutMs: 20,
    provider: { getAvailableModels: () => new Promise(() => undefined) },
  });
  assert.equal(slow.reason, "catalog_unavailable");
  assert.equal(slow.status, "temporarily_unavailable");
});

test("failure classification separates a missing credential from a server rejection and never returns raw text", () => {
  // Raised locally while resolving the credential: the cause has no HTTP status.
  assert.equal(
    classifyGatewayFailure({
      name: "GatewayAuthenticationError",
      cause: new Error("no oidc token"),
    }),
    "gateway_auth_missing"
  );
  // Raised from a 401 response: the cause carries the status.
  assert.equal(
    classifyGatewayFailure({
      name: "GatewayAuthenticationError",
      cause: { statusCode: 401 },
    }),
    "gateway_auth_rejected"
  );
  assert.equal(
    classifyGatewayFailure({ statusCode: 403 }),
    "gateway_auth_rejected"
  );
  assert.equal(
    classifyGatewayFailure(new Error("socket hang up")),
    "catalog_unavailable"
  );
});

test("inference uses the native provider with the exact OpenAI slug, request-scoped OIDC and OpenAI-only routing", async () => {
  process.env.AI_GATEWAY_USAGE_ENABLED = "true";
  const token = deployedWithOidc();
  const requests: { url: string; headers: Headers; body: string }[] = [];
  const provider = createGateway({
    fetch: (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ""),
      });
      // Make the call fail after capture; this test inspects the request only.
      return Promise.resolve(new Response("{}", { status: 500 }));
    },
  });
  const session = {
    available: [LUNA, TERRA],
    exposed: false,
    toolBoundary: false,
    fallbackUsed: false,
    ledger: {
      reserve: () => Promise.resolve("reservation"),
      settle: () => Promise.resolve(),
    },
  } as unknown as InferenceSession;
  const model = createRoutedModel(
    LUNA,
    session,
    (id) => createGatewayAdapter(id, provider),
    { gateway: true }
  );
  try {
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
  } catch {
    // Expected: the stubbed upstream fails after the request is captured.
  }
  const first = requests.find((request) =>
    request.url.endsWith("/language-model")
  );
  assert.ok(first, "expected a Gateway language-model request");
  assert.equal(first.headers.get("ai-language-model-id"), "openai/gpt-6-luna");
  assert.equal(first.headers.get("authorization"), `Bearer ${token}`);
  const body = JSON.parse(first.body);
  assert.deepEqual(body.providerOptions.gateway, { only: ["openai"] });
  assert.equal(body.providerOptions.openai.store, false);
  assert.equal(body.maxOutputTokens, 2048);
});
