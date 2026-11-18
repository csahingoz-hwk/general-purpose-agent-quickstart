import { AsyncLocalStorage } from "node:async_hooks";
import type { PremiumModelId } from "./catalog";
import type { UsageLedger } from "./ledger";
import type { Failure } from "./policy";

export type InferenceSession = {
  ledger: UsageLedger;
  available: PremiumModelId[];
  exposed: boolean;
  toolBoundary: boolean;
  fallbackUsed: boolean;
  activeModelId?: PremiumModelId;
  onFallback?: (info: {
    fromModel: PremiumModelId;
    toModel: PremiumModelId;
    reason: Failure;
  }) => void;
};
export const inferenceSession = new AsyncLocalStorage<InferenceSession>();
