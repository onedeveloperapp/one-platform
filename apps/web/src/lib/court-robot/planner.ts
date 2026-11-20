import "server-only";

import { runFirmTask } from "@/lib/ai/executor";
import { readPlan } from "@/lib/court-robot/plan";
import type { ScreenPlanner } from "@/lib/court-robot/runner";

/**
 * The AI that reads a court's screen for a filing (migration 0264, task `protocolo.tela`), through the platform's
 * executor, which records every run (task, version of the instructions, model, cost) under the firm and the filing.
 * It is given the screen's structure and the facts' names (`PlanInput`), never a person's data: the robot types the
 * values. An answer that is not a plan, or no answer, is null, and the robot stops there.
 */
export function aiScreenPlanner(orgId: string, submissionId: string): ScreenPlanner {
  return async (input) => {
    const result = await runFirmTask({
      orgId,
      task: "protocolo.tela",
      input,
      subject: { type: "filing_submission", id: submissionId },
    });
    if (result.kind !== "finished") return null;
    return readPlan(result.output);
  };
}
