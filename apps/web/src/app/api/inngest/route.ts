// The clock's beat runs every sweep due in one step (lib/jobs/tick.ts); most
// take seconds, and a round stops starting sweeps after a little over three
// minutes, so a step has the most the Vercel Hobby plan accepts. A work that
// still runs out goes back to the line by itself (its claim expires).
export const maxDuration = 300;

import { tickFunction } from "@/lib/jobs/tick";
import { inngest } from "@flyee/jobs";
import { serve } from "@flyee/jobs/next";

// The platform's one function at the job runner (the owner's decision of
// 2026-11-04): the clock. The work a person's action leaves owed is done right
// after their answer (lib/jobs/soon.ts), and every sweep is listed in
// lib/jobs/registry.ts. A function that is not listed here never runs.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [tickFunction],
});
