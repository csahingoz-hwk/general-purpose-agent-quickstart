import { auth } from "@/app/(auth)/auth";
import { summarizeCallsByModel, usageSummary } from "@/lib/ai/routing/ledger";
import {
  DEFAULT_BILLING_ACCOUNT_ID,
  DEFAULT_ULTRA_MONTHLY_CREDIT_USD,
  getVertexCloudBillingStatus,
} from "@/lib/billing/vertex-cloud-usage";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [summary, gcpBilling] = await Promise.all([
    usageSummary(session.user.id).catch(() => ({
      timezone: "UTC",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      invocations: 0,
      requests: 0,
      fallbackInvocations: 0,
      byModel: summarizeCallsByModel([]),
      calls: [],
    })),
    Promise.race([
      getVertexCloudBillingStatus(),
      new Promise<Awaited<ReturnType<typeof getVertexCloudBillingStatus>>>(
        (resolve) =>
          setTimeout(
            () =>
              resolve({
                reachable: false,
                source: "app_token_logs",
                projectId: process.env.GOOGLE_VERTEX_PROJECT_ID?.trim() || null,
                billingAccountId: DEFAULT_BILLING_ACCOUNT_ID,
                currency: "USD",
                monthlyCreditLimitUsd: DEFAULT_ULTRA_MONTHLY_CREDIT_USD,
                mtdGrossCostUsd: null,
                mtdCreditsUsedUsd: null,
                creditsRemainingUsd: null,
                missingReason:
                  "Google Cloud Billing sorgusu zaman aşımına uğradı; uygulama içi token kayıtları gösteriliyor.",
                missingCode: "timeout",
                missingDetail: null,
                setupActionUrl:
                  "https://console.cloud.google.com/flows/enableapi?apiid=cloudbilling.googleapis.com,billingbudgets.googleapis.com,bigquery.googleapis.com",
                setupActionLabel: "Enable Billing APIs",
                checkedAt: new Date().toISOString(),
              }),
            4500
          )
      ),
    ]),
  ]);

  return Response.json(
    {
      ...summary,
      gcpBilling,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
