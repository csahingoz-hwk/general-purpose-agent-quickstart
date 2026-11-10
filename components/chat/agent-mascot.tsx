"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import {
  DEFAULT_AGENT_MASCOT,
  type MascotState,
  type MascotVariant,
  mascotById,
  mascotFrameSrc,
} from "@/lib/mascot";
import { getCopy } from "@/lib/ui-copy";
import { cn } from "@/lib/utils";

const copy = getCopy();

const STATE_LABEL: Record<MascotState, string> = {
  idle: copy.mascotStateIdle,
  thinking: copy.mascotStateThinking,
  working: copy.mascotStateWorking,
  done: copy.mascotStateDone,
};

type AgentMascotProps = {
  variant?: MascotVariant;
  state?: MascotState;
  /** Outer box in pixels. Motion scales with it. */
  size?: number;
  /** Older replies pass false so only the latest mascot moves. */
  animated?: boolean;
  /** Hide the accessible name when a parent control already names it. */
  decorative?: boolean;
  priority?: boolean;
  className?: string;
};

export function AgentMascot({
  variant = DEFAULT_AGENT_MASCOT,
  state = "idle",
  size = 160,
  animated = true,
  decorative = false,
  priority = false,
  className,
}: AgentMascotProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mascot = mascotById(variant);
  const label = `${mascot.label} assistant, ${STATE_LABEL[state]}`;

  useEffect(() => {
    const node = rootRef.current;
    if (!animated || !node) {
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) {
      return;
    }

    let cancelled = false;
    const timers = new Set<number>();
    const later = (run: () => void, delay: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (!cancelled) {
          run();
        }
      }, delay);
      timers.add(id);
    };
    const blink = () => {
      node.classList.add("is-blinking");
      later(() => {
        node.classList.remove("is-blinking");
      }, 125);
    };
    const schedule = () => {
      later(
        () => {
          blink();
          if (Math.random() < 0.2) {
            later(blink, 260);
          }
          schedule();
        },
        2300 + Math.random() * 4000
      );
    };
    schedule();

    const onMotionChange = () => {
      if (!media.matches) {
        return;
      }
      cancelled = true;
      node.classList.remove("is-blinking");
    };
    media.addEventListener("change", onMotionChange);

    return () => {
      cancelled = true;
      for (const id of timers) {
        window.clearTimeout(id);
      }
      media.removeEventListener("change", onMotionChange);
      node.classList.remove("is-blinking");
    };
  }, [animated]);

  return (
    <div
      aria-hidden={decorative ? true : undefined}
      className={cn("agent-mascot", !animated && "is-static", className)}
      data-state={state}
      data-testid="agent-mascot"
      data-variant={variant}
      ref={rootRef}
      style={
        {
          "--mascot-accent": mascot.accent,
          "--mascot-size": `${size}px`,
        } as React.CSSProperties
      }
    >
      <div aria-hidden="true" className="agent-mascot__glow" />
      <div aria-hidden="true" className="agent-mascot__orbit">
        <span />
      </div>
      <div
        aria-hidden="true"
        className="agent-mascot__orbit agent-mascot__orbit-b"
      >
        <span />
      </div>
      <div className="agent-mascot__wrap">
        <Image
          alt={decorative ? "" : label}
          className="agent-mascot__img"
          draggable={false}
          fill
          priority={priority}
          sizes={`${size}px`}
          src={mascotFrameSrc(variant, "open")}
          unoptimized
        />
        <Image
          alt=""
          className="agent-mascot__img agent-mascot__blink"
          draggable={false}
          fill
          sizes={`${size}px`}
          src={mascotFrameSrc(variant, "blink")}
          unoptimized
        />
      </div>
      <div aria-hidden="true" className="agent-mascot__thought">
        <span />
        <span />
        <span />
      </div>
      <div aria-hidden="true" className="agent-mascot__success">
        <svg fill="none" viewBox="0 0 24 24">
          <title>Finished</title>
          <path
            d="M5 12l5 5L20 7"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
          />
        </svg>
      </div>
    </div>
  );
}
