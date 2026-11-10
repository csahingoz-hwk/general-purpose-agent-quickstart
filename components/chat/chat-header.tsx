"use client";

import {
  GlobeIcon,
  LockIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
} from "lucide-react";
import { memo, useEffect, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";
import type { MascotState } from "@/lib/mascot";
import { getCopy } from "@/lib/ui-copy";
import { fetcher } from "@/lib/utils";
import { AgentMascot } from "./agent-mascot";
import { HomeLocationPanel } from "./home-location";
import { MascotPicker, useMascotPreference } from "./mascot-preference";
import {
  type ChatHistory,
  getChatHistoryPaginationKey,
} from "./sidebar-history";
import type { VisibilityType } from "./visibility-selector";

const copy = getCopy();

const floatButtonClass =
  "size-[52px]! rounded-full border border-[color:var(--hairline)] bg-card text-foreground shadow-[var(--shadow-float)] hover:bg-card md:size-11!";

const PREVIEW_TOOLBAR_SELECTORS = [
  "vercel-live-feedback",
  "vercel-toolbar",
  "#__vercel_toolbar",
  "#vercel-toolbar",
  "#vercel-live-feedback",
];

function parkPreviewToolbar(slot: HTMLElement) {
  for (const selector of PREVIEW_TOOLBAR_SELECTORS) {
    const node = document.querySelector(selector);
    if (!(node instanceof HTMLElement) || node.parentElement === slot) {
      continue;
    }
    slot.append(node);
  }
}

function PureChatHeader({
  activity,
  chatId,
  selectedVisibilityType,
}: {
  activity: MascotState;
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
}) {
  const { variant } = useMascotPreference();
  const { openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const toolbarSlotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = toolbarSlotRef.current;
    if (!slot) {
      return;
    }
    const park = () => parkPreviewToolbar(slot);
    park();
    const observer = new MutationObserver(park);
    observer.observe(document.body, { childList: true });
    observer.observe(document.documentElement, { childList: true });
    return () => observer.disconnect();
  }, []);

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
    <header
      className="relative z-20 grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(0.75rem,env(safe-area-inset-left))] md:grid-cols-[44px_minmax(0,1fr)_auto] md:pr-[max(1rem,env(safe-area-inset-right))] md:pl-[max(1rem,env(safe-area-inset-left))]"
      data-chat-header
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full bg-gradient-to-b from-background from-60% to-transparent"
      />
      <div className="relative size-[52px] md:size-11">
        <Button
          aria-expanded={openMobile}
          aria-label="Open History"
          className={`${floatButtonClass} absolute inset-0 md:hidden`}
          onClick={() => setOpenMobile(!openMobile)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <PanelLeftIcon className="size-5" />
        </Button>
        <Button
          aria-label="Toggle sidebar"
          className={`${floatButtonClass} absolute inset-0 hidden md:inline-flex`}
          onClick={() => toggleSidebar()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <PanelLeftIcon className="size-5" />
        </Button>
      </div>

      <div className="flex min-w-0 justify-center px-1">
        <div className="flex h-[52px] max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-card py-1 pr-2 pl-1 shadow-[var(--shadow-float)] sm:gap-2 sm:pr-3 sm:pl-1.5 md:h-11">
          <AgentMascot
            animated
            className="rounded-full shadow-[0_0_0_1px_color-mix(in_srgb,var(--bot-avatar-ring)_28%,transparent)]"
            size={36}
            state={activity}
            variant={variant}
          />
          <span className="min-w-0 truncate font-semibold text-[17px] leading-none text-foreground">
            {title ? (
              <span data-testid="chat-header-title" title={title}>
                {title}
              </span>
            ) : (
              copy.assistant
            )}
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground"
            data-testid="chat-status"
          >
            {isPublic ? (
              <GlobeIcon aria-hidden="true" className="size-3.5" />
            ) : (
              <LockIcon aria-hidden="true" className="size-3.5" />
            )}
            <span className="max-sm:sr-only">
              {isPublic ? copy.sharedLink : copy.private}
            </span>
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <div
          className="flex items-center"
          data-slot="preview-toolbar"
          ref={toolbarSlotRef}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              aria-label="Chat options"
              className={floatButtonClass}
              data-testid="home-location-trigger"
              size="icon"
              type="button"
              variant="ghost"
            >
              <MoreHorizontalIcon className="size-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 rounded-[20px] p-4">
            <MascotPicker />
            <div className="my-4 h-px bg-border" />
            <HomeLocationPanel />
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.activity === nextProps.activity &&
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly
  );
});
