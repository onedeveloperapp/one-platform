/**
 * Runs in each frame of every page ONE's own browser opens (added to its context before the page's own scripts, as
 * `pagina.js` beside `navegador.mjs`, `clock/build.mjs`): the same reading of a court's screen and the same actions as
 * the lawyer's extension (`@/lib/court-extension/capture` and `act`), the frame's text for the receipt, how long the
 * frame has been still, where the court's sign-in stands (`sign-in-page.ts`), and a mark on the one element a file is
 * attached to. It sends nothing anywhere: ONE's browser calls these functions and reads their answers.
 */
import { TARGET_MARK } from "@/lib/court-browser/marks";
import { signInState } from "@/lib/court-browser/sign-in-page";
import { act, type ActOp, frameText, targetIn, watchChanges } from "@/lib/court-extension/act";
import { captureScreen } from "@/lib/court-extension/capture";

const place = () => ({
  host: window.location.host,
  pathname: window.location.pathname,
  search: window.location.search,
});

// The frame is watched once its document exists: the script may run before it has an element.
let watched: { stillFor(): number } | null = document.documentElement ? watchChanges(document) : null;
document.addEventListener("DOMContentLoaded", () => {
  watched ??= watchChanges(document);
});

const exposed = globalThis as unknown as {
  __oneCapture?: (rows?: boolean) => unknown;
  __oneAct?: (op: ActOp) => boolean;
  __oneText?: () => string;
  __oneStill?: () => { ready: string; still: number };
  __oneSignIn?: (marking?: boolean) => unknown;
  __oneMark?: (selector: string, index: number, mark: string) => boolean;
};
exposed.__oneCapture = (rows?: boolean) => captureScreen(document, place(), new Date(), { rows: rows === true });
exposed.__oneAct = (op: ActOp) => act(document, op);
exposed.__oneText = () => frameText(document);
exposed.__oneStill = () => ({ ready: document.readyState, still: watched?.stillFor() ?? 0 });
exposed.__oneSignIn = (marking?: boolean) => signInState(document, marking === true);
exposed.__oneMark = (selector: string, index: number, mark: string) => {
  const element = targetIn(document, selector, index);
  if (!element) return false;
  element.setAttribute(TARGET_MARK, mark);
  return true;
};
