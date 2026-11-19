import type { ComponentProps } from "react";

import { type SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUiLocale } from "@/hooks/use-ui-locale";
import { Button } from "../ui/button";
import { SidebarLeftIcon } from "./icons";

export function SidebarToggle({
  className,
}: ComponentProps<typeof SidebarTrigger>) {
  const { toggleSidebar } = useSidebar();
  const { copy } = useUiLocale();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={copy.toggleSidebarSr}
          className={className}
          data-testid="sidebar-toggle-button"
          onClick={toggleSidebar}
          size="icon-sm"
          variant="outline"
        >
          <SidebarLeftIcon size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent align="start" className="hidden md:block">
        {copy.toggleSidebarSr}
      </TooltipContent>
    </Tooltip>
  );
}
