"use client";

import { useEffect, useState } from "react";
import type { OpenUiPayload } from "@/lib/openui/snapshot";
import { validateOpenUiSpec } from "@/lib/openui/validate";
import { OpenUiRenderer } from "./openui-library";

export function OpenUiCard({ payload }: { payload: OpenUiPayload }) {
  const [details, setDetails] = useState(false);
  const verdict = validateOpenUiSpec(payload.spec, payload.data);
  useEffect(() => {
    if (!details) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetails(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [details]);

  if (!verdict.ok) {
    return (
      <section
        className="w-full max-w-[40rem] rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 text-foreground shadow-[var(--shadow-card)]"
        data-testid="openui-fallback"
      >
        <h2 className="font-semibold text-[17px]">Details</h2>
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-snug">
          {payload.fallbackText || verdict.reason}
        </p>
      </section>
    );
  }

  return (
    <section
      className="w-full max-w-[40rem] rounded-[22px] border border-[color:var(--hairline)] bg-card p-4 text-foreground shadow-[var(--shadow-card)]"
      data-testid="openui-card"
    >
      {!details && <OpenUiRenderer data={payload.data} spec={payload.spec} />}
      <button
        className="mt-3 min-h-11 rounded-full border border-[color:var(--hairline)] px-4 text-sm"
        data-testid="openui-open-details"
        onClick={() => setDetails(true)}
        type="button"
      >
        Open details
      </button>
      {details && (
        <div
          aria-label={payload.data.stats.current?.hint ?? "Details"}
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-background px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
          data-testid="openui-details"
          role="dialog"
        >
          <button
            className="mb-4 min-h-11 rounded-full border border-[color:var(--hairline)] px-4 text-sm"
            onClick={() => setDetails(false)}
            type="button"
          >
            Close
          </button>
          <div className="mx-auto max-w-[40rem] rounded-[22px] border border-[color:var(--hairline)] bg-card p-4">
            <OpenUiRenderer data={payload.data} spec={payload.spec} />
          </div>
        </div>
      )}
    </section>
  );
}
