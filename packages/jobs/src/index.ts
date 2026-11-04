import { Inngest } from "inngest";

/**
 * The platform's clock at the job runner (the owner's decision of 2026-11-04).
 * ONE sends the runner no events: the work a person's action leaves owed is
 * done right after their answer, on the same server, and the one function the
 * runner holds is the beat that runs the sweeps (`one-tick`, in
 * apps/web/src/lib/jobs/tick.ts). So a month of beats spends a fixed share of
 * the runner's quota, and a runner that stops holds nothing a person waits on.
 */

/** Whether this environment has the runner's keys (the signing key is what serves the clock). */
export const isInngestConfigured = Boolean(process.env.INNGEST_SIGNING_KEY);

/**
 * Single Inngest client for the whole platform. In local dev it talks to
 * `npx inngest-cli dev` (no keys needed); in production it requires
 * INNGEST_SIGNING_KEY.
 */
export const inngest = new Inngest({ id: "one" });
