/**
 * The extension's background: it keeps the map being made (the screens mapped and the path recorded) in the browser's
 * session storage, which ends with the browser, and hands it to the popup to be saved as a file. It talks to no
 * server: what leaves the lawyer's computer is the file the lawyer sends.
 */
import { chromeApi, type MessageSender } from "./chrome";

import {
  COURT_SYSTEMS,
  type CourtSystemKey,
  courtSystemOf,
  type MappedScreen,
  type MappedStep,
} from "@/lib/court-extension/capture";

/** One screen as the lawyer mapped it: each frame of the page (the Projudi draws some screens in frames). */
type Captured = { capturedAt: string; frames: MappedScreen[] };
type MapState = { recording: boolean; screens: Captured[]; steps: MappedStep[] };

const ext = chromeApi();
const EMPTY: MapState = { recording: false, screens: [], steps: [] };
const SCREEN_LIMIT = 200;
const STEP_LIMIT = 3000;

async function load(): Promise<MapState> {
  const stored = (await ext.storage.session.get("map")).map as Partial<MapState> | undefined;
  return { ...EMPTY, ...(stored ?? {}) };
}

const save = (state: MapState) => ext.storage.session.set({ map: state });

// One change at a time: a burst of clicks is never lost to two writes at once.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** The heading that names a mapped screen, for the popup to say which it was. */
const nameOf = (captured: Captured | undefined): string | null =>
  captured?.frames.map((frame) => frame.headings[0] ?? frame.title).find(Boolean) ?? null;

async function captureTab(tabId: number): Promise<Captured | null> {
  const results = await ext.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (globalThis as unknown as { __oneCapture?: () => unknown }).__oneCapture?.() ?? null,
  });
  const frames = results
    .map((entry) => entry.result as MappedScreen | null | undefined)
    .filter((frame): frame is MappedScreen => !!frame && frame.system !== null);
  return frames.length > 0 ? { capturedAt: new Date().toISOString(), frames } : null;
}

type Asked = { type?: string; tabId?: number; on?: boolean; step?: MappedStep };

async function handle(asked: Asked, sender: MessageSender): Promise<unknown> {
  switch (asked.type) {
    case "status": {
      const state = await load();
      return {
        ok: true,
        recording: state.recording,
        screens: state.screens.length,
        steps: state.steps.length,
        last: nameOf(state.screens.at(-1)),
      };
    }
    case "capture": {
      if (typeof asked.tabId !== "number") return { ok: false, code: "no_tab" };
      const captured = await captureTab(asked.tabId);
      if (!captured) return { ok: false, code: "no_screen" };
      return serial(async () => {
        const state = await load();
        state.screens = [...state.screens, captured].slice(-SCREEN_LIMIT);
        await save(state);
        return { ok: true, screens: state.screens.length, last: nameOf(captured) };
      });
    }
    case "record": {
      const on = asked.on === true;
      await serial(async () => save({ ...(await load()), recording: on }));
      if (typeof asked.tabId === "number") {
        await ext.tabs.sendMessage(asked.tabId, { type: "recording", on }).catch(() => undefined);
      }
      return { ok: true, recording: on };
    }
    case "step": {
      // Only from a frame of a court the extension maps.
      const host = sender.tab?.url ? new URL(sender.tab.url).host : "";
      if (!asked.step || !courtSystemOf(host)) return { ok: false };
      const step = asked.step;
      return serial(async () => {
        const state = await load();
        if (!state.recording) return { ok: false };
        state.steps = [...state.steps, step].slice(-STEP_LIMIT);
        await save(state);
        return { ok: true };
      });
    }
    case "export": {
      const state = await load();
      const systems = [
        ...new Set(state.screens.flatMap((screen) => screen.frames.map((frame) => frame.system))),
      ].filter((system): system is CourtSystemKey => system !== null);
      return {
        ok: true,
        file: {
          kind: "one-mapa-de-telas",
          version: 1,
          exportedAt: new Date().toISOString(),
          systems: systems.map((system) => ({ key: system, name: COURT_SYSTEMS[system].name })),
          screens: state.screens,
          steps: state.steps,
        },
      };
    }
    case "clear": {
      await serial(async () => save(EMPTY));
      return { ok: true };
    }
    default:
      return { ok: false, code: "unknown" };
  }
}

ext.runtime.onMessage.addListener((message, sender, reply) => {
  handle((message ?? {}) as Asked, sender).then(reply, () => reply({ ok: false, code: "failed" }));
  // The answer comes after the work: the channel stays open for it.
  return true;
});
