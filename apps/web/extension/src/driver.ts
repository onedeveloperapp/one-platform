/**
 * ONE's robot over the court's tab in the lawyer's own browser: the `ScreenDriver` of `runFiling`, made of calls into
 * the content script of each frame (`content.ts`) through `chrome.scripting`. A frame is named by its place in the last
 * reading of the screen, as the plan's targets name it. Every call has a time limit: a dialog of the court left open
 * holds the page, and then nothing is done until the lawyer closes it.
 */
import type { ChromeApi } from "./chrome";

import type { ActOp } from "@/lib/court-extension/act";
import type { MappedScreen } from "@/lib/court-extension/capture";
import type { Target } from "@/lib/court-robot/plan";
import type { DriverFile, ScreenDriver } from "@/lib/court-robot/runner";

const CALL_MS = 10_000;
const SETTLE_MOST_MS = 25_000;
const STILL_MS = 700;

type Exposed = {
  __oneCapture?: (rows?: boolean) => unknown;
  __oneAct?: (op: ActOp) => boolean;
  __oneText?: () => string;
  __oneStill?: () => { ready: string; still: number };
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function limited<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work, pause(ms).then(() => null)]).catch(() => null);
}

/** The bytes as base64, in pieces: a file of the package is too large for one call of `fromCharCode`. */
export function base64Of(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(text);
}

export function tabDriver(ext: ChromeApi, tabId: number, stopped: () => boolean): ScreenDriver {
  // The frame of each place of the last reading of the screen.
  let frameIds: number[] = [];

  async function inFrame(target: Target, op: ActOp): Promise<boolean> {
    if (stopped()) return false;
    const frameId = frameIds[target.frame];
    if (frameId === undefined) return false;
    const results = await limited(
      ext.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: (asked: ActOp) => (globalThis as unknown as Exposed).__oneAct?.(asked) ?? false,
        args: [op],
      }),
      CALL_MS,
    );
    return results?.[0]?.result === true;
  }

  return {
    async capture() {
      const results = await limited(
        ext.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => (globalThis as unknown as Exposed).__oneCapture?.(true) ?? null,
        }),
        CALL_MS,
      );
      const frames = (results ?? [])
        .filter((entry) => {
          const screen = entry.result as MappedScreen | null | undefined;
          return !!screen && screen.system !== null;
        })
        .sort((a, b) => a.frameId - b.frameId);
      frameIds = frames.map((entry) => entry.frameId);
      return frames.map((entry) => entry.result as MappedScreen);
    },

    async text() {
      const results = await limited(
        ext.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => (globalThis as unknown as Exposed).__oneText?.() ?? "",
        }),
        CALL_MS,
      );
      return (results ?? [])
        .sort((a, b) => a.frameId - b.frameId)
        .map((entry) => (typeof entry.result === "string" ? entry.result : ""))
        .filter(Boolean)
        .join("\n");
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

    upload: (target, file: DriverFile) =>
      inFrame(target, {
        op: "upload",
        selector: target.selector,
        index: target.index,
        name: file.name,
        type: file.type,
        base64: base64Of(file.bytes),
      }),

    async settle() {
      // A press may start a new page: it is given a moment to begin before the page is read as still.
      await pause(400);
      const until = Date.now() + SETTLE_MOST_MS;
      while (Date.now() < until) {
        const results = await limited(
          ext.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: () => (globalThis as unknown as Exposed).__oneStill?.() ?? null,
          }),
          CALL_MS,
        );
        // The page is still when its top frame (a new page has it once the content script runs there) and every
        // frame of the court's are complete and have not changed for a moment; a frame of no court is not waited on.
        type Still = { ready: string; still: number } | null | undefined;
        const top = (results ?? []).find((entry) => entry.frameId === 0)?.result as Still;
        const frames = (results ?? []).map((entry) => entry.result as Still).filter((frame) => !!frame);
        const quiet = (frame: Still) => !!frame && frame.ready === "complete" && frame.still >= STILL_MS;
        if (quiet(top) && frames.every(quiet)) return;
        await pause(250);
      }
    },
  };
}
