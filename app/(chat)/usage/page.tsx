"use client";

import Link from "next/link";
import useSWR from "swr";
import { getCopy } from "@/lib/ui-copy";
import { fetcher } from "@/lib/utils";

const copy = getCopy();

export default function UsagePage() {
  const { data, error } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/usage`,
    fetcher
  );
  const usd = (value: number) => `$${value.toFixed(4)}`;
  return (
    <main className="h-dvh w-full overflow-y-auto overflow-x-hidden bg-background">
      <div className="mx-auto w-full min-w-0 max-w-3xl space-y-5 px-4 py-6 md:p-6">
        <Link
          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 font-medium text-foreground text-sm hover:bg-accent"
          href="/"
        >
          {copy.backToChat}
        </Link>
        <h1 className="text-2xl font-semibold">Conversation usage</h1>
        <p className="text-sm text-muted-foreground">
          Estimated API costs for this UTC month. This app's allowance is an
          extra safeguard; your provider's billing records and spending controls
          are authoritative.
        </p>
        {error ? (
          <p>
            Usage tracking needs setup. Chat stays paused until it is ready.
          </p>
        ) : data ? (
          <>
            <p data-testid="usage-summary">
              Today {usd(data.dailyEstimatedUsd)} · This month{" "}
              {usd(data.monthlyEstimatedUsd)} of ${data.allowanceUsd.toFixed(2)}
            </p>
            <p>
              {data.requests} requests · {data.invocations} model calls ·{" "}
              {data.fallbackInvocations} fallback calls (
              {usd(data.fallbackEstimatedUsd)})
            </p>
            {data.unreportedInvocations > 0 && (
              <p>
                Some calls did not report final usage. Their full reserved
                estimate is included until reconciled.
              </p>
            )}
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Input / cached / written</th>
                    <th>Output / reasoning</th>
                    <th>Estimated USD</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calls.map(
                    (
                      call: {
                        model: string;
                        createdAt: string;
                        requestId: string;
                        inputTokens: number | null;
                        cachedInputTokens: number | null;
                        cacheWriteTokens: number | null;
                        outputTokens: number | null;
                        reasoningTokens: number | null;
                        estimatedUsd: string | null;
                        reservedUsd: string;
                        outcome: string;
                      },
                      index: number
                    ) => (
                      <tr
                        className="border-t"
                        key={`${call.requestId}-${index}`}
                      >
                        <td className="py-2">
                          {call.model}
                          <br />
                          <time>
                            {new Date(call.createdAt).toLocaleString()}
                          </time>
                        </td>
                        <td>
                          {call.inputTokens ?? "—"} /{" "}
                          {call.cachedInputTokens ?? "—"} /{" "}
                          {call.cacheWriteTokens ?? "—"}
                        </td>
                        <td>
                          {call.outputTokens ?? "—"} /{" "}
                          {call.reasoningTokens ?? "—"}
                        </td>
                        <td>
                          {usd(Number(call.estimatedUsd ?? call.reservedUsd))}
                        </td>
                        <td>{call.outcome}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </div>
    </main>
  );
}
