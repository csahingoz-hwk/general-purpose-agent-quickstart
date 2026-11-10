"use client";

import { PanelLeftIcon, PenSquareIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import {
  getChatHistoryPaginationKey,
  SidebarHistory,
} from "@/components/chat/sidebar-history";
import { SidebarUserNav } from "@/components/chat/sidebar-user-nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getCopy } from "@/lib/ui-copy";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

const copy = getCopy();

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const { mutate } = useSWRConfig();
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);

  const handleDeleteAll = () => {
    setShowDeleteAllDialog(false);
    router.replace("/");
    mutate(unstable_serialize(getChatHistoryPaginationKey), [], {
      revalidate: false,
    });

    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history`, {
      method: "DELETE",
    });

    toast.success("All chats deleted");
  };

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-4 pt-4 pb-1 group-data-[collapsible=icon]:px-2">
          <div className="flex items-center justify-between gap-3 group-data-[collapsible=icon]:justify-center">
            <Link
              className="min-w-0 truncate font-semibold text-[17px] text-foreground group-data-[collapsible=icon]:hidden"
              href="/"
              onClick={() => setOpenMobile(false)}
            >
              {copy.assistant}
            </Link>
            <SidebarMenuButton
              className="hidden size-8 group-data-[collapsible=icon]:inline-flex"
              onClick={() => toggleSidebar()}
              tooltip="Open sidebar"
            >
              <PanelLeftIcon className="size-4" />
            </SidebarMenuButton>
            <SidebarTrigger className="size-11 rounded-full text-foreground group-data-[collapsible=icon]:hidden md:size-8" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="px-4 pt-2 group-data-[collapsible=icon]:px-2">
            <SidebarGroupContent>
              <div className="overflow-hidden rounded-[20px] bg-card group-data-[collapsible=icon]:overflow-visible group-data-[collapsible=icon]:rounded-none group-data-[collapsible=icon]:bg-transparent">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="h-auto min-h-[60px] rounded-none px-5 text-[17px] text-foreground hover:bg-foreground/5 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:min-h-8! group-data-[collapsible=icon]:rounded-lg group-data-[collapsible=icon]:px-2!"
                      onClick={() => {
                        setOpenMobile(false);
                        router.push("/");
                      }}
                      tooltip={copy.newChat}
                    >
                      <PenSquareIcon className="size-4" />
                      <span>{copy.newChat}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarHistory user={user} />
        </SidebarContent>
        <SidebarFooter className="border-0 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] group-data-[collapsible=icon]:px-2">
          {user && (
            <SidebarUserNav
              onRequestDeleteAll={() => setShowDeleteAllDialog(true)}
              user={user}
            />
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <AlertDialog
        onOpenChange={setShowDeleteAllDialog}
        open={showDeleteAllDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete all
              your chats and remove them from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
