"use client";

import {
  BookOpenIcon,
  BotIcon,
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
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { guestRegex } from "@/lib/constants";
import { getCopy } from "@/lib/ui-copy";
import { LoaderIcon } from "./icons";
import { toast } from "./toast";

function emailToHue(email: string): number {
  let hash = 0;
  for (const char of email) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

const copy = getCopy();

export function SidebarUserNav({
  user,
  onRequestDeleteAll,
}: {
  user: User;
  onRequestDeleteAll?: () => void;
}) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { data, status } = useSession();
  const { setTheme, resolvedTheme } = useTheme();

  const isGuest = guestRegex.test(data?.user?.email ?? "");

  const navigateFromMenu = (href: string) => {
    setOpenMobile(false);
    router.push(href);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {status === "loading" ? (
              <SidebarMenuButton className="h-auto min-h-[60px] justify-between rounded-[20px] bg-card px-4 text-foreground data-[state=open]:bg-card">
                <div className="flex flex-row items-center gap-2">
                  <div className="size-6 animate-pulse rounded-full bg-sidebar-foreground/10" />
                  <span className="animate-pulse rounded-md bg-sidebar-foreground/10 text-[13px] text-transparent">
                    Loading...
                  </span>
                </div>
                <div className="animate-spin text-sidebar-foreground">
                  <LoaderIcon />
                </div>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                className="h-auto min-h-[60px] rounded-[20px] bg-card px-4 text-[17px] text-foreground hover:bg-card data-[state=open]:bg-card group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:min-h-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0!"
                data-testid="user-nav-button"
              >
                <div
                  className="size-5 shrink-0 rounded-full ring-1 ring-sidebar-border/50"
                  style={{
                    background: `linear-gradient(135deg, oklch(0.35 0.08 ${emailToHue(user.email ?? "")}), oklch(0.25 0.05 ${emailToHue(user.email ?? "") + 40}))`,
                  }}
                />
                <span
                  className="truncate text-[17px] group-data-[collapsible=icon]:hidden"
                  data-testid="user-email"
                >
                  {isGuest ? "Guest" : user?.email}
                </span>
                <ChevronUp className="ml-auto size-3.5 text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-popper-anchor-width) rounded-[20px] border border-[color:var(--hairline)] bg-card p-1.5 shadow-[var(--shadow-float)]"
            data-testid="user-nav-menu"
            side="top"
          >
            <DropdownMenuItem
              className="min-h-11 cursor-pointer gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
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
            <DropdownMenuItem asChild data-testid="user-nav-item-auth">
              <button
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[15px] md:min-h-9 md:text-[13px]"
                onClick={() => {
                  if (status === "loading") {
                    toast({
                      type: "error",
                      description:
                        "Checking authentication status, please try again!",
                    });

                    return;
                  }

                  setOpenMobile(false);
                  if (isGuest) {
                    router.push("/login");
                  } else {
                    signOut({
                      redirectTo: "/",
                    });
                  }
                }}
                type="button"
              >
                <LogOutIcon className="size-4 text-muted-foreground" />
                {isGuest ? "Login to your account" : "Sign out"}
              </button>
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
