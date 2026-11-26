import type { OneApi } from "@/lib/court-extension/one-api";
import { type LearnedStep, sameScreen, signatureOf } from "@/lib/court-robot/map";
import {
  type Confirmation,
  type DriverFile,
  runFiling,
  type RunOutcome,
  type ScreenDriver,
  type SendPoint,
} from "@/lib/court-robot/runner";
import type {
  ExtensionFile,
  ExtensionFiling,
  ExtensionStarted,
  ExtensionSystem,
} from "@/lib/filing-ways/extension-protocol";

/**
 * A batch filed by the lawyer's extension, in their own session (the owner's second way to file, 2026-11-20): the
 * lawsuits of a batch the lawyer approved in ONE, one after the other, each filled by ONE's robot (`runFiling`) on the
 * court's screen. While ONE learns the system, each filing stops before the first button that may send, the database
 * holding it, until the lawyer gives their word in the extension's panel, or confirms it in ONE, or acts on the court's
 * screen themself (then what they pressed may have sent it, and the filing is marked as going). What only the lawyer
 * can do (log in, type the court's code, answer what no fact answers, accept a term of the court) pauses the batch
 * until they say go on; nothing of it is done for them. A filing whose answer cannot be read is unknown and stops the
 * batch, so a lawyer looks in the court's system before anything goes again.
 *
 * Pure over ONE's calls, the driver of the court's screen and the panel, so it is tested with stand-ins of them.
 */

/** What only the lawyer can end: they act on the court's screen, then say go on or stop. */
export type Pause = {
  kind: "login" | "code" | "question" | "court_error" | "stuck";
  question: string | null;
  filing: ExtensionFiling;
};

export type RunNews =
  | { kind: "filing"; filing: ExtensionFiling; done: number }
  | { kind: "filed"; filing: ExtensionFiling; number: string | null }
  | { kind: "waiting_word"; filing: ExtensionFiling };

export type RunPanel = {
  /** What ONE does now, for the panel to say. */
  tell(news: RunNews): void;
  /**
   * Asks the lawyer's word before the first button that may send, while ONE learns the system: the panel's two
   * buttons. `close` takes the question away when the word came another way.
   */
  askWord(point: { filing: ExtensionFiling; titulo: string; botao: string }): {
    word: Promise<"go" | "stop">;
    close(): void;
  };
  /**
   * The lawyer ends the pause: go on, or stop. ONE's own browser, where no lawyer is at the screen, answers by itself:
   * it signs in again or asks the court's code through ONE, and stops with why (`{ stop }`) where only a person could
   * go on.
   */
  pause(pause: Pause): Promise<"continue" | "stop" | { stop: string }>;
};

export type BatchRunInput = {
  api: OneApi;
  driver: ScreenDriver;
  batchId: string;
  system: ExtensionSystem;
  started: ExtensionStarted;
  /** The bytes of a file of the package, from the link ONE handed. */
  fetchFile(file: ExtensionFile): Promise<DriverFile | null>;
  panel: RunPanel;
  wait(ms: number): Promise<void>;
  /** Runs `work` every `ms` until the returned function is called: the claim of the batch kept fresh. */
  every(ms: number, work: () => void): () => void;
  /**
   * Whether a change of the court's screen while ONE waits for the lawyer's word is their own press (the extension,
   * on the lawyer's screen). ONE's own browser has no lawyer at its screen: a change there is never their word.
   */
  watchScreen?: boolean;
  /** How long ONE waits for the lawyer's word before it stops the batch; no limit where the lawyer is at the screen. */
  wordMostMs?: number;
};

/** How a batch's run ended: how many filed, how many unknown, and why it stopped, when it stopped. */
export type BatchRunEnd = {
  filed: number;
  unknown: number;
  stopped: string | null;
  /** The filing a lawyer must look for in the court's system before anything of it goes again. */
  lookFor: ExtensionFiling | null;
};

const KEEP_EVERY_MS = 60_000;
const SCREEN_EVERY_MS = 1_500;
const STATE_EVERY_TICKS = 3;

type FilingEnd = { kind: "filed" } | { kind: "stop"; why: string; unknown: boolean };

export async function runBatch(input: BatchRunInput): Promise<BatchRunEnd> {
  const { api, batchId } = input;
  const claim = input.started.claim;
  let map: LearnedStep[] | null = input.started.map;
  let filed = 0;
  let unknown = 0;
  const stopKeeping = input.every(KEEP_EVERY_MS, () => {
    void api.keep(batchId, claim);
  });

  /** Ends the run of the batch with why: what of it never went is let go. */
  const stop = async (why: string): Promise<void> => {
    await api.finish(batchId, claim, why);
  };

  /** The lawyer's word, the screen moving under their hand, or ONE telling it was confirmed or stopped there. */
  async function awaitWord(filing: ExtensionFiling, point: SendPoint): Promise<Confirmation | "confirmed" | "timeout"> {
    const asked = input.panel.askWord({ filing, titulo: point.titulo, botao: point.botao });
    const before = signatureOf(point.frames);
    const watchScreen = input.watchScreen !== false;
    const mostTicks = input.wordMostMs ? Math.ceil(input.wordMostMs / SCREEN_EVERY_MS) : null;
    let settled = false;
    const watch = async (): Promise<Confirmation | "confirmed" | "timeout"> => {
      for (let tick = 1; !settled; tick += 1) {
        await input.wait(SCREEN_EVERY_MS);
        if (settled) break;
        if (mostTicks !== null && tick > mostTicks) return "timeout";
        if (watchScreen) {
          const frames = await input.driver.capture().catch(() => null);
          if (frames && frames.length > 0 && !sameScreen(before, signatureOf(frames))) return "moved";
        }
        if (tick % STATE_EVERY_TICKS === 0) {
          const state = await api.state(filing.id);
          if (state.ok) {
            if (state.value.status === "claimed" && state.value.confirmed) return "confirmed";
            if (state.value.status === "gone" || state.value.batch === "stopped") return "stop";
          }
        }
      }
      return "stop";
    };
    try {
      return await Promise.race([asked.word, watch()]);
    } finally {
      settled = true;
      asked.close();
    }
  }

  async function fileOne(filing: ExtensionFiling): Promise<FilingEnd> {
    const files = new Map(filing.files.map((file) => [file.position, file]));
    const learned: LearnedStep[] = [];
    let aiScreens = 0;
    let confirmed = filing.confirmed;
    // The database marks this filing as going: from then on, it may be at the court.
    let marked = false;
    // ONE waited for the lawyer's word for as long as it waits, and no word came.
    let timedOut = false;

    const confirm = async (point: SendPoint): Promise<Confirmation> => {
      const held = await api.hold(filing.id, filing.claim);
      if (!held.ok) return "stop";
      input.panel.tell({ kind: "waiting_word", filing });
      const word = await awaitWord(filing, point);
      if (word === "timeout") {
        timedOut = true;
        return "stop";
      }
      if (word === "stop") return "stop";
      if (word === "confirmed") {
        confirmed = true;
        return "go";
      }
      const given = await api.confirm(filing.id);
      if (!given.ok) {
        // Confirmed in ONE meanwhile: it goes all the same.
        const state = await api.state(filing.id);
        if (!(state.ok && state.value.status === "claimed" && state.value.confirmed)) {
          return word === "moved" ? "moved" : "stop";
        }
      }
      confirmed = true;
      return word;
    };

    for (;;) {
      const run = await runFiling({
        driver: input.driver,
        planner: async (planInput) => {
          const answer = await api.plan(filing.id, filing.claim, planInput.tela, planInput.feito);
          return answer.ok ? answer.value.plan : null;
        },
        system: input.system.name,
        facts: filing.facts,
        file: async (position) => {
          const file = files.get(position);
          return file ? input.fetchFile(file) : null;
        },
        learning: filing.learning,
        confirmed,
        sent: marked,
        confirm,
        map,
        beforeSend: async () => {
          const going = await api.sending(filing.id, filing.claim);
          if (going.ok && going.value.going) {
            marked = true;
            return { ok: true, code: going.value.code };
          }
          return { ok: false, code: going.ok ? going.value.code : going.error };
        },
      });
      learned.push(...run.learned);
      aiScreens += run.aiScreens;
      const outcome: RunOutcome = run.outcome;

      // What ONE learned reading screens is kept for the next filings, the lawyer's word still asked before sending.
      const keepPath = async () => {
        if (aiScreens === 0 || learned.length === 0) return;
        const saved = await api.path(filing.id, filing.claim, learned, aiScreens);
        if (saved.ok && saved.value.saved) map = learned.slice();
      };

      if (outcome.kind === "filed") {
        await keepPath();
        const receipt = await input.driver.text().catch(() => "");
        const recorded = await api.result(filing.id, filing.claim, {
          outcome: "filed",
          number: outcome.number,
          receipt,
        });
        if (!recorded.ok) return { kind: "stop", why: "not_recorded", unknown: true };
        input.panel.tell({ kind: "filed", filing, number: outcome.number });
        return { kind: "filed" };
      }
      if (outcome.kind === "unknown") {
        if (marked) {
          await api.result(filing.id, filing.claim, {
            outcome: "unknown",
            message: "A tela do tribunal não mostrou o recibo depois do envio.",
          });
        }
        return { kind: "stop", why: "unknown_outcome", unknown: true };
      }
      if (outcome.kind === "not_confirmed") {
        await keepPath();
        return { kind: "stop", why: timedOut ? "confirmation_timeout" : "not_confirmed", unknown: false };
      }
      if (outcome.kind === "not_sent") return { kind: "stop", why: outcome.code, unknown: false };

      // Only the lawyer can end it: they act on the court's screen, then say go on, or stop.
      const word = await input.panel.pause({
        kind: outcome.kind,
        question: outcome.kind === "question" || outcome.kind === "court_error" ? outcome.question : null,
        filing,
      });
      if (word === "continue") continue;
      if (marked) {
        await api.result(filing.id, filing.claim, {
          outcome: "unknown",
          message: "O protocolo parou depois do envio, antes do recibo.",
        });
        return { kind: "stop", why: "stopped_after_sending", unknown: true };
      }
      return { kind: "stop", why: typeof word === "object" ? word.stop : "by_lawyer", unknown: false };
    }
  }

  try {
    for (;;) {
      const next = await api.next(batchId, claim);
      if (!next.ok) return { filed, unknown, stopped: next.error, lookFor: null };
      const filing = next.value.filing;
      if (!filing) {
        const finished = await api.finish(batchId, claim, null);
        return { filed, unknown, stopped: finished.ok ? null : finished.error, lookFor: null };
      }
      input.panel.tell({ kind: "filing", filing, done: filed });
      const end = await fileOne(filing);
      if (end.kind === "filed") {
        filed += 1;
        continue;
      }
      if (end.unknown) unknown += 1;
      await stop(end.why);
      return { filed, unknown, stopped: end.why, lookFor: end.unknown ? filing : null };
    }
  } finally {
    stopKeeping();
  }
}
