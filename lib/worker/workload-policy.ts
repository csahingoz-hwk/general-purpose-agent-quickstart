import { reviewActionRisk } from "@/lib/safety/action-review";
import type { BackgroundTaskRecord } from "@/lib/tasks/runner";

export type WorkloadRouteDecision =
  | {
      route: "run_local_light";
      reason: string;
    }
  | {
      route: "pause_for_approval";
      reason: string;
    }
  | {
      route: "defer_heavy_to_cloud_run";
      reason: string;
    }
  | {
      route: "blocked_work_data_boundary";
      reason: string;
    };

// 8 GB RAM Mac mini rule: never run rendering, Docker/containers, video encoding,
// multi-tab headless browser crawls, or heavy OCR batches locally.
const HEAVY_WORKLOAD_PATTERN =
  /\b(?:docker|container|remotion|ffmpeg|render\s+video|video\s+render|transcode|4k|1080p|batch\s+ocr|multi[-\s]?tab|crawl\s+\d+|playwright\s+batch|headless\s+cluster|gpu|fine[-\s]?tune)\b/i;

// Data boundary rule: Korn Ferry / employer material must never be offloaded to
// personal Google Cloud (Cloud Run / Colab / AI Studio), DeepSeek, or free OpenRouter.
const WORK_CONFIDENTIAL_PATTERN =
  /\b(?:korn\s*ferry|hay\s*group|\bsa90\b|\beosb\b|gl\s*239300|sox\s+control)\b/i;

export function classifyTaskWorkload(
  task: Pick<BackgroundTaskRecord, "kind" | "title" | "prompt" | "riskLevel">
): WorkloadRouteDecision {
  const combined = `${task.title}\n${task.prompt}`;

  if (task.riskLevel === "high" || task.riskLevel === "critical") {
    return {
      route: "pause_for_approval",
      reason: `Task riskLevel is "${task.riskLevel}"; explicit owner approval is required before execution.`,
    };
  }

  const risk = reviewActionRisk({
    toolName: task.kind === "routine" ? "scheduleTask" : "backgroundTask",
    input: { title: task.title, prompt: task.prompt, kind: task.kind },
    hasUntrustedContext: false,
  });

  if (risk.riskLevel === "critical") {
    return {
      route: "pause_for_approval",
      reason: risk.reasons.join("; "),
    };
  }

  if (HEAVY_WORKLOAD_PATTERN.test(combined)) {
    if (WORK_CONFIDENTIAL_PATTERN.test(combined)) {
      return {
        route: "blocked_work_data_boundary",
        reason:
          "Task requires heavy compute (excluded from the 8 GB RAM Mac mini) and references employer/work material, which cannot be sent to personal Cloud Run or Colab.",
      };
    }
    return {
      route: "defer_heavy_to_cloud_run",
      reason:
        "Heavy container/rendering/browser workload skipped on the 8 GB RAM Mac mini; routed for scale-to-zero Cloud Run / RunPod offload.",
    };
  }

  return {
    route: "run_local_light",
    reason: "Lightweight queue task within the ~40 MB local worker cap.",
  };
}
