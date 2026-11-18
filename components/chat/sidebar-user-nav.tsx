"use client";

import {
  BookOpenIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronUp,
  ClockIcon,
  LogOutIcon,
  Settings2Icon,
  SparklesIcon,
  SunMoonIcon,
  TrashIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useUiLocale } from "@/hooks/use-ui-locale";
import { guestRegex } from "@/lib/constants";

function emailToHue(email: string): number {
  let hash = 0;
  for (const char of email) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function SidebarUserNav({
  user,
  onRequestDeleteAll,
}: {
  user: User;
  onRequestDeleteAll?: () => void;
}) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { data } = useSession();
  const { setTheme, resolvedTheme } = useTheme();
  const { copy } = useUiLocale("en");

  const email = user?.email ?? data?.user?.email ?? "";
  const isGuest = guestRegex.test(email);
  const avatarHue = emailToHue(email);

  const navigateFromMenu = (href: string) => {
    setOpenMobile(false);
    router.push(href);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={
                isGuest
                  ? "Account menu (Guest)"
                  : email
                    ? `Account menu (${email})`
                    : "Account menu"
              }
              className="relative z-30 flex min-h-[56px] w-full cursor-pointer items-center gap-2.5 rounded-[20px] bg-card px-4 text-left text-[17px] text-foreground outline-hidden transition-colors hover:bg-card/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-card group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:min-h-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0! group-data-[collapsible=icon]:hover:bg-sidebar-accent"
              data-testid="user-nav-button"
              type="button"
            >
              <div
                className="size-6 shrink-0 rounded-full ring-1 ring-sidebar-border/60"
                style={{
                  background: `linear-gradient(135deg, oklch(0.38 0.09 ${avatarHue}), oklch(0.26 0.06 ${avatarHue + 40}))`,
                }}
              />
              <span
                className="truncate text-[15px] group-data-[collapsible=icon]:hidden"
                data-testid="user-email"
              >
                {isGuest ? "Guest" : email}
              </span>
              <ChevronUp className="ml-auto size-3.5 shrink-0 text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="z-50 w-64 min-w-60 max-w-[calc(100vw-1.5rem)] rounded-[20px] border border-[color:var(--hairline)] bg-card p-1.5 shadow-[var(--shadow-float)]"
            data-testid="user-nav-menu"
            side="top"
            sideOffset={8}
          >
            <div className="flex items-center gap-2.5 px-3 py-2">
              <div
                className="size-6 shrink-0 rounded-full ring-1 ring-sidebar-border/60"
                style={{
                  background: `linear-gradient(135deg, oklch(0.38 0.09 ${avatarHue}), oklch(0.26 0.06 ${avatarHue + 40}))`,
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">Account</p>
                <p
                  className="truncate font-medium text-[13px] text-foreground"
                  data-testid="user-menu-email"
                >
                  {isGuest ? "Guest" : email || "Signed in"}
                </p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
              data-testid="user-nav-item-setup"
              onSelect={() => navigateFromMenu("/setup")}
            >
              <CheckCircle2Icon className="size-4 text-muted-foreground" />
              {copy.setupChecklist}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
              data-testid="user-nav-item-usage"
              onSelect={() => navigateFromMenu("/usage")}
            >
              <Settings2Icon className="size-4 text-muted-foreground" />
              {copy.usageAndSettings}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
              onSelect={() => navigateFromMenu("/teammates")}
            >
              <BotIcon className="size-4 text-muted-foreground" />
              {copy.teammatesRoster}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
              onSelect={() => navigateFromMenu("/memory")}
            >
              <BookOpenIcon className="size-4 text-muted-foreground" />
              {copy.memory}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
              onSelect={() => navigateFromMenu("/routines")}
            >
              <ClockIcon className="size-4 text-muted-foreground" />
              {copy.routinesAndTasks}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
              onSelect={() => navigateFromMenu("/skills")}
            >
              <SparklesIcon className="size-4 text-muted-foreground" />
              {copy.skillsLibrary}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
              data-testid="user-nav-item-theme"
              onSelect={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              <SunMoonIcon className="size-4 text-muted-foreground" />
              {`Toggle ${resolvedTheme === "light" ? "dark" : "light"} mode`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
              data-testid="user-nav-item-auth"
              onSelect={() => {
                setOpenMobile(false);
                if (isGuest) {
                  router.push("/login");
                } else {
                  signOut({
                    redirectTo: "/login",
                  });
                }
              }}
            >
              <LogOutIcon className="size-4 text-muted-foreground" />
              {isGuest ? "Login to your account" : copy.signOut}
            </DropdownMenuItem>
            {onRequestDeleteAll && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] text-destructive focus:bg-destructive/10 focus:text-destructive md:min-h-9 md:text-[13px]"
                  data-testid="user-nav-item-delete-all"
                  onSelect={() => {
                    setOpenMobile(false);
                    onRequestDeleteAll();
                  }}
                >
                  <TrashIcon className="size-4" />
                  {copy.deleteAllChats}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
