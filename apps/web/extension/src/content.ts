/**
 * Runs in each frame of the court's page (the hosts of `manifest.json`). For the lawyer's diagnosis of a screen
 * (version 0.1, `Mapear esta tela`): the structure of the screen when they ask for it, and, while the path is being
 * recorded, each click and change, never what was typed (`@/lib/court-extension/capture`). For a filing (version 0.2):
 * the same structure for ONE's robot, an action on one element of this frame (`@/lib/court-extension/act`), the frame's
 * text for the receipt, and how long the frame has been still. It sends nothing anywhere but to this extension.
 */
import { chromeApi } from "./chrome";

import { act, type ActOp, frameText, watchChanges } from "@/lib/court-extension/act";
import { captureScreen, type MappedStep, pageStep, stepOf } from "@/lib/court-extension/capture";

const ext = chromeApi();
const place = () => ({
  host: window.location.host,
  pathname: window.location.pathname,
  search: window.location.search,
});

const watched = watchChanges(document);

// What the extension reads and does in this frame, called by the panel through `chrome.scripting`.
const exposed = globalThis as unknown as {
  __oneCapture?: (rows?: boolean) => unknown;
  __oneAct?: (op: ActOp) => boolean;
  __oneText?: () => string;
  __oneStill?: () => { ready: string; still: number };
};
exposed.__oneCapture = (rows?: boolean) => captureScreen(document, place(), new Date(), { rows: rows === true });
exposed.__oneAct = (op: ActOp) => act(document, op);
exposed.__oneText = () => frameText(document);
exposed.__oneStill = () => ({ ready: document.readyState, still: watched.stillFor() });

let recording = false;

const send = (step: MappedStep) => {
  ext.runtime.sendMessage({ type: "step", step }).catch(() => undefined);
};

const onEvent = (event: Event) => {
  if (!recording) return;
  const step = stepOf(event, place(), new Date());
  if (step) send(step);
};

document.addEventListener("click", onEvent, true);
document.addEventListener("change", onEvent, true);

ext.runtime.onMessage.addListener((message) => {
  const asked = message as { type?: string; on?: boolean } | null;
  if (asked?.type === "recording") recording = asked.on === true;
});

// Whether the path is being recorded, asked as the page opens: a page opened while it is, is a step of the path.
ext.runtime
  .sendMessage({ type: "status" })
  .then((answer) => {
    recording = (answer as { recording?: boolean } | null)?.recording === true;
    if (recording) send(pageStep(place(), new Date()));
  })
  .catch(() => undefined);
