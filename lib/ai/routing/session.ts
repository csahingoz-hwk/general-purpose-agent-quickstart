import { AsyncLocalStorage } from "node:async_hooks";
import type { PremiumModelId } from "./catalog";
import type { UsageLedger } from "./ledger";

export type InferenceSession = {
  ledger: UsageLedger;
  available: PremiumModelId[];
  exposed: boolean;
  toolBoundary: boolean;
  fallbackUsed: boolean;
};
export const inferenceSession = new AsyncLocalStorage<InferenceSession>();
