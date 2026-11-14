import { Inngest } from "inngest";

/**
 * The job runner, which holds no function of ONE since 2026-11-14: the platform's
 * one clock runs on ONE's own server (apps/web/clock/), and the work a person's
 * action leaves owed is done right after their answer. The client stays for the
 * serve route, whose sync tells the runner it has nothing left to call.
 */

/** Whether this environment has the runner's keys. */
export const isInngestConfigured = Boolean(process.env.INNGEST_SIGNING_KEY);

/**
 * Single Inngest client for the whole platform. In local dev it talks to
 * `npx inngest-cli dev` (no keys needed); in production it requires
 * INNGEST_SIGNING_KEY.
 */
export const inngest = new Inngest({ id: "one" });
