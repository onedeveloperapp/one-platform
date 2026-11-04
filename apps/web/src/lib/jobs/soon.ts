import "server-only";

import { after } from "next/server";

/**
 * A work a person's action left owed (a reading, a check, ONE's answer in a conversation, the next step of a case),
 * done right after they are answered (`after`), on the same server, never through the job runner: the runner's
 * quota is kept for its clock (`lib/jobs/schedule.ts`), and a person never waits on a queue somewhere else. The
 * database claims each work under a number, so the sweeps never do it twice, and what does not finish here is
 * theirs. A work asked for from inside another (`after` within `after`) runs as well. Outside a request (a script,
 * a test) nothing is scheduled: the sweeps take it. Never throws; answers whether the work was scheduled.
 */
export function soon(label: string, task: () => Promise<unknown>): boolean {
  try {
    after(async () => {
      try {
        await task();
      } catch (error) {
        // The label and the kind of failure only: a work's own data never goes to a log.
        console.error("work_after_answer_failed", {
          label,
          message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
        });
      }
    });
    return true;
  } catch {
    return false;
  }
}
