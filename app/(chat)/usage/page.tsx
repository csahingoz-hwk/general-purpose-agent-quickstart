"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";

export default function UsagePage() {
  const { data, error } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/usage`,
    fetcher
  );
  const usd = (value: number) => `$${value.toFixed(4)}`;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 overflow-auto p-6">
      <Link href="/">Back to chat</Link>
      <h1 className="text-2xl font-semibold">Conversation usage</h1>
      <p className="text-sm text-muted-foreground">
        Estimated API costs for this UTC month. This app's allowance is an extra
        safeguard; your provider's billing records and spending controls are
        authoritative.
      </p>
      {error ? (
        <p>Usage tracking needs setup. Chat stays paused until it is ready.</p>
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
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
                    <tr className="border-t" key={`${call.requestId}-${index}`}>
                      <td className="py-2">
                        {call.model}
                        <br />
                        <time>{new Date(call.createdAt).toLocaleString()}</time>
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
    </main>
  );
}
