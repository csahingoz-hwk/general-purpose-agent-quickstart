import { AsyncLocalStorage } from "node:async_hooks";
import type { JournalEntry, ProfileFact } from "@/lib/memory/store";
import type { PremiumModelId } from "./catalog";
import type { UsageLedger } from "./ledger";
import type { Failure } from "./policy";

export type MemoryTurnDedupeState = {
  savedFact: ProfileFact | null;
  savedJournal: JournalEntry | null;
  inFlightSavePromise: Promise<ProfileFact> | null;
};

export type InferenceSession = {
  ledger: UsageLedger;
  available: PremiumModelId[];
  exposed: boolean;
  toolBoundary: boolean;
  fallbackUsed: boolean;
  activeModelId?: PremiumModelId;
  memoryTurnState?: MemoryTurnDedupeState;
  onFallback?: (info: {
    fromModel: PremiumModelId;
    toModel: PremiumModelId;
    reason: Failure;
  }) => void;
};
export const inferenceSession = new AsyncLocalStorage<InferenceSession>();
