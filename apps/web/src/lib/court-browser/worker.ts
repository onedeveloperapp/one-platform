import type { Browser, BrowserContext, Page } from "playwright-core";

import { type PageDriver, pageDriver } from "@/lib/court-browser/driver";
import { type CodeAnswer, signIn, type SignInOutcome } from "@/lib/court-browser/sign-in";
import { courtDomainOf } from "@/lib/court-browser/sign-in-page";
import type { BrowserBackend, ClaimedBatch, LoginCheck } from "@/lib/court-browser/types";
import { type BatchRunEnd, type Pause, runBatch } from "@/lib/court-extension/batch-run";
import type { OneApi } from "@/lib/court-extension/one-api";
import type { DriverFile } from "@/lib/court-robot/runner";

/**
 * ONE's own browser on ONE's server (the owner's first way to file, 2026-11-20, root `CLAUDE.md`, "Three ways to
 * file"): one Chromium with no window, run beside the platform's clock (`clock/navegador.ts`). In turns it checks a
 * court login a lawyer just gave (it signs in and stops where the court asks its code: the court took the login), and
 * files a batch a lawyer approved for it: it signs in with the lawyer's login, asks the lawyer the court's code through
 * ONE when the court asks it, and files the batch's lawsuits one by one with the same robot and the same run of a batch
 * as the lawyer's extension (`runBatch`), the lawyer's word asked in ONE, over a picture of the court's screen, before
 * the first filing at a system ONE still learns. What only a person could answer (a captcha, a question of the court
 * no fact answers, an error of the court) stops the batch with why: there is nobody at this screen, and nothing is
 * answered for them.
 *
 * Each job opens a context of its own and closes it: no cookie, no session and no file outlives it. The browser does
 * not disguise itself: it is the Chromium Playwright runs, as it is. Its log holds ids, codes and counts only.
 */

export type WorkerDeps = {
  backend: BrowserBackend;
  /** Starts the browser (Chromium of Playwright, no window). */
  launch(): Promise<Browser>;
  /** The script every frame carries (`page-script.ts`, bundled as `pagina.js`). */
  pageScript: string;
  log(event: string, data?: Record<string, unknown>): void;
  /** A stand-in of a court routes its pages here (the smoke test); production opens the courts themselves. */
  prepare?(context: BrowserContext): Promise<void>;
  /** The bytes of a file of the package, from the short link ONE handed. */
  fetchFile?(url: string): Promise<Uint8Array | null>;
  commit?: string;
  /** How long ONE waits for the court's code the lawyer types in ONE, and for their word before a first filing. */
  codeMostMs?: number;
  wordMostMs?: number;
  /** How long ONE's browser rests when nothing waits for it. */
  idleMs?: number;
};

const CODE_MOST_MS = 5 * 60_000;
const WORD_MOST_MS = 30 * 60_000;
const IDLE_MS = 10_000;
const BEAT_MS = 60_000;
const CODE_POLL_MS = 2_000;
const OPEN_MS = 45_000;

/** Why a batch stops at a sign-in that did not open the court's session, as the batch keeps it (`error`). */
export function signInStop(outcome: SignInOutcome): string | null {
  switch (outcome.kind) {
    case "in":
      return null;
    case "refused":
      return "court_login_refused";
    case "blocked":
      return "court_login_blocked";
    case "captcha":
      return "court_captcha";
    case "code_refused":
      return "court_code_refused";
    case "no_code":
      return outcome.why === "stopped" ? "by_person_code" : "court_code_missing";
    case "asks_code":
      return "court_code_missing";
    case "failed":
      return "court_sign_in_failed";
  }
}

/** Why a batch stops at a pause of the run where nobody is at the screen. */
export function pauseStop(kind: Pause["kind"]): string {
  return kind === "question" ? "court_question" : kind === "court_error" ? "court_error" : `stopped_${kind}`;
}

class Interrupted extends Error {
  constructor() {
    super("interrupted");
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function courtBrowser(deps: WorkerDeps) {
  const { backend, log } = deps;
  let stopping = false;
  let browser: Browser | null = null;
  let working: string | null = null;
  let lastBeat = 0;

  const fetchFile =
    deps.fetchFile ??
    (async (url: string) => {
      const response = await fetch(url);
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    });

  /** Rests for a while, or less once a stop is asked. */
  async function rest(ms: number): Promise<void> {
    const until = Date.now() + ms;
    while (!stopping && Date.now() < until) await sleep(Math.min(500, until - Date.now()));
  }

  async function opened(): Promise<Browser> {
    if (browser && browser.isConnected()) return browser;
    browser = await deps.launch();
    return browser;
  }

  async function newPage(): Promise<{ context: BrowserContext; page: Page }> {
    const context = await (
      await opened()
    ).newContext({
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      viewport: { width: 1366, height: 900 },
      acceptDownloads: false,
    });
    await context.addInitScript({ content: deps.pageScript });
    if (deps.prepare) await deps.prepare(context);
    return { context, page: await context.newPage() };
  }

  async function open(page: Page, system: { host: string; startPath: string }, driver?: PageDriver) {
    await page.goto(`https://${system.host}${system.startPath}`, { waitUntil: "load", timeout: OPEN_MS });
    if (driver) await driver.settle();
  }

  /** A login a lawyer just gave: ONE signs in and stops where the court asks its code. */
  async function check(item: LoginCheck): Promise<void> {
    working = "check";
    const { context, page } = await newPage();
    const driver = pageDriver(page, item.system.host);
    try {
      await open(page, item.system, driver);
      const outcome = await signIn(page, {
        login: item.login,
        senha: item.senha,
        courtDomain: courtDomainOf(item.system.host),
        settle: () => driver.settle(),
      });
      const said =
        outcome.kind === "in" || outcome.kind === "asks_code"
          ? "verified"
          : outcome.kind === "refused" || outcome.kind === "blocked"
            ? outcome.kind
            : null;
      if (said) await backend.checked(item, said);
      log("login_checked", { connection: item.connectionId, system: item.system.key, outcome: outcome.kind });
    } catch (error) {
      log("login_check_failed", { connection: item.connectionId, message: messageOf(error) });
    } finally {
      driver.close();
      await context.close().catch(() => undefined);
      working = null;
    }
  }

  /** The court's code for a batch: asked of the lawyer in ONE, taken once they typed it. */
  async function codeFor(batch: ClaimedBatch, again: boolean): Promise<CodeAnswer> {
    const kind = batch.system.loginKind === "password_email" ? "email" : "app";
    if (!(await backend.askCode(batch, kind))) return { none: "not_asked" };
    log("code_asked", { batch: batch.batchId, again });
    const until = Date.now() + (deps.codeMostMs ?? CODE_MOST_MS);
    let polls = 0;
    while (Date.now() < until) {
      if (stopping) return { none: "interrupted" };
      const taken = await backend.takeCode(batch);
      if (taken.kind === "code") return { code: taken.code };
      if (taken.kind === "gone") return { none: "stopped" };
      polls += 1;
      if (polls % 5 === 0) {
        const status = await backend.batchStatus(batch.batchId);
        if (status !== "awaiting_code" && status !== "running") return { none: "stopped" };
        await backend.touch(batch);
      }
      await sleep(CODE_POLL_MS);
    }
    return { none: "timeout" };
  }

  /** A batch a lawyer approved for ONE's browser, filed with their login. */
  async function file(batch: ClaimedBatch): Promise<void> {
    working = batch.batchId;
    log("batch_claimed", { batch: batch.batchId, system: batch.system.key, learning: batch.learning });
    const login = await backend.openLogin(batch);
    if (!login.ok) {
      await backend.finish(batch, login.code);
      log("batch_stopped", { batch: batch.batchId, why: login.code });
      working = null;
      return;
    }
    const { context, page } = await newPage();
    const driver = pageDriver(page, batch.system.host);
    const domain = courtDomainOf(batch.system.host);
    const enter = () =>
      signIn(page, {
        login: login.login,
        senha: login.senha,
        courtDomain: domain,
        code: (again) => codeFor(batch, again),
        settle: () => driver.settle(),
      });
    let end: BatchRunEnd | null = null;
    let why: string | null = null;
    try {
      await open(page, batch.system, driver);
      const entered = await enter();
      if (entered.kind === "refused" || entered.kind === "blocked") {
        await backend.checked({ orgId: batch.orgId, connectionId: login.connectionId }, entered.kind);
      }
      why = signInStop(entered);
      if (why) {
        log("sign_in_stopped", {
          batch: batch.batchId,
          outcome: entered.kind,
          why: "why" in entered ? entered.why : null,
        });
        await backend.finish(batch, why);
        return;
      }
      await backend.checked({ orgId: batch.orgId, connectionId: login.connectionId }, "verified");
      const started = await backend.started(batch);
      if (!started) {
        why = "unavailable";
        await backend.finish(batch, why);
        return;
      }
      const calls = backend.api(batch, started, {
        screenshot: async () => new Uint8Array(await page.screenshot({ fullPage: true, type: "png" })),
        receipt: async () =>
          new Uint8Array(
            await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm" } }),
          ),
      });
      // A stop asked of the service (a new version on the server) ends the batch between two lawsuits, never inside one.
      const api: OneApi = {
        ...calls,
        next: (id, claim) => (stopping ? Promise.resolve({ ok: false, error: "interrupted" }) : calls.next(id, claim)),
      };
      end = await runBatch({
        api,
        driver,
        batchId: batch.batchId,
        system: started.system,
        started,
        fetchFile: async (handed): Promise<DriverFile | null> => {
          const bytes = await fetchFile(handed.url).catch(() => null);
          return bytes ? { name: handed.name, type: handed.type, bytes } : null;
        },
        panel: {
          tell: (news) => log(`filing_${news.kind}`, { batch: batch.batchId, filing: news.filing.id }),
          // Nobody is at this screen: the lawyer's word comes only from ONE, where they see the court's screen kept.
          askWord: () => ({ word: new Promise<"go" | "stop">(() => undefined), close: () => undefined }),
          pause: async (paused) => {
            if (stopping) return { stop: "interrupted" };
            if (paused.kind === "login" || paused.kind === "code") {
              // The court's session ended, or the court asks its code: ONE signs in again as at the start.
              const again = await enter();
              const stop = signInStop(again);
              log("signed_in_again", { batch: batch.batchId, outcome: again.kind });
              return stop ? { stop } : "continue";
            }
            return { stop: pauseStop(paused.kind) };
          },
        },
        wait: async (ms) => {
          await sleep(ms);
          if (stopping) throw new Interrupted();
        },
        every: (ms, work) => {
          const timer = setInterval(work, ms);
          return () => clearInterval(timer);
        },
        watchScreen: false,
        wordMostMs: deps.wordMostMs ?? WORD_MOST_MS,
      });
      // A run that could not take the next lawsuit ends here, its batch stopped with why.
      if (end.stopped) await backend.finish(batch, end.stopped);
      log("batch_ended", {
        batch: batch.batchId,
        filed: end.filed,
        unknown: end.unknown,
        stopped: end.stopped,
        dialogs: driver.dialogs(),
      });
    } catch (error) {
      why = error instanceof Interrupted ? "interrupted" : "browser_failed";
      await backend.finish(batch, why).catch(() => undefined);
      log("batch_failed", { batch: batch.batchId, why, message: messageOf(error) });
    } finally {
      driver.close();
      await context.close().catch(() => undefined);
      working = null;
    }
  }

  async function beat(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - lastBeat < BEAT_MS) return;
    lastBeat = now;
    await backend
      .beat({ at: new Date(now).toISOString(), commit: deps.commit ?? "unknown", working })
      .catch(() => undefined);
  }

  /** One turn: a login to check first (the lawyer waits on the screen), else a batch. False when nothing waited. */
  async function turn(): Promise<boolean> {
    const item = await backend.claimCheck();
    if (item) {
      await check(item);
      return true;
    }
    const batch = await backend.claimBatch();
    if (batch) {
      await file(batch);
      return true;
    }
    return false;
  }

  return {
    turn,
    stop() {
      stopping = true;
    },
    async run(): Promise<void> {
      log("start", { commit: deps.commit ?? "unknown" });
      await beat(true);
      while (!stopping) {
        let busy = false;
        try {
          busy = await turn();
        } catch (error) {
          log("turn_failed", { message: messageOf(error) });
        }
        await beat();
        if (!busy) await rest(deps.idleMs ?? IDLE_MS);
      }
      await browser?.close().catch(() => undefined);
      log("stop");
    },
  };
}

/** The kind of a failure only: a work's own data never goes to a log. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 160) : "unknown";
}
