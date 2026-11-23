import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

import { getVault } from "@/lib/connections/vault";
import { serverBackend } from "@/lib/court-browser/backend";
import { courtBrowser } from "@/lib/court-browser/worker";
import { createServiceClient } from "@flyee/auth/service";

/**
 * ONE's own browser on ONE's server (the owner's first way to file, 2026-11-20): the service beside the platform's
 * clock that files the batches lawyers approved for it, with their court login, and checks a login as soon as it is
 * given (`lib/court-browser/worker.ts`). Bundled from the same commit as the app and the clock (`clock/build.mjs`, as
 * `navegador.mjs`, with the script every page it opens carries, `pagina.js`), run in Playwright's own image
 * (`clock/compose.yml`), and shipped by the production deploy (`clock/receber.sh`). A new version takes its place
 * between two lawsuits of a batch, never inside one. Its log holds ids, codes and counts only.
 */

const commit = process.env.ONE_COMMIT ?? "unknown";

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function main(): Promise<void> {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VAULT_KEYS"]) {
    if (!process.env[name]) throw new Error(`${name} must be set`);
  }
  const access = getVault();
  if (!access.ok) throw new Error(`vault: ${access.problem}`);
  const pageScript = readFileSync(new URL("./pagina.js", import.meta.url), "utf8");
  const launch = () => chromium.launch({ headless: true });

  // Loaded, with its keys, its browser started and closed, and out: how a new version is tried (receber.sh).
  if (process.env.ONE_BROWSER_CHECK === "1") {
    const browser = await launch();
    log("checked", { commit, browser: browser.version() });
    await browser.close();
    return;
  }

  const worker = courtBrowser({
    backend: serverBackend(createServiceClient(), access.vault),
    launch,
    pageScript,
    log,
    commit,
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => worker.stop());
  await worker.run();
}

main().then(
  () => process.exit(0),
  (error) => {
    log("fatal", { message: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    process.exit(1);
  },
);
