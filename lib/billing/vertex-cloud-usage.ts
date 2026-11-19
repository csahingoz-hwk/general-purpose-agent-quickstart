import {
  getVertexProjectId,
  getVertexWifAccessToken,
  isVertexWifConfigured,
} from "@/lib/ai/vertex-auth";
import type { CloudBillingMissingCode } from "@/lib/ui-copy";

export const VERTEX_BILLING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_ULTRA_MONTHLY_CREDIT_USD = 40;
export const DEFAULT_BILLING_ACCOUNT_ID = "0140A2-72DEB2-62EDCD";

/**
 * Reference Vertex list rates (USD per 1M tokens) used ONLY for informational
 * finance table estimates when BigQuery line-item export is not yet enabled.
 * Actual billing & alerts live in Google Cloud (`0140A2-72DEB2-62EDCD`).
 */
const REFERENCE_RATES_PER_1M_USD: Record<
  string,
  { input: number; output: number; funding: "ultra_credit" | "copilot_sub" }
> = {
  "gemini-4-hydrogen": { input: 0.15, output: 0.6, funding: "ultra_credit" },
  "gemini-4-argon": { input: 1.25, output: 5.0, funding: "ultra_credit" },
  "claude-haiku-5.5": { input: 0, output: 0, funding: "copilot_sub" },
};

export function estimateReferenceModelUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rate = REFERENCE_RATES_PER_1M_USD[modelId];
  if (!rate || rate.funding === "copilot_sub") {
    return 0;
  }
  return (
    (Math.max(0, inputTokens) / 1_000_000) * rate.input +
    (Math.max(0, outputTokens) / 1_000_000) * rate.output
  );
}

export type VertexCloudBillingStatus = {
  reachable: boolean;
  source: "gcp_bigquery_and_budgets" | "gcp_budgets_only" | "app_token_logs";
  projectId: string | null;
  billingAccountId: string;
  currency: string;
  /** Monthly credit/budget target in USD (from Cloud Billing Budgets API or $40 Ultra credit). */
  monthlyCreditLimitUsd: number;
  /** Real MTD gross cost before credits (null when BigQuery billing export isn't reachable). */
  mtdGrossCostUsd: number | null;
  /** Real MTD credits applied in Google Cloud (null when BigQuery billing export isn't reachable). */
  mtdCreditsUsedUsd: number | null;
  /** Real remaining credit from Google Cloud when obtainable, else null. */
  creditsRemainingUsd: number | null;
  /** Exact technical reason when live Cloud Billing / BigQuery data is not reachable. */
  missingReason: string | null;
  /** Locale-neutral reason code + API detail for EN/TR rendering on /usage. */
  missingCode?: CloudBillingMissingCode | null;
  missingDetail?: string | null;
  /** One-click Google Cloud Console URL for the owner Setup checklist item. */
  setupActionUrl: string;
  setupActionLabel: string;
  checkedAt: string;
};

let cachedBilling: {
  key: string;
  expiresAtMs: number;
  value: VertexCloudBillingStatus;
} | null = null;

export function clearVertexCloudBillingCacheForTests(): void {
  cachedBilling = null;
}

function parseMoneyAmount(
  money?: {
    units?: string | number;
    nanos?: number;
    currencyCode?: string;
  } | null
): number | null {
  if (!money) {
    return null;
  }
  const units = Number(money.units ?? 0);
  const nanos = Number(money.nanos ?? 0) / 1_000_000_000;
  const total = units + nanos;
  return Number.isFinite(total) ? Math.round(total * 10_000) / 10_000 : null;
}

function buildEnableBillingApisUrl(projectId: string | null): string {
  const base =
    "https://console.cloud.google.com/flows/enableapi?apiid=cloudbilling.googleapis.com,billingbudgets.googleapis.com,bigquery.googleapis.com";
  return projectId ? `${base}&project=${encodeURIComponent(projectId)}` : base;
}

function buildBillingExportConsoleUrl(billingAccountId: string): string {
  return `https://console.cloud.google.com/billing/${encodeURIComponent(billingAccountId)}/export`;
}

function classifyGoogleApiError(
  status: number,
  bodyText: string,
  apiLabel: string,
  projectId: string | null,
  billingAccountId: string
): {
  reason: string;
  missingCode: CloudBillingMissingCode;
  missingDetail: string;
  actionUrl: string;
  actionLabel: string;
} {
  if (
    status === 403 &&
    /SERVICE_DISABLED|accessNotConfigured|has not been used in project/i.test(
      bodyText
    )
  ) {
    return {
      reason: `${apiLabel} henüz Vertex projesinde (${projectId ?? "GCP"}) etkinleştirilmemiş.`,
      missingCode: "api_disabled",
      missingDetail: apiLabel,
      actionUrl: buildEnableBillingApisUrl(projectId),
      actionLabel: "Enable Billing APIs",
    };
  }
  if (status === 403 || status === 401) {
    return {
      reason: `Vertex WIF servis hesabında '${apiLabel}' okuma yetkisi eksik (faturalandırma hesabı ${billingAccountId} üzerinde 'roles/billing.viewer' izni gerekli).`,
      missingCode: "billing_permission_denied",
      missingDetail: apiLabel,
      actionUrl: `https://console.cloud.google.com/billing/${encodeURIComponent(billingAccountId)}/manage`,
      actionLabel: "Grant Billing Viewer",
    };
  }
  return {
    reason: `${apiLabel} yanıt vermedi (HTTP ${status}).`,
    missingCode: "http_error",
    missingDetail: `${apiLabel} (HTTP ${status})`,
    actionUrl: buildEnableBillingApisUrl(projectId),
    actionLabel: "Open Cloud Billing",
  };
}

async function discoverAndQueryBigQueryBillingExport(opts: {
  projectId: string;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<
  | {
      ok: true;
      grossCostUsd: number;
      creditsUsedUsd: number;
      currency: string;
    }
  | {
      ok: false;
      missingReason: string;
      missingCode: CloudBillingMissingCode;
      missingDetail: string | null;
      actionUrl: string;
      actionLabel: string;
    }
> {
  const configuredTable = process.env.GOOGLE_BIGQUERY_BILLING_TABLE?.trim();
  let fqTable = configuredTable || null;

  if (!fqTable) {
    const dsRes = await opts.fetchImpl(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(opts.projectId)}/datasets?maxResults=25`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!dsRes.ok) {
      const txt = await dsRes.text().catch(() => "");
      const diag = classifyGoogleApiError(
        dsRes.status,
        txt,
        "BigQuery API (bigquery.googleapis.com)",
        opts.projectId,
        DEFAULT_BILLING_ACCOUNT_ID
      );
      return {
        ok: false,
        missingReason: diag.reason,
        missingCode: diag.missingCode,
        missingDetail: diag.missingDetail,
        actionUrl: diag.actionUrl,
        actionLabel: diag.actionLabel,
      };
    }
    const dsJson = (await dsRes.json()) as {
      datasets?: Array<{ datasetReference?: { datasetId?: string } }>;
    };
    const datasetIds = (dsJson.datasets ?? [])
      .map((d) => d.datasetReference?.datasetId)
      .filter((id): id is string => Boolean(id));

    for (const datasetId of datasetIds.slice(0, 6)) {
      const tblRes = await opts
        .fetchImpl(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(opts.projectId)}/datasets/${encodeURIComponent(datasetId)}/tables?maxResults=25`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${opts.accessToken}` },
            signal: AbortSignal.timeout(2500),
          }
        )
        .catch(() => null);
      if (!tblRes?.ok) {
        continue;
      }
      const tblJson = (await tblRes.json()) as {
        tables?: Array<{ tableReference?: { tableId?: string } }>;
      };
      const match = (tblJson.tables ?? [])
        .map((t) => t.tableReference?.tableId)
        .find(
          (id): id is string =>
            typeof id === "string" &&
            /^gcp_billing_export_(?:resource_)?v1_/i.test(id)
        );
      if (match) {
        fqTable = `${opts.projectId}.${datasetId}.${match}`;
        break;
      }
    }
  }

  if (!fqTable || !/^[A-Za-z0-9_.-]+$/.test(fqTable)) {
    return {
      ok: false,
      missingReason:
        "Cloud Billing -> BigQuery standart maliyet dışa aktarımı (gcp_billing_export_v1) henüz bu projede etkinleştirilmemiş.",
      missingCode: "bigquery_export_missing",
      missingDetail: null,
      actionUrl: buildBillingExportConsoleUrl(DEFAULT_BILLING_ACCOUNT_ID),
      actionLabel: "Enable Billing Export",
    };
  }

  const invoiceMonth = new Date().toISOString().slice(0, 7).replace("-", "");
  const query = `
    SELECT
      COALESCE(SUM(cost), 0) AS gross_cost,
      COALESCE(SUM((SELECT COALESCE(SUM(c.amount), 0) FROM UNNEST(credits) AS c)), 0) AS credits_sum,
      ANY_VALUE(currency) AS currency
    FROM \`${fqTable}\`
    WHERE invoice.month = @invoiceMonth
      AND project.id = @projectId
  `;

  const qRes = await opts.fetchImpl(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(opts.projectId)}/queries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        useLegacySql: false,
        timeoutMs: 3500,
        maximumBytesBilled: "50000000",
        queryParameters: [
          {
            name: "invoiceMonth",
            parameterType: { type: "STRING" },
            parameterValue: { value: invoiceMonth },
          },
          {
            name: "projectId",
            parameterType: { type: "STRING" },
            parameterValue: { value: opts.projectId },
          },
        ],
      }),
      signal: AbortSignal.timeout(4000),
    }
  );

  if (!qRes.ok) {
    const txt = await qRes.text().catch(() => "");
    const diag = classifyGoogleApiError(
      qRes.status,
      txt,
      "BigQuery Billing Export sorgusu (roles/bigquery.jobUser + roles/bigquery.dataViewer)",
      opts.projectId,
      DEFAULT_BILLING_ACCOUNT_ID
    );
    return {
      ok: false,
      missingReason: diag.reason,
      missingCode: diag.missingCode,
      missingDetail: diag.missingDetail,
      actionUrl: diag.actionUrl,
      actionLabel: diag.actionLabel,
    };
  }

  const qJson = (await qRes.json()) as {
    rows?: Array<{ f?: Array<{ v?: string | null }> }>;
  };
  const fields = qJson.rows?.[0]?.f ?? [];
  const gross = Number(fields[0]?.v ?? 0);
  const creditsSum = Number(fields[1]?.v ?? 0); // negative in GCP billing export
  const currency = fields[2]?.v || "USD";
  return {
    ok: true,
    grossCostUsd: Number.isFinite(gross) ? Math.max(0, gross) : 0,
    creditsUsedUsd: Number.isFinite(creditsSum) ? Math.abs(creditsSum) : 0,
    currency,
  };
}

/**
 * Queries Google Cloud Billing API + Cloud Billing Budgets API + BigQuery Billing
 * Export (strictly read-only) using the existing server-side Vertex WIF credentials,
 * cached for 1 hour. Never throws — returns exact diagnostic & one-click Setup link
 * when an API or IAM role is missing.
 */
export async function getVertexCloudBillingStatus(opts?: {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string>;
  projectId?: string | null;
  forceRefresh?: boolean;
}): Promise<VertexCloudBillingStatus> {
  const fetchFn = opts?.fetchImpl ?? fetch;
  const projectId =
    opts?.projectId !== undefined ? opts.projectId : getVertexProjectId();
  const configuredBillingAccount =
    process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID?.trim() ||
    DEFAULT_BILLING_ACCOUNT_ID;
  const cacheKey = `${projectId ?? "none"}:${configuredBillingAccount}`;

  if (
    !opts?.forceRefresh &&
    !opts?.fetchImpl &&
    cachedBilling &&
    cachedBilling.key === cacheKey &&
    cachedBilling.expiresAtMs > Date.now()
  ) {
    return cachedBilling.value;
  }

  const checkedAt = new Date().toISOString();
  if (!projectId || (!opts?.getAccessToken && !isVertexWifConfigured())) {
    return {
      reachable: false,
      source: "app_token_logs",
      projectId,
      billingAccountId: configuredBillingAccount,
      currency: "USD",
      monthlyCreditLimitUsd: DEFAULT_ULTRA_MONTHLY_CREDIT_USD,
      mtdGrossCostUsd: null,
      mtdCreditsUsedUsd: null,
      creditsRemainingUsd: null,
      missingReason:
        "Vertex AI Workload Identity Federation (GOOGLE_VERTEX_PROJECT_ID + GOOGLE_VERTEX_WORKLOAD_AUDIENCE) bu ortamda tanımlı değil.",
      missingCode: "wif_not_configured",
      missingDetail: null,
      setupActionUrl: buildEnableBillingApisUrl(projectId),
      setupActionLabel: "Open Google Cloud",
      checkedAt,
    };
  }

  let accessToken: string;
  try {
    accessToken = opts?.getAccessToken
      ? await opts.getAccessToken()
      : await getVertexWifAccessToken(fetchFn);
  } catch {
    return {
      reachable: false,
      source: "app_token_logs",
      projectId,
      billingAccountId: configuredBillingAccount,
      currency: "USD",
      monthlyCreditLimitUsd: DEFAULT_ULTRA_MONTHLY_CREDIT_USD,
      mtdGrossCostUsd: null,
      mtdCreditsUsedUsd: null,
      creditsRemainingUsd: null,
      missingReason:
        "Sunucu ortamında aktif Vercel OIDC belirteci alınamadı; canlı Google Cloud fatura sorgusu yalnızca Vercel sunucusunda çalışır.",
      missingCode: "oidc_unavailable",
      missingDetail: null,
      setupActionUrl: buildEnableBillingApisUrl(projectId),
      setupActionLabel: "Open Cloud Billing",
      checkedAt,
    };
  }

  // 1. Read-only Cloud Billing project association check
  let billingAccountId = configuredBillingAccount;
  let billingMissingReason: string | null = null;
  let billingMissingCode: CloudBillingMissingCode | null = null;
  let billingMissingDetail: string | null = null;
  let setupActionUrl = buildEnableBillingApisUrl(projectId);
  let setupActionLabel = "Enable Billing APIs";

  try {
    const infoRes = await fetchFn(
      `https://cloudbilling.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/billingInfo`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (infoRes.ok) {
      const infoJson = (await infoRes.json()) as {
        billingAccountName?: string;
        billingEnabled?: boolean;
      };
      const match = infoJson.billingAccountName?.match(
        /billingAccounts\/([^/]+)/
      );
      if (match?.[1]) {
        billingAccountId = match[1];
      }
    } else {
      const txt = await infoRes.text().catch(() => "");
      const diag = classifyGoogleApiError(
        infoRes.status,
        txt,
        "Cloud Billing API (cloudbilling.googleapis.com)",
        projectId,
        billingAccountId
      );
      billingMissingReason = diag.reason;
      billingMissingCode = diag.missingCode;
      billingMissingDetail = diag.missingDetail;
      setupActionUrl = diag.actionUrl;
      setupActionLabel = diag.actionLabel;
    }
  } catch {
    billingMissingReason =
      "Cloud Billing API (cloudbilling.googleapis.com) zaman aşımına uğradı.";
    billingMissingCode = "timeout";
    billingMissingDetail = "Cloud Billing API (cloudbilling.googleapis.com)";
  }

  // 2. Read-only Cloud Billing Budgets API check (for configured monthly budget/credit alert)
  let monthlyCreditLimitUsd = DEFAULT_ULTRA_MONTHLY_CREDIT_USD;
  let currency = "USD";
  let budgetsReachable = false;

  try {
    const budRes = await fetchFn(
      `https://billingbudgets.googleapis.com/v1/billingAccounts/${encodeURIComponent(billingAccountId)}/budgets?pageSize=10`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (budRes.ok) {
      const budJson = (await budRes.json()) as {
        budgets?: Array<{
          displayName?: string;
          amount?: {
            specifiedAmount?: {
              currencyCode?: string;
              units?: string | number;
              nanos?: number;
            };
          };
        }>;
      };
      const firstSpecified = budJson.budgets?.find(
        (b) => b.amount?.specifiedAmount
      )?.amount?.specifiedAmount;
      const parsedBudget = parseMoneyAmount(firstSpecified);
      if (parsedBudget !== null && parsedBudget > 0) {
        monthlyCreditLimitUsd = parsedBudget;
        currency = firstSpecified?.currencyCode || "USD";
        budgetsReachable = true;
      }
    } else if (!billingMissingReason) {
      const txt = await budRes.text().catch(() => "");
      const diag = classifyGoogleApiError(
        budRes.status,
        txt,
        "Cloud Billing Budgets API (billingbudgets.googleapis.com)",
        projectId,
        billingAccountId
      );
      billingMissingReason = diag.reason;
      billingMissingCode = diag.missingCode;
      billingMissingDetail = diag.missingDetail;
      setupActionUrl = diag.actionUrl;
      setupActionLabel = diag.actionLabel;
    }
  } catch {
    /* keep default Ultra $40 credit reference */
  }

  // 3. Read-only BigQuery Billing Export check (actual MTD cost & credits used)
  let bqResult: Awaited<
    ReturnType<typeof discoverAndQueryBigQueryBillingExport>
  >;
  try {
    bqResult = await discoverAndQueryBigQueryBillingExport({
      projectId,
      accessToken,
      fetchImpl: fetchFn,
    });
  } catch {
    bqResult = {
      ok: false,
      missingReason:
        "BigQuery fatura dışa aktarım sorgusu zaman aşımına uğradı.",
      missingCode: "timeout",
      missingDetail: "BigQuery Billing Export",
      actionUrl: buildBillingExportConsoleUrl(billingAccountId),
      actionLabel: "Enable Billing Export",
    };
  }

  let status: VertexCloudBillingStatus;
  if (bqResult.ok) {
    const creditsUsed =
      bqResult.creditsUsedUsd > 0
        ? bqResult.creditsUsedUsd
        : bqResult.grossCostUsd;
    const remaining = Math.max(
      0,
      Math.round((monthlyCreditLimitUsd - creditsUsed) * 100) / 100
    );
    status = {
      reachable: true,
      source: "gcp_bigquery_and_budgets",
      projectId,
      billingAccountId,
      currency: bqResult.currency || currency,
      monthlyCreditLimitUsd,
      mtdGrossCostUsd: Math.round(bqResult.grossCostUsd * 10_000) / 10_000,
      mtdCreditsUsedUsd: Math.round(creditsUsed * 10_000) / 10_000,
      creditsRemainingUsd: remaining,
      missingReason: null,
      missingCode: null,
      missingDetail: null,
      setupActionUrl: buildBillingExportConsoleUrl(billingAccountId),
      setupActionLabel: "Open Cloud Billing",
      checkedAt,
    };
  } else {
    status = {
      reachable: false,
      source: budgetsReachable ? "gcp_budgets_only" : "app_token_logs",
      projectId,
      billingAccountId,
      currency,
      monthlyCreditLimitUsd,
      mtdGrossCostUsd: null,
      mtdCreditsUsedUsd: null,
      creditsRemainingUsd: null,
      missingReason: billingMissingReason ?? bqResult.missingReason,
      missingCode: billingMissingReason
        ? billingMissingCode
        : bqResult.missingCode,
      missingDetail: billingMissingReason
        ? billingMissingDetail
        : bqResult.missingDetail,
      setupActionUrl: billingMissingReason
        ? setupActionUrl
        : bqResult.actionUrl,
      setupActionLabel: billingMissingReason
        ? setupActionLabel
        : bqResult.actionLabel,
      checkedAt,
    };
  }

  if (!opts?.fetchImpl) {
    cachedBilling = {
      key: cacheKey,
      expiresAtMs: Date.now() + VERTEX_BILLING_CACHE_TTL_MS,
      value: status,
    };
  }
  return status;
}
