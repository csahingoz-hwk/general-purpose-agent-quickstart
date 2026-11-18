"use client";

import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "swr";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppProviders({
  basePath,
  children,
}: {
  basePath: string;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider
      basePath={basePath}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      <SWRConfig
        value={{
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
          dedupingInterval: 5 * 60_000,
        }}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </SWRConfig>
    </SessionProvider>
  );
}
