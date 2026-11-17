"use client";

import {
  BombIcon,
  BookOpenIcon,
  ClockIcon,
  ListIcon,
  PaletteIcon,
  PenLineIcon,
  PenSquareIcon,
  Settings2Icon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type SlashCommand = {
  name: string;
  description: string;
  icon: ReactNode;
  action: string;
  shortcut?: string;
};

export const slashCommands: SlashCommand[] = [
  {
    name: "new",
    description: "Start a new chat",
    icon: <PenSquareIcon className="size-3.5" />,
    action: "new",
  },
  {
    name: "clear",
    description: "Clear current chat",
    icon: <Trash2Icon className="size-3.5" />,
    action: "clear",
  },
  {
    name: "rename",
    description: "Rename current chat",
    icon: <PenLineIcon className="size-3.5" />,
    action: "rename",
  },
  {
    name: "model",
    description: "Change the AI model",
    icon: <ListIcon className="size-3.5" />,
    action: "model",
  },
  {
    name: "theme",
    description: "Toggle dark/light mode",
    icon: <PaletteIcon className="size-3.5" />,
    action: "theme",
  },
  {
    name: "settings",
    description: "Open settings, appearance & usage",
    icon: <Settings2Icon className="size-3.5" />,
    action: "settings",
  },
  {
    name: "routines",
    description: "Open routines & background tasks",
    icon: <ClockIcon className="size-3.5" />,
    action: "routines",
  },
  {
    name: "memory",
    description: "Open profile & journal memory",
    icon: <BookOpenIcon className="size-3.5" />,
    action: "memory",
  },
  {
    name: "skills",
    description: "Open reusable skills library",
    icon: <SparklesIcon className="size-3.5" />,
    action: "skills",
  },
  {
    name: "teammates",
    description: "Switch specialist bot teammates",
    icon: <SparklesIcon className="size-3.5" />,
    action: "teammates",
  },
  {
    name: "delete",
    description: "Delete current chat",
    icon: <XIcon className="size-3.5" />,
    action: "delete",
  },
  {
    name: "purge",
    description: "Delete all chats",
    icon: <BombIcon className="size-3.5" />,
    action: "purge",
  },
];

type SlashCommandMenuProps = {
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  selectedIndex: number;
};

export function SlashCommandMenu({
  query,
  onSelect,
  onClose: _onClose,
  selectedIndex,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const filtered = slashCommands.filter((cmd) =>
    cmd.name.startsWith(query.toLowerCase())
  );

  useEffect(() => {
    const selected = menuRef.current?.querySelector("[data-selected='true']");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, []);

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute right-0 bottom-full left-0 z-50 mb-2 overflow-hidden rounded-[20px] border border-[color:var(--hairline)] bg-card shadow-[var(--shadow-float)]"
      ref={menuRef}
    >
      <div className="max-h-64 overflow-y-auto py-1.5 no-scrollbar">
        {filtered.map((cmd, index) => (
          <button
            className={cn(
              "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors",
              index === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
            )}
            data-selected={index === selectedIndex}
            key={cmd.name}
            onClick={() => onSelect(cmd)}
            onMouseDown={(e) => e.preventDefault()}
            type="button"
          >
            <div className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
              {cmd.icon}
            </div>
            <span className="font-mono font-medium text-[13px] text-foreground">
              /{cmd.name}
            </span>
            <span className="truncate text-[13px] text-muted-foreground">
              {cmd.description}
            </span>
            {cmd.shortcut && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {cmd.shortcut}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
