# @flyee/jobs

The [Inngest](https://www.inngest.com) client (`inngest`, app id `one`) and its `serve` for Next.js, which hold no function of ONE since 2026-11-14.

## Concept

**Since 2026-11-14 the platform's one clock runs on ONE's own server** (`apps/web/clock/`: a Node process bundled from the same commit as the app and shipped by the production deploy; see `apps/web/ARCHITECTURE.md`, "Background work", and `docs/DEPLOY.md`). Its beats on Vercel, five minutes apart, each loading the app and running every sweep due, were most of the Active CPU the Hobby plan allows. The route `/api/inngest` serves no function, so the deploy's sync tells the runner it has nothing left to call.

From 2026-11-04 to 2026-11-14 (the owner's decision of 2026-11-04), ONE sent the runner no events and held one function there, the clock: `one-tick`, a beat every five minutes that ran, in one step, every sweep due at that beat. Two executions a beat, about 18 thousand a month, within the 50 thousand of Inngest's free plan. Before, every kind of work had its own function, with its own cron and event: the crons alone spent some 15 thousand executions a day, the free quota ran out on the fourth day of November 2026, and the runner paused everything ONE does by itself, the readings a person waited on included.

- **The work a person's action leaves owed** (a reading, a check, ONE's answer in a conversation, the next step of a case) is done right after their answer, on the same server: `soon(label, task)` in `apps/web/src/lib/jobs/soon.ts`, over Next's `after()`. Never through the runner.
- **What is left** (a work that failed, one that waits for an hour of the day, the upkeep) is the sweeps': each is a `Sweep` (`apps/web/src/lib/jobs/schedule.ts`: its key, when the clock runs it, whether it also runs while ONE is used, and its `run`), declared next to the code it runs (`apps/web/src/lib/*/jobs.ts`, `lib/*-jobs.ts`, a module's `jobs.ts`) and listed in `apps/web/src/lib/jobs/registry.ts`; a sweep missing from that list never runs.
- **While somebody uses ONE and the clock has been silent** (its last `clock_beat` older than fifteen minutes), the sweeps that serve what people wait on also run, once in five minutes on each server, after the answer (`sweepWhileUsed`, `apps/web/src/lib/jobs/while-used.ts`), so a server that stops holds nothing a person is looking at.

## Running the clock

On a development machine nothing beats by itself: the work after each answer runs, and the rounds while ONE is used run (there is no `clock_beat`). One beat on demand, against the database `.env.local` points at:

```
node apps/web/clock/build.mjs
cd apps/web/clock/dist && npm install && ONE_CLOCK_ONCE=1 node --env-file=../../.env.local relogio.mjs
```

Never beside a running clock: the sweeps that must never run from two servers at once (the DJEN, the court's reading, ANAC's months, the backup, the newsletter) are the clock's only.

In production the deploy ships the clock to ONE's server (`docs/DEPLOY.md`, "O relógio do ONE"). `INNGEST_SIGNING_KEY` stays in Vercel only for the sync that tells the runner it has nothing to call.

## Adding a sweep

```ts
import type { Sweep } from "@/lib/jobs/schedule";

export const thingSweeps: Sweep[] = [
  {
    key: "thing",
    when: { every: 10 }, // or { hourly: 20 }, or { daily: { hour: 4, minute: 30 } } (UTC; minutes on a beat)
    whileUsed: true, // only when it serves what people wait on and two servers at once do nothing twice
    run: async (service, until) => {
      /* claim and work while Date.now() < until; counts only in the answer */
      return { done: 0 };
    },
  },
];
```

Then add it to `SWEEPS` in `apps/web/src/lib/jobs/registry.ts`. A sweep's answer goes to the clock's log: counts and switches only, never anything of a person.

## Sending something once

A sweep that writes to people may run twice (two servers, the clock and a round while ONE is used, an operator's button pressed while the clock is working). The rule here is **claim, then send**: a database function marks the row as sent in the same statement that returns it (`for update skip locked`), and only then the message leaves. A second run finds nothing left to claim. The worst case is a message that was claimed and not delivered, never one delivered twice. Migration `0023_messages` has the claim functions; the bell's `source_key` (unique) is the same fence for notices that have no row of their own.
