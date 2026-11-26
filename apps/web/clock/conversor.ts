import { convertLetterheadPaper, officeConverter } from "@/lib/brand/letterhead-paper-work";
import { createServiceClient } from "@flyee/auth/service";

/**
 * The firm's Word letterhead copied on ONE's server (migration 0300, the owner, 2026-11-25): the service beside the
 * clock that takes each Word document a firm sent as its letterhead as soon as it waits, has the office suite beside
 * it (`conversor-office`, LibreOffice behind Gotenberg, reached by its name on the services' own network and by
 * nothing else) make it a PDF, and keeps that PDF as the firm's paper (`lib/brand/letterhead-paper-work.ts`). Bundled
 * from the same commit as the app and the clock (`clock/build.mjs`, as `conversor.mjs`), run in Node's image
 * (`clock/compose.yml`), and shipped by the production deploy. It asks the database every few seconds while nothing
 * waits; its log holds ids, codes and counts only.
 */

const commit = process.env.ONE_COMMIT ?? "unknown";
/** How long it waits between two questions while no letterhead waits. */
const IDLE_MS = 5_000;
/** How long it waits after the database or the store failed. */
const TROUBLE_MS = 30_000;

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function main(): Promise<void> {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ONE_OFFICE_URL"]) {
    if (!process.env[name]) throw new Error(`${name} must be set`);
  }
  const converter = officeConverter();
  if (!converter) throw new Error("no office converter");
  const service = createServiceClient();

  let stopping = false;
  let wake: (() => void) | null = null;
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      stopping = true;
      wake?.();
    });
  }

  log("started", { commit, converter: converter.name });
  while (!stopping) {
    try {
      const outcome = await convertLetterheadPaper(service, converter);
      if (outcome.code === "idle") {
        await pause(IDLE_MS);
        continue;
      }
      log("letterhead", { org: outcome.orgId, code: outcome.code, problem: outcome.problem ?? null });
    } catch (error) {
      log("trouble", { message: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
      await pause(TROUBLE_MS);
    }
  }
  log("stopped", { commit });
}

main().then(
  () => process.exit(0),
  (error) => {
    log("fatal", { message: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    process.exit(1);
  },
);
