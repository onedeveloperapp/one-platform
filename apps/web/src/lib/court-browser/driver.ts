import type { Dialog, Frame, Page } from "playwright-core";

import { TARGET_MARK } from "@/lib/court-browser/marks";
import { courtDomainOf, type SignInState } from "@/lib/court-browser/sign-in-page";
import type { ActOp } from "@/lib/court-extension/act";
import type { MappedScreen } from "@/lib/court-extension/capture";
import type { Target } from "@/lib/court-robot/plan";
import type { DriverFile, ScreenDriver } from "@/lib/court-robot/runner";

/**
 * ONE's robot over a court's page in ONE's own browser (Playwright, on ONE's server): the `ScreenDriver` of
 * `runFiling`, made of calls into the script every frame carries (`page-script.ts`), as the extension's driver calls
 * its content script. A frame is named by its place in the last reading of the screen, as the plan's targets name it;
 * a file is attached by the browser itself to the one element marked for it. The court's dialogs: an alert is closed,
 * and the court's question ("confirma?") is answered yes only on a press that may send, which the lawyer's word or a
 * trusted map allowed (`pressing`); any other is answered no. Every call has a time limit.
 */

const CALL_MS = 10_000;
const SETTLE_MOST_MS = 25_000;
const STILL_MS = 700;

type Exposed = {
  __oneCapture?: (rows?: boolean) => unknown;
  __oneAct?: (op: ActOp) => boolean;
  __oneText?: () => string;
  __oneStill?: () => { ready: string; still: number };
  __oneSignIn?: (marking?: boolean) => unknown;
  __oneMark?: (selector: string, index: number, mark: string) => boolean;
};

type Still = { ready: string; still: number } | null;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A call into the page with a time limit: null when it did not answer (a frame gone, a page that hangs). */
function limited<T>(work: Promise<T>, ms = CALL_MS): Promise<T | null> {
  return Promise.race([work, pause(ms).then(() => null)]).catch(() => null);
}

/** A press that started a new page loses its frame before it answers: the press was done. */
const NAVIGATED = /context was destroyed|navigat|frame was detached|target closed/i;

const hostOf = (address: string): string => {
  try {
    return new URL(address).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export type PageDriver = ScreenDriver & {
  /** How many dialogs of the court were answered yes and no: counted, never read. */
  dialogs(): { yes: number; no: number };
  close(): void;
};

export function pageDriver(page: Page, systemHost: string): PageDriver {
  const domain = courtDomainOf(systemHost);
  const ofCourt = (frame: Frame) => {
    const host = hostOf(frame.url());
    return host === domain || host.endsWith(`.${domain}`);
  };
  // The frame of each place of the last reading of the screen.
  let frames: Frame[] = [];
  let sends = false;
  const answered = { yes: 0, no: 0 };

  const onDialog = (dialog: Dialog) => {
    const kind = dialog.type();
    const yes = kind === "alert" || kind === "beforeunload" || (kind === "confirm" && sends);
    answered[yes ? "yes" : "no"] += 1;
    void (yes ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
  };
  page.on("dialog", onDialog);

  async function inFrame(target: Target, op: ActOp): Promise<boolean> {
    const frame = frames[target.frame];
    if (!frame || frame.isDetached()) return false;
    try {
      const done = await Promise.race([
        frame.evaluate((asked) => (globalThis as unknown as Exposed).__oneAct?.(asked) ?? false, op),
        pause(CALL_MS).then(() => null),
      ]);
      return done === true;
    } catch (error) {
      // A press whose page went on to the next one was done; a value is never typed into a page that left.
      return op.op === "click" && error instanceof Error && NAVIGATED.test(error.message);
    }
  }

  return {
    async capture() {
      const all = page.frames();
      const read = await Promise.all(
        all.map((frame) =>
          limited(frame.evaluate(() => (globalThis as unknown as Exposed).__oneCapture?.(true) ?? null)),
        ),
      );
      const screens: MappedScreen[] = [];
      frames = [];
      all.forEach((frame, index) => {
        const screen = read[index] as MappedScreen | null;
        if (screen && screen.system !== null) {
          frames.push(frame);
          screens.push(screen);
        }
      });
      return screens;
    },

    async text() {
      const read = await Promise.all(
        page
          .frames()
          .map((frame) => limited(frame.evaluate(() => (globalThis as unknown as Exposed).__oneText?.() ?? ""))),
      );
      return read.filter((text): text is string => typeof text === "string" && text.length > 0).join("\n");
    },

    fill: (target, value) => inFrame(target, { op: "fill", selector: target.selector, index: target.index, value }),

    select: (target, choice) =>
      inFrame(target, {
        op: "select",
        selector: target.selector,
        index: target.index,
        ...("code" in choice ? { code: choice.code } : { text: choice.text }),
      }),

    check: (target, on) => inFrame(target, { op: "check", selector: target.selector, index: target.index, on }),

    click: (target) => inFrame(target, { op: "click", selector: target.selector, index: target.index }),

    async upload(target, file: DriverFile) {
      const frame = frames[target.frame];
      if (!frame || frame.isDetached()) return false;
      const mark = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const found = await limited(
        frame.evaluate(
          ([selector, index, name]) => (globalThis as unknown as Exposed).__oneMark?.(selector, index, name) ?? false,
          [target.selector, target.index, mark] as [string, number, string],
        ),
      );
      if (found !== true) return false;
      const element = frame.locator(`[${TARGET_MARK}="${mark}"]`).first();
      try {
        await element.setInputFiles(
          { name: file.name, mimeType: file.type, buffer: Buffer.from(file.bytes) },
          { timeout: CALL_MS },
        );
        return true;
      } catch {
        return false;
      } finally {
        await limited(element.evaluate((node, name) => node.removeAttribute(name), TARGET_MARK));
      }
    },

    async settle() {
      // A press may start a new page: it is given a moment to begin before the page is read as still.
      await pause(400);
      const until = Date.now() + SETTLE_MOST_MS;
      await limited(page.waitForLoadState("load", { timeout: SETTLE_MOST_MS }), SETTLE_MOST_MS);
      while (Date.now() < until) {
        // The page is still when its top frame and every frame of the court are complete and have not changed for a
        // moment; a frame of no court is not waited on.
        const waited = page.frames().filter((frame, index) => index === 0 || ofCourt(frame));
        const states = await Promise.all(
          waited.map((frame) =>
            limited(frame.evaluate(() => (globalThis as unknown as Exposed).__oneStill?.() ?? null)),
          ),
        );
        const quiet = (state: Still | undefined) => !!state && state.ready === "complete" && state.still >= STILL_MS;
        if (quiet(states[0] as Still) && states.every((state) => state === null || quiet(state as Still))) return;
        await pause(250);
      }
    },

    async signedOut() {
      const main = page.mainFrame();
      const state = (await limited(
        main.evaluate(() => (globalThis as unknown as Exposed).__oneSignIn?.(false) ?? null),
      )) as SignInState | null;
      if (!state) return false;
      // A court's sign-in on the screen, or the court's code asked away from the system's own pages.
      return state.kind === "form" || (hostOf(main.url()) !== systemHost && state.kind !== "in");
    },

    pressing(may: boolean) {
      sends = may;
    },

    dialogs: () => ({ ...answered }),

    close() {
      page.off("dialog", onDialog);
    },
  };
}
