/**
 * Runs in each frame of the court's page (the hosts of `manifest.json`): it hands the background the structure of the
 * screen when the lawyer asks for it, and, while the path is being recorded, each click and change, never what was
 * typed (`@/lib/court-extension/capture`). It sends nothing anywhere but to this extension.
 */
import { chromeApi } from "./chrome";

import { captureScreen, type MappedStep, pageStep, stepOf } from "@/lib/court-extension/capture";

const ext = chromeApi();
const place = () => ({
  host: window.location.host,
  pathname: window.location.pathname,
  search: window.location.search,
});

// What the background reads of this frame when the lawyer maps the screen.
(globalThis as unknown as { __oneCapture?: () => unknown }).__oneCapture = () =>
  captureScreen(document, place(), new Date());

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
