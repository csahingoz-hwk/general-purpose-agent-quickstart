/**
 * Default mascot for the assistant. Change this constant to switch the
 * out-of-the-box colour; a saved choice in localStorage still wins.
 */
export const DEFAULT_AGENT_MASCOT = "blue" as const;

export const MASCOT_STORAGE_KEY = "assistant-mascot";

export const AGENT_MASCOTS = [
  { id: "blue", label: "Blue", accent: "#55baff" },
  { id: "purple", label: "Purple", accent: "#a04fff" },
  { id: "pink", label: "Pink", accent: "#ff5299" },
  { id: "orange", label: "Orange", accent: "#ff8f30" },
  { id: "green", label: "Green", accent: "#70e45a" },
  { id: "yellow", label: "Yellow", accent: "#ffcb49" },
  { id: "red", label: "Red", accent: "#ff4e52" },
  { id: "teal", label: "Teal", accent: "#28e0d1" },
  { id: "black", label: "Black", accent: "#9299a2" },
  { id: "white", label: "White", accent: "#8b93a7" },
] as const;

export type MascotVariant = (typeof AGENT_MASCOTS)[number]["id"];

export type MascotState = "idle" | "thinking" | "working" | "done";

export const MASCOT_STATES: readonly MascotState[] = [
  "idle",
  "thinking",
  "working",
  "done",
];

/** How long the celebrate pose stays up after a reply finishes. */
export const MASCOT_DONE_HOLD_MS = 1500;

export function isMascotVariant(value: unknown): value is MascotVariant {
  return AGENT_MASCOTS.some((mascot) => mascot.id === value);
}

export function mascotById(variant: MascotVariant) {
  const match = AGENT_MASCOTS.find((mascot) => mascot.id === variant);
  if (!match) {
    return AGENT_MASCOTS[0];
  }
  return match;
}

export function mascotFrameSrc(
  variant: MascotVariant,
  frame: "open" | "blink"
) {
  return `/mascots/${variant}-${frame}.webp`;
}

/**
 * Map a chat transport status change onto a mascot pose.
 * `done` is only the moment a send or stream settles successfully.
 * Errors, and a ready state that was not just working, stay idle.
 */
export function resolveMascotState(
  previousStatus: string,
  status: string
): MascotState {
  if (status === "submitted") {
    return "thinking";
  }
  if (status === "streaming") {
    return "working";
  }
  if (status === "error") {
    return "idle";
  }
  if (previousStatus === "submitted" || previousStatus === "streaming") {
    return "done";
  }
  return "idle";
}
