"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { AgentMascot } from "@/components/chat/agent-mascot";
import {
  AGENT_MASCOTS,
  DEFAULT_AGENT_MASCOT,
  isMascotVariant,
  MASCOT_STORAGE_KEY,
  type MascotVariant,
} from "@/lib/mascot";
import { getCopy } from "@/lib/ui-copy";
import { cn } from "@/lib/utils";

const copy = getCopy();

type MascotPreference = {
  variant: MascotVariant;
  setVariant: (variant: MascotVariant) => void;
};

const MascotPreferenceContext = createContext<MascotPreference | null>(null);

export function MascotPreferenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [variant, setVariantState] =
    useState<MascotVariant>(DEFAULT_AGENT_MASCOT);

  useEffect(() => {
    const saved = window.localStorage.getItem(MASCOT_STORAGE_KEY);
    if (isMascotVariant(saved)) {
      setVariantState(saved);
    }
  }, []);

  const setVariant = (next: MascotVariant) => {
    setVariantState(next);
    window.localStorage.setItem(MASCOT_STORAGE_KEY, next);
  };

  return (
    <MascotPreferenceContext.Provider value={{ variant, setVariant }}>
      {children}
    </MascotPreferenceContext.Provider>
  );
}

export function useMascotPreference(): MascotPreference {
  const value = useContext(MascotPreferenceContext);
  if (value) {
    return value;
  }
  return {
    variant: DEFAULT_AGENT_MASCOT,
    setVariant: () => {
      return;
    },
  };
}

export function MascotPicker() {
  const { variant, setVariant } = useMascotPreference();

  return (
    <fieldset className="space-y-2 border-0 p-0">
      <legend className="text-[13px] text-muted-foreground">
        {copy.mascot}
      </legend>
      <div className="grid grid-cols-5 gap-2">
        {AGENT_MASCOTS.map((mascot) => {
          const selected = mascot.id === variant;
          return (
            <button
              aria-label={mascot.label}
              aria-pressed={selected}
              className={cn(
                "flex size-11 items-center justify-center rounded-full border bg-background",
                selected ? "border-primary" : "border-[color:var(--hairline)]"
              )}
              key={mascot.id}
              onClick={() => {
                setVariant(mascot.id);
              }}
              type="button"
            >
              <AgentMascot
                animated={false}
                decorative
                size={32}
                state="idle"
                variant={mascot.id}
              />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
