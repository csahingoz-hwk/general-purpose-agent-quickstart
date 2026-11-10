"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ChatShell } from "./shell";

/**
 * Single content slot inside the one ActiveChatProvider. Chat routes render the
 * persistent ChatShell (the chat pages themselves render null); any other route
 * (e.g. /usage) renders only its own children. usePathname excludes basePath.
 */
export function isChatPath(pathname: string | null): boolean {
  return pathname === "/" || pathname?.startsWith("/chat/") === true;
}

export function RouteSlot({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isChatPath(pathname)) {
    return (
      <>
        <ChatShell />
        {children}
      </>
    );
  }

  return <>{children}</>;
}
