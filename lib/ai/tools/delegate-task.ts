import { tool } from "ai";
import { z } from "zod";
import { containsRestrictedWorkData } from "@/lib/connectors/google-workspace";
import { reviewActionRisk } from "@/lib/safety/action-review";
import {
  type BackgroundTaskKind,
  type BackgroundTaskRecord,
  type BackgroundTaskStore,
  createInMemoryTaskStore,
  createPostgresTaskStore,
  TaskStoreUnavailableError,
} from "@/lib/tasks/runner";

let fallbackMemoryTaskStore: BackgroundTaskStore | null = null;

export function resolveTaskStore(
  override?: BackgroundTaskStore
): BackgroundTaskStore {
  if (override) {
    return override;
  }
  if (process.env.POSTGRES_URL?.trim()) {
    return createPostgresTaskStore();
  }
  fallbackMemoryTaskStore ??= createInMemoryTaskStore();
  return fallbackMemoryTaskStore;
}

const DESTRUCTIVE_OR_SENDING_TASK_PATTERN =
  /\b(send\b|email\s+to\b|reply\s+to\b|post\s+to\b|publish\b|git\s+push\b|gh\s+pr\s+(?:create|merge|comment)|rm\s+-|delete\b|drop\s+table|overwrite\b|purchase\b|pay\b|transfer\b|deploy\s+--prod)\b|(?<![\p{L}])(?:gönder|e-?posta\s+at|sil|yayınla|satın\s+al)(?![\p{L}])/iu;

export function isApprovalRequiredTaskPrompt(prompt: string): boolean {
  return DESTRUCTIVE_OR_SENDING_TASK_PATTERN.test(prompt);
}

export type TaskExecutionTarget = "auto" | "cloud" | "mac";

export type DelegatedTaskDispatcher = (opts: {
  userId: string;
  task: BackgroundTaskRecord;
  target: TaskExecutionTarget;
  store: BackgroundTaskStore;
}) => Promise<BackgroundTaskRecord>;

let registeredDispatcher: DelegatedTaskDispatcher | null = null;

/** Allows Step 2 (Cloud Computer) and Step 3 (Mac Bridge) to attach live executors. */
export function registerDelegatedTaskDispatcher(
  dispatcher: DelegatedTaskDispatcher | null
) {
  registeredDispatcher = dispatcher;
}

export async function executeApprovedTask(opts: {
  userId: string;
  taskId: string;
  store?: BackgroundTaskStore;
}): Promise<BackgroundTaskRecord | null> {
  const store = resolveTaskStore(opts.store);
  const existing = await store.getTask({
    userId: opts.userId,
    id: opts.taskId,
  });
  if (!existing) {
    return null;
  }
  const resolvedTarget = inferTaskTarget(existing.prompt, "auto");
  const running =
    (await store.transitionTask({
      userId: opts.userId,
      id: existing.id,
      status: "running",
      stepMessage: `Approved by owner — executing on ${
        resolvedTarget === "cloud"
          ? "Cloud Computer (Linux VM)"
          : resolvedTarget === "mac"
            ? "Mac mini (Tailscale tmux bridge)"
            : "Assistant task runner"
      }`,
    })) ?? existing;

  if (registeredDispatcher) {
    return await registeredDispatcher({
      userId: opts.userId,
      task: running,
      target: resolvedTarget === "assistant" ? "auto" : resolvedTarget,
      store,
    });
  }

  return (
    (await store.transitionTask({
      userId: opts.userId,
      id: running.id,
      status: "succeeded",
      stepMessage: "Approved execution finished",
      output: `Approved and completed "${running.title}" (${resolvedTarget}).`,
    })) ?? running
  );
}

export function inferTaskTarget(
  prompt: string,
  explicit: TaskExecutionTarget = "auto"
): "cloud" | "mac" | "assistant" {
  if (explicit === "cloud" || explicit === "mac") {
    return explicit;
  }
  if (
    /\b(mac\s*mini|on\s+my\s+mac|local\s+repo|claude\s+code|codex\b|agy\b|t3\b|tmux\b|worktree)\b/i.test(
      prompt
    )
  ) {
    return "mac";
  }
  if (
    /\b(cloud\s+(?:vm|computer)|linux\s+vm|clone\s+repo|python\s+script|playwright|scrape|headless\s+browser|\/workspace)\b/i.test(
      prompt
    )
  ) {
    return "cloud";
  }
  return "assistant";
}

export function createDelegateTaskTool(opts: {
  userId: string;
  store?: BackgroundTaskStore;
  hasUntrustedContext?: boolean;
}) {
  const { userId, hasUntrustedContext = false } = opts;

  return tool({
    description:
      "Create and track a structured multi-step task card in chat (for background research, coding, Cloud Computer runs, Mac mini CLI jobs, or multi-step workflows). Destructive or outbound sending tasks automatically pause for owner approval.",
    inputSchema: z.object({
      title: z
        .string()
        .trim()
        .min(2)
        .max(160)
        .describe("Short, clear title shown on the chat Task Card."),
      prompt: z
        .string()
        .trim()
        .min(2)
        .max(4000)
        .describe("Detailed step-by-step goal for the task."),
      kind: z
        .enum([
          "executor",
          "research",
          "coding_worktree",
          "browser_agent",
          "draft_review",
          "routine",
        ])
        .default("executor")
        .optional(),
      target: z
        .enum(["auto", "cloud", "mac"])
        .default("auto")
        .optional()
        .describe(
          "Where to run: 'cloud' (sandboxed Linux VM), 'mac' (Mac mini Tailscale bridge), or 'auto'."
        ),
    }),
    execute: async ({ title, prompt, kind = "executor", target = "auto" }) => {
      if (containsRestrictedWorkData(`${title}\n${prompt}`)) {
        return {
          status: "blocked_data_boundary" as const,
          message:
            "Stopped: employer/Korn Ferry material cannot be queued to personal cloud or assistant task runners.",
        };
      }

      const resolvedTarget = inferTaskTarget(prompt, target);
      const needsApproval =
        hasUntrustedContext ||
        isApprovalRequiredTaskPrompt(`${title}\n${prompt}`);
      const review = reviewActionRisk({
        toolName: "delegateTask",
        input: { title, prompt, kind, target: resolvedTarget },
        hasUntrustedContext,
      });
      const effectiveRisk = needsApproval
        ? review.riskLevel === "low"
          ? "high"
          : review.riskLevel
        : "low";

      let store = resolveTaskStore(opts.store);
      let created: BackgroundTaskRecord;
      try {
        created = await store.enqueueTask({
          userId,
          kind: kind as BackgroundTaskKind,
          title,
          prompt,
          riskLevel: effectiveRisk,
        });
      } catch (err) {
        if (err instanceof TaskStoreUnavailableError) {
          store = resolveTaskStore(createInMemoryTaskStore());
          created = await store.enqueueTask({
            userId,
            kind: kind as BackgroundTaskKind,
            title,
            prompt,
            riskLevel: effectiveRisk,
          });
        } else {
          throw err;
        }
      }

      if (needsApproval) {
        const paused =
          (await store.transitionTask({
            userId,
            id: created.id,
            status: "awaiting_approval",
            stepMessage: `Paused for your approval (${resolvedTarget.toUpperCase()} target · digest ${review.digest.slice(0, 10)})`,
          })) ?? created;

        return {
          status: "awaiting_approval" as const,
          target: resolvedTarget,
          digest: review.digest,
          riskLevel: effectiveRisk,
          task: paused,
          message:
            "Task card created and paused awaiting your approval before any destructive or outbound step runs.",
        };
      }

      const running =
        (await store.transitionTask({
          userId,
          id: created.id,
          status: "running",
          stepMessage: `Dispatched to ${
            resolvedTarget === "cloud"
              ? "Cloud Computer (Linux VM)"
              : resolvedTarget === "mac"
                ? "Mac mini (Tailscale tmux bridge)"
                : "Assistant task runner"
          }`,
        })) ?? created;

      if (registeredDispatcher) {
        const dispatched = await registeredDispatcher({
          userId,
          task: running,
          target,
          store,
        });
        return {
          status: dispatched.status,
          target: resolvedTarget,
          digest: review.digest,
          riskLevel: effectiveRisk,
          task: dispatched,
          message:
            dispatched.output ??
            `Task "${dispatched.title}" is ${dispatched.status}.`,
        };
      }

      const completed =
        (await store.transitionTask({
          userId,
          id: running.id,
          status: "succeeded",
          stepMessage: "Plan recorded and ready in Tasks hub",
          output: `Queued "${title}" (${resolvedTarget}). Track, approve, or stop anytime from this card.`,
        })) ?? running;

      return {
        status: completed.status,
        target: resolvedTarget,
        digest: review.digest,
        riskLevel: effectiveRisk,
        task: completed,
        message:
          completed.output ?? `Task "${completed.title}" added to your chat.`,
      };
    },
  });
}
