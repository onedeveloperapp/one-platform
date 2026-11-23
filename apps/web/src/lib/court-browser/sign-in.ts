import type { Page } from "playwright-core";

import { SIGN_IN_MARK } from "@/lib/court-browser/marks";
import { onCourtDomain, type SignInState } from "@/lib/court-browser/sign-in-page";

/**
 * ONE's own browser signs in at a court with the lawyer's login (the owner's first way to file, 2026-11-20): it types
 * the login and the password into the court's own form, on a page of the court's domain over HTTPS and nowhere else,
 * and, where the court asks its code, types the code the lawyer gave in ONE at that moment (`code`), at most three
 * times. A check of a login given (`code` absent) stops where the court asks the code: the court took the login and
 * the password. A captcha is never answered, and a refusal is never tried again (a wrong password tried again may
 * block the lawyer's account). Nothing it typed or read is kept.
 */

export type SignInOutcome =
  | { kind: "in" }
  /** The court took the login and the password and asks its code (a check stops here). */
  | { kind: "asks_code" }
  | { kind: "refused" }
  | { kind: "blocked" }
  | { kind: "captcha" }
  /** The court refused every code the lawyer gave. */
  | { kind: "code_refused" }
  /** No code came: the lawyer did not give one in time, or the batch stopped. */
  | { kind: "no_code"; why: string }
  | { kind: "failed"; why: string };

export type CodeAnswer = { code: string } | { none: string };

export type SignInInput = {
  login: string;
  senha: string;
  /** The court's domain (`tjsp.jus.br`): nothing is typed on a page of another. */
  courtDomain: string;
  /** Asks the lawyer the court's code through ONE (`again` after the court refused one). Absent: a check. */
  code?: (again: boolean) => Promise<CodeAnswer>;
  /** Waits until the page stops changing after a press. */
  settle(): Promise<void>;
};

const CODE_TRIES = 3;
const TYPE_MS = 10_000;

async function stateOf(page: Page, marking: boolean): Promise<SignInState | null> {
  try {
    const state = await page
      .mainFrame()
      .evaluate(
        (mark) =>
          (globalThis as unknown as { __oneSignIn?: (marking?: boolean) => unknown }).__oneSignIn?.(mark) ?? null,
        marking,
      );
    return (state as SignInState | null) ?? null;
  } catch {
    return null;
  }
}

const marked = (page: Page, name: string) => page.mainFrame().locator(`[${SIGN_IN_MARK}="${name}"]`).first();

/** Presses the form's button, else Enter in its last field, and waits for the court's answer. */
async function send(page: Page, button: string, lastField: string, input: SignInInput): Promise<void> {
  const control = marked(page, button);
  if ((await control.count()) > 0) await control.click({ timeout: TYPE_MS });
  else await marked(page, lastField).press("Enter", { timeout: TYPE_MS });
  await input.settle();
}

export async function signIn(page: Page, input: SignInInput): Promise<SignInOutcome> {
  let state = await stateOf(page, true);
  if (!state) return { kind: "failed", why: "unreadable" };
  if (state.kind === "in") return { kind: "in" };
  if (state.kind === "captcha") return { kind: "captcha" };

  if (state.kind !== "code") {
    if (state.kind !== "form") return { kind: "failed", why: "unexpected_sign_in" };
    if (!onCourtDomain(page.url(), input.courtDomain)) return { kind: "failed", why: "foreign_host" };
    try {
      await marked(page, "login").fill(input.login, { timeout: TYPE_MS });
      await marked(page, "password").fill(input.senha, { timeout: TYPE_MS });
      await send(page, "submit", "password", input);
    } catch {
      return { kind: "failed", why: "not_typed" };
    }
    state = await stateOf(page, true);
    if (!state) return { kind: "failed", why: "unreadable" };
    if (state.kind === "in") return { kind: "in" };
    if (state.kind === "refused" || state.kind === "blocked" || state.kind === "captcha") return { kind: state.kind };
    if (state.kind === "form") return { kind: "failed", why: "still_form" };
  }

  // The court asks its code.
  if (!input.code) return { kind: "asks_code" };
  for (let tries = 0; tries < CODE_TRIES; tries += 1) {
    const given = await input.code(tries > 0);
    if ("none" in given) return { kind: "no_code", why: given.none };
    const now = await stateOf(page, true);
    if (!now) return { kind: "failed", why: "unreadable" };
    if (now.kind === "in") return { kind: "in" };
    if (now.kind !== "code") return { kind: "failed", why: "code_gone" };
    if (!onCourtDomain(page.url(), input.courtDomain)) return { kind: "failed", why: "foreign_host" };
    try {
      if (now.boxes > 0) {
        for (let index = 0; index < now.boxes; index += 1) {
          await marked(page, `code-${index}`).fill(given.code[index] ?? "", { timeout: TYPE_MS });
        }
        await send(page, "code-submit", `code-${now.boxes - 1}`, input);
      } else {
        await marked(page, "code").fill(given.code, { timeout: TYPE_MS });
        await send(page, "code-submit", "code", input);
      }
    } catch {
      return { kind: "failed", why: "not_typed" };
    }
    const after = await stateOf(page, false);
    if (!after) return { kind: "failed", why: "unreadable" };
    if (after.kind === "in") return { kind: "in" };
    if (after.kind === "code") continue;
    if (after.kind === "form") return { kind: "failed", why: "back_to_form" };
    return { kind: after.kind };
  }
  return { kind: "code_refused" };
}
