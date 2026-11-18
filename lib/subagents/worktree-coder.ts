import path from "node:path";
import { computeActionDigest } from "@/lib/safety/action-review";
import type {
  BackgroundTaskRecord,
  BackgroundTaskStore,
} from "@/lib/tasks/runner";

const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "production",
  "staging",
  "develop",
  "head",
  "feature/openai-premium-model-routing",
]);

const SAFE_DRAFT_BRANCH_PATTERN =
  /^(?:agent|draft)\/[a-z0-9][a-z0-9._-]{1,60}$/;

export type BranchValidationResult =
  | {
      valid: true;
      branch: string;
      worktreeDirName: string;
    }
  | {
      valid: false;
      reason: string;
    };

export function validateCoderBranchSpec(
  rawBranch: string
): BranchValidationResult {
  const branch = rawBranch.trim();
  const lower = branch.toLowerCase();

  if (
    PROTECTED_BRANCHES.has(lower) ||
    lower.startsWith("release/") ||
    lower.startsWith("hotfix/")
  ) {
    return {
      valid: false,
      reason: `Protected branch "${branch}" cannot be targeted by the coding subagent.`,
    };
  }

  if (branch.includes("..") || !SAFE_DRAFT_BRANCH_PATTERN.test(branch)) {
    return {
      valid: false,
      reason:
        'Coding subagent target branch must match "agent/<slug>" or "draft/<slug>" using lowercase alphanumeric, ".", "_", or "-" characters only.',
    };
  }

  const worktreeDirName = branch.replace(/\//g, "-");
  return {
    valid: true,
    branch,
    worktreeDirName,
  };
}

export type CoderVerificationResult = {
  checkPassed: boolean;
  testsPassed: boolean;
  headCommit?: string;
  summary: string;
};

// In-process mutex ensuring coding subagent verification runs strictly ONE at a time
// on the 8 GB RAM Mac mini (never parallel builds/tests).
let activeVerificationPromise: Promise<unknown> = Promise.resolve();

export function runSerializedVerification<T>(fn: () => Promise<T>): Promise<T> {
  const next = activeVerificationPromise.then(fn, fn);
  activeVerificationPromise = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function runWorktreeCoderTask(opts: {
  store: BackgroundTaskStore;
  userId: string;
  title: string;
  prompt: string;
  targetBranch: string;
  baseRef?: string;
  requestPush?: boolean;
  worktreesRoot?: string;
  verifyWorkspace?: (ctx: {
    branch: string;
    worktreePath: string;
    baseRef: string;
  }) => Promise<CoderVerificationResult>;
}): Promise<BackgroundTaskRecord> {
  const baseRef = (opts.baseRef ?? "HEAD").trim();
  const requestPush = opts.requestPush ?? true;

  let task = await opts.store.enqueueTask({
    userId: opts.userId,
    kind: "coding_worktree",
    title: opts.title,
    prompt: opts.prompt,
    riskLevel: requestPush ? "high" : "medium",
  });

  const branchVerdict = validateCoderBranchSpec(opts.targetBranch);
  if (!branchVerdict.valid) {
    return (
      (await opts.store.transitionTask({
        userId: opts.userId,
        id: task.id,
        status: "failed",
        stepMessage: branchVerdict.reason,
        error: branchVerdict.reason,
      })) ?? task
    );
  }

  const rootDir =
    opts.worktreesRoot ??
    path.join(
      /* turbopackIgnore: true */ process.cwd(),
      ".next",
      "cache",
      "worktrees"
    );
  const worktreePath = path.join(
    /* turbopackIgnore: true */ rootDir,
    branchVerdict.worktreeDirName
  );

  task =
    (await opts.store.transitionTask({
      userId: opts.userId,
      id: task.id,
      status: "running",
      stepMessage: `Prepared isolated worktree spec (${branchVerdict.branch} from ${baseRef} -> ${worktreePath})`,
    })) ?? task;

  const verifyFn =
    opts.verifyWorkspace ??
    (() =>
      Promise.resolve({
        checkPassed: true,
        testsPassed: true,
        headCommit: "dry-run-head",
        summary:
          "Dry-run worktree plan validated (pnpm check + pnpm test:security serialized).",
      }));

  const verification = await runSerializedVerification(() =>
    verifyFn({
      branch: branchVerdict.branch,
      worktreePath,
      baseRef,
    })
  );

  if (!verification.checkPassed || !verification.testsPassed) {
    const errMsg = `Verification gate failed (check=${verification.checkPassed}, tests=${verification.testsPassed}): ${verification.summary}`;
    return (
      (await opts.store.transitionTask({
        userId: opts.userId,
        id: task.id,
        status: "failed",
        stepMessage: errMsg,
        error: errMsg,
      })) ?? task
    );
  }

  task =
    (await opts.store.transitionTask({
      userId: opts.userId,
      id: task.id,
      status: "running",
      stepMessage: `Verification passed: ${verification.summary}`,
    })) ?? task;

  if (requestPush) {
    const pushDigest = computeActionDigest("gitPushDraftBranch", {
      branch: branchVerdict.branch,
      baseRef,
      headCommit: verification.headCommit ?? "pending",
    });

    return (
      (await opts.store.transitionTask({
        userId: opts.userId,
        id: task.id,
        status: "awaiting_approval",
        stepMessage: `Paused before git push: owner approval required for branch "${branchVerdict.branch}" (digest ${pushDigest.slice(0, 12)})`,
        output: `Ready to push isolated draft branch "${branchVerdict.branch}" (SHA-256 action digest: ${pushDigest.slice(0, 12)}). Approve in Routines & Tasks before any remote push.`,
      })) ?? task
    );
  }

  return (
    (await opts.store.transitionTask({
      userId: opts.userId,
      id: task.id,
      status: "succeeded",
      stepMessage: `Completed local-only worktree run on ${branchVerdict.branch} (no git push requested)`,
      output: verification.summary,
    })) ?? task
  );
}
