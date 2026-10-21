# @flyee/jobs

Background jobs, queues and cron via [Inngest](https://www.inngest.com), shared by every package that needs async work.

## Concept

One Inngest client (`inngest`, app id `one`) with a typed event map (`JobEvents`). Events are named `one/<thing>.<what happened>` and function ids start with `one-`. Whoever needs async processing declares its event in `JobEvents` and defines its functions next to the code they run: a package in its own `src/jobs.ts` (packages may depend on packages, never on apps), the app in `apps/web/src/lib/*-jobs.ts`. `apps/web/src/app/api/inngest/route.ts` serves the aggregated function list; a function missing from that list never runs.

## Graceful degradation

`sendEvent(name, data)` never throws — it returns `{ sent: false, hint }` when Inngest is unreachable. **Callers must offer an inline fallback** (same rule as `@flyee/email`): e.g. a message to the list is delivered after the operator's request is answered when the event cannot be queued (`startNewsletterDelivery`), and a backup asked for in the console runs inline.

The fallback covers what an action starts. A cron has no fallback: without Inngest nothing scheduled runs.

## Local dev

```
npx inngest-cli dev
```

No keys needed locally; the SDK auto-discovers the dev server and the route at `/api/inngest`.

## Production (Vercel)

Set in the Vercel project (or `apps/web/.env`):

```
INNGEST_EVENT_KEY=      # Inngest dashboard > Events
INNGEST_SIGNING_KEY=    # Inngest dashboard > Signing key
```

Then register the app URL (`https://<domain>/api/inngest`) in the Inngest dashboard. The [Vercel integration](https://www.inngest.com/docs/deploy/vercel) automates both.

## Adding a job

1. Add the event to `JobEvents` in `src/index.ts`.
2. Create the function in the owning package:

```ts
import { inngest } from "@flyee/jobs";

export const myJob = inngest.createFunction(
  { id: "one-my-job", retries: 3 },
  { event: "one/thing.happened" },
  async ({ event, step }) => {
    /* steps are retried independently */
  },
);
```

3. Append it to the `functions` array in `apps/web/src/app/api/inngest/route.ts`.

Cron: use `{ cron: "0 6 * * *" }` as the trigger instead of an event. Crons run in UTC.

## Sending something once

A job that writes to people may run twice (a retry, two workers, an operator's button pressed while the cron is working). The rule here is **claim, then send**: a database function marks the row as sent in the same statement that returns it (`for update skip locked`), and only then the message leaves. A second run finds nothing left to claim. The worst case is a message that was claimed and not delivered, never one delivered twice. Migration `0023_messages` has the claim functions; the bell's `source_key` (unique) is the same fence for notices that have no row of their own.
