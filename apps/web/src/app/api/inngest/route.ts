import { inngest } from "@flyee/jobs";
import { serve } from "@flyee/jobs/next";

// The job runner holds no function of ONE since 2026-11-14 (the owner's yes): the platform's one clock runs on ONE's
// own server (apps/web/clock/), from the same commit, and the work a person's action leaves owed is done right after
// their answer (lib/jobs/soon.ts). The route stays only so the production deploy's sync tells the runner it has
// nothing left to call: a runner synced with a function it no longer finds would keep calling this route.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
