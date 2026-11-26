/**
 * What ONE's extension does on a court's screen when it files (the owner's second way to file, 2026-11-20: ONE fills
 * and sends the batch the lawyer approved, in the lawyer's own session): it types a value, picks a line of a list,
 * ticks a box, presses a button or attaches a file, on the element a screen's map names (`selector` and its `index`
 * among the matches, as `capture.ts` wrote them), and leaves it as a person's hand would: the value set through the
 * element's own setter and the page told by the events typing fires. Never what a person could not do: no hidden or
 * disabled field written, no password typed, no dialog of the court answered.
 *
 * Pure over a `Document`, so it is tested in jsdom; the extension runs it in the frame of the court's page that holds
 * the element.
 */
import { redact } from "@/lib/court-extension/capture";

export type ActOp =
  | { op: "fill"; selector: string; index: number; value: string }
  | { op: "select"; selector: string; index: number; code?: string; text?: string }
  | { op: "check"; selector: string; index: number; on: boolean }
  | { op: "click"; selector: string; index: number }
  | { op: "upload"; selector: string; index: number; name: string; type: string; base64: string };

/** What is never typed by the extension, whatever a plan says: a person's credential lives there. */
const NOT_TYPED = ["hidden", "file", "checkbox", "radio", "submit", "button", "image", "reset", "password"];

/** The element a target names, or null: a selector the page cannot read is no element. */
export function targetIn(document: Document, selector: string, index: number): Element | null {
  try {
    return document.querySelectorAll(selector)[index] ?? null;
  } catch {
    return null;
  }
}

/** Words as a list compares them: lower case, no accents, one space. */
export const plainWords = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * The line of a list whose words are the fact's: the same words, else the only line that holds all of them. Null when
 * none or more than one: a wrong line is worse than none, and ONE then reads the screen again.
 */
export function lineByWords(options: readonly HTMLOptionElement[], text: string): HTMLOptionElement | null {
  const wanted = plainWords(text);
  if (!wanted) return null;
  const usable = options.filter((option) => !option.disabled && option.value !== "");
  const same = usable.filter((option) => plainWords(option.text) === wanted);
  if (same.length === 1) return same[0] ?? null;
  const words = wanted.split(" ").filter((word) => word.length > 1);
  const holding = usable.filter((option) => {
    const line = plainWords(option.text);
    return words.every((word) => line.includes(word));
  });
  return holding.length === 1 ? (holding[0] ?? null) : null;
}

/**
 * Brings the element into view before acting on it, as a person scrolls to a field before using it: the lawyer
 * watching the court's screen sees where ONE works, and a page that does something only for what is on screen does it.
 */
function bringIntoView(element: Element): void {
  element.scrollIntoView?.({ block: "center", inline: "nearest" });
}

function fill(element: Element, value: string): boolean {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  if (element.disabled || element.readOnly) return false;
  if (element instanceof HTMLInputElement && NOT_TYPED.includes(element.type)) return false;
  bringIntoView(element);
  element.focus();
  // Through the element's own setter, as typing sets it: a page that watches the property sees the change.
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.blur();
  return true;
}

function choose(element: Element, choice: { code?: string; text?: string }): boolean {
  if (!(element instanceof HTMLSelectElement) || element.disabled) return false;
  const options = Array.from(element.options);
  let line: HTMLOptionElement | null = null;
  if (typeof choice.code === "string") {
    // The code as the system has it, or as the map kept it (a long number in a code is kept masked).
    line =
      options.find((option) => option.value === choice.code) ??
      options.find((option) => redact(option.value).slice(0, 60) === choice.code) ??
      null;
  } else if (typeof choice.text === "string") {
    line = lineByWords(options, choice.text);
  }
  if (!line || line.disabled) return false;
  bringIntoView(element);
  // As a person's hand leaves it: the list taken, changed and left, so a page that reacts to any of these reacts (the
  // PJe reloads the next list when the change comes).
  element.focus();
  element.value = line.value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.blur();
  return element.value === line.value;
}

function tick(element: Element, on: boolean): boolean {
  if (!(element instanceof HTMLInputElement) || element.disabled) return false;
  if (element.type !== "checkbox" && element.type !== "radio") return false;
  bringIntoView(element);
  // A click, as a person's: the page's own handlers run, and a radio cannot be left unticked.
  if (element.checked !== on) element.click();
  return element.checked === on;
}

function press(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if ((element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true") return false;
  bringIntoView(element);
  element.click();
  return true;
}

/** The list of files a file field takes: the browser's own (`DataTransfer`), or what a test hands in its place. */
export type FileListOf = (file: File) => FileList | null;

const browserFileList: FileListOf = (file) => {
  if (typeof DataTransfer === "undefined") return null;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer.files;
};

/** The bytes a base64 text holds. */
export function bytesOf(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

function attach(element: Element, file: File, listOf: FileListOf): boolean {
  if (!(element instanceof HTMLInputElement) || element.type !== "file" || element.disabled) return false;
  const list = listOf(file);
  if (!list) return false;
  bringIntoView(element);
  element.files = list;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return (element.files?.length ?? 0) === 1;
}

/** Does one action on the screen of this frame. False when its element is not there or cannot take it. */
export function act(document: Document, op: ActOp, listOf: FileListOf = browserFileList): boolean {
  const element = targetIn(document, op.selector, op.index);
  if (!element) return false;
  switch (op.op) {
    case "fill":
      return fill(element, op.value);
    case "select":
      return choose(element, op);
    case "check":
      return tick(element, op.on);
    case "click":
      return press(element);
    case "upload": {
      const view = document.defaultView;
      const FileOf = view?.File ?? File;
      // The bytes go in as they came: a copy of them, so the file owns its buffer.
      const bytes = bytesOf(op.base64);
      const file = new FileOf([bytes.slice().buffer], op.name, { type: op.type });
      return attach(element, file, listOf);
    }
  }
}

/** The visible text of the frame, for the receipt's number and its words (read in the extension, never by the AI). */
export function frameText(document: Document): string {
  const body = document.body;
  if (!body) return "";
  const text = (body as HTMLElement).innerText ?? body.textContent ?? "";
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 50_000);
}

/**
 * How long the frame has been still: the time since its last change, watched from when the extension started on it.
 * A step is settled when every frame is complete and still for a moment.
 */
export function watchChanges(document: Document, now: () => number = Date.now): { stillFor(): number } {
  let last = now();
  const view = document.defaultView;
  const Observer = view?.MutationObserver ?? (typeof MutationObserver === "undefined" ? null : MutationObserver);
  if (Observer && document.documentElement) {
    new Observer(() => {
      last = now();
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  return { stillFor: () => now() - last };
}
