"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useEffect, useState } from "react";
import {
  MASCOT_DONE_HOLD_MS,
  type MascotState,
  resolveMascotState,
} from "@/lib/mascot";
import type { ChatMessage } from "@/lib/types";

type ChatStatus = UseChatHelpers<ChatMessage>["status"];

function liveMascotState(status: ChatStatus, phase: MascotState): MascotState {
  if (status === "submitted") {
    return "thinking";
  }
  if (status === "streaming") {
    return "working";
  }
  if (status === "error") {
    return "idle";
  }
  return phase;
}

/**
 * Idle while waiting for input, thinking before the first token, working
 * through a stream or tool, then done for a short beat. Errors drop to idle.
 */
export function useAgentActivity(status: ChatStatus): MascotState {
  const [trackedStatus, setTrackedStatus] = useState(status);
  const [phase, setPhase] = useState<MascotState>("idle");
  let resolvedPhase = phase;

  if (trackedStatus !== status) {
    const next = resolveMascotState(trackedStatus, status);
    setTrackedStatus(status);
    if (next === "done" || next === "idle") {
      setPhase(next);
      resolvedPhase = next;
    }
  }

  useEffect(() => {
    if (status !== "ready" || phase !== "done") {
      return;
    }
    const timer = window.setTimeout(() => {
      setPhase("idle");
    }, MASCOT_DONE_HOLD_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase, status]);

  return liveMascotState(status, resolvedPhase);
}
