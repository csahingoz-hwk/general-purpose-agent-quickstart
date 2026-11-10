"use client";

import { GlobeIcon, LockIcon, PanelLeftIcon } from "lucide-react";
import { memo } from "react";
import useSWRInfinite from "swr/infinite";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { getCopy } from "@/lib/ui-copy";
import { fetcher } from "@/lib/utils";
import { HomeLocationControl } from "./home-location";
import {
  type ChatHistory,
  getChatHistoryPaginationKey,
} from "./sidebar-history";
import type { VisibilityType } from "./visibility-selector";

const copy = getCopy();

function PureChatHeader({
  chatId,
  selectedVisibilityType,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
}) {
  const { openMobile, setOpenMobile } = useSidebar();

  // Read-only reuse of the same SWR cache key the History list already loads;
  // no new endpoint and no writes. The title is simply omitted when the chat is
  // not (yet) in the loaded history page, e.g. a brand-new chat.
  const { data: pages } = useSWRInfinite<ChatHistory>(
    getChatHistoryPaginationKey,
    fetcher,
    { fallbackData: [], revalidateOnFocus: false }
  );
  const title = pages
    ?.flatMap((page) => page.chats)
    .find((chat) => chat.id === chatId)?.title;

  const isPublic = selectedVisibilityType === "public";

  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
      <Button
        aria-expanded={openMobile}
        aria-label="Open History"
        className="size-11 shrink-0 md:hidden"
        // This button is mobile-only. Do not depend on the media-query hook
        // having finished hydration before handling its first interaction.
        onClick={() => setOpenMobile(!openMobile)}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      <div className="flex min-w-0 flex-col justify-center leading-tight">
        <span className="font-semibold text-foreground text-sm">
          {copy.assistant}
        </span>
        {title && (
          <span
            className="truncate text-muted-foreground text-xs"
            data-testid="chat-header-title"
            title={title}
          >
            {title}
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <span
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-foreground text-xs"
          data-testid="chat-status"
        >
          {isPublic ? (
            <GlobeIcon aria-hidden="true" className="size-3" />
          ) : (
            <LockIcon aria-hidden="true" className="size-3" />
          )}
          {isPublic ? copy.sharedLink : copy.private}
        </span>
        <HomeLocationControl />
      </div>
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly
  );
});
