/**
 * What ONE's own browser reads of a court's sign-in, in the page (the owner's first way to file, 2026-11-20: ONE's
 * browser with the lawyer's court login): the form of a login and a password, the field of the court's code (one
 * field, or one box per digit), a captcha, and whether the court's words refuse the login or say the account is
 * blocked. The fields found are marked (`data-one-sign-in`) so the browser types into them; a value typed in the
 * page is never read, and nothing is typed here.
 *
 * A captcha is never answered: where the court asks one, ONE says so and the lawyer files another way. A password
 * field alone (a court asking a password to sign) is no sign-in. Pure over a `Document`, so it is tested in jsdom.
 */
import { SIGN_IN_MARK } from "@/lib/court-browser/marks";
import { plainWords } from "@/lib/court-extension/act";

export type SignInState =
  /** A login and a password to type. */
  | { kind: "form" }
  /** The court asks its code: in one field (`boxes` 0) or one box per digit. `refused` when it said the last was wrong. */
  | { kind: "code"; boxes: number; refused: boolean }
  | { kind: "captcha" }
  /** The court said the login or the password is wrong. */
  | { kind: "refused" }
  /** The court said the account is blocked. */
  | { kind: "blocked" }
  /** No sign-in on the screen: the session is open. */
  | { kind: "in" };

const TEXTUAL = new Set(["text", "email", "tel", "number", "search"]);
/** The controls whose value is their label, never something a person typed. */
const LABELLED_BY_VALUE = new Set(["submit", "button", "reset", "image"]);
const SUBMIT_WORDS =
  /\b(entrar|acessar|login|logar|continuar|confirmar|validar|enviar|verificar|prosseguir|avancar|ok)\b/;
/** What names the field of a login: a user, a CPF, an e-mail. */
const LOGIN_HINT = /(user|usuario|login|cpf|cnpj|e-?mail|matricula|identifica)/i;
/** A sign-in says so: its button enters, or the form is named for it. A court's form that signs or sends never does. */
const LOGIN_PRESS = /\b(entrar|acessar|login|logar|logon|sign in)\b/;
const LOGIN_FORM = /(login|logon|signin|sign-in|autentica|authenticate)/i;
const NOT_SUBMIT =
  /\b(limpar|cancelar|voltar|certificado|esqueci|esqueceu|recuperar|cadastr\w*|microsoft|gov\.?br|pesquisar|buscar)\b/;
/** A field of the court's code, by its name: never a field that only says "code" (a court's form has many). */
const CODE_NAME = /(otp|totp|2fa|mfa|token|autentic)/i;
const CODE_WORDS =
  /(codigo de (verificacao|autenticacao|acesso|seguranca|confirmacao)|token|autenticador|dois fatores|duplo fator|segundo fator)/;
const REFUSED =
  /(invalid|incorret|nao confere|errad|nao encontrad|nao reconhecid|nao cadastrad|credenciais|falha na autenticacao)/;
const BLOCKED = /(bloquead|desativad|desabilitad|suspens|inativ)/;
const MESSAGES = [
  "[role=alert]",
  "[aria-live]",
  ".alert",
  ".error",
  ".erro",
  ".mensagem",
  ".message",
  ".feedback",
  ".invalid-feedback",
  ".text-danger",
  ".kc-feedback-text",
  "#input-error",
  "[id*=error]",
  "[id*=erro]",
  "[class*=error]",
  "[class*=erro]",
].join(",");

/** Whether a person sees the element: no hidden input, no element hidden by itself or by a parent. */
function visible(element: Element): boolean {
  const node = element as HTMLElement;
  if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
  if (node.tagName === "INPUT") {
    const input = node as HTMLInputElement;
    if (input.type === "hidden" || input.disabled) return false;
  }
  const check = (node as unknown as { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  if (typeof check === "function") return check.call(node, { checkOpacity: true, checkVisibilityCSS: true });
  // Without a layout (jsdom): the element and its parents, by their styles.
  for (let at: Element | null = node; at; at = at.parentElement) {
    if ((at as HTMLElement).hidden) return false;
    const style = at.ownerDocument.defaultView?.getComputedStyle(at);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }
  return true;
}

const inputs = (scope: ParentNode): HTMLInputElement[] => Array.from(scope.querySelectorAll("input"));

const typable = (input: HTMLInputElement): boolean =>
  TEXTUAL.has(input.type) && !input.readOnly && !input.disabled && visible(input);

/** What a person reads of an element: its text, label, title and hint, as words; never a value they typed. */
function wordsOf(element: Element): string {
  const control = element as HTMLInputElement;
  const labels = control.labels ? Array.from(control.labels, (label) => label.textContent ?? "") : [];
  const label = element.tagName === "INPUT" && LABELLED_BY_VALUE.has(control.type) ? control.value : "";
  return plainWords(
    [
      element.textContent ?? "",
      label,
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("title") ?? "",
      element.getAttribute("placeholder") ?? "",
      ...labels,
    ].join(" "),
  );
}

/** The court's words on the screen now: its messages, never the fields' values. */
function messageWords(document: Document): string {
  return plainWords(
    Array.from(document.querySelectorAll(MESSAGES))
      .filter(visible)
      .map((element) => element.textContent ?? "")
      .join(" "),
  );
}

/** The field of the login: the last typable field before the password, in its form, that names a login. */
function loginFieldFor(password: HTMLInputElement): HTMLInputElement | null {
  const scope = password.form ?? password.ownerDocument;
  let found: HTMLInputElement | null = null;
  for (const input of inputs(scope)) {
    if (input === password) break;
    if (typable(input) && LOGIN_HINT.test(`${input.name} ${input.id} ${input.autocomplete} ${wordsOf(input)}`)) {
      found = input;
    }
  }
  return found;
}

/** Whether a password's form is a sign-in: its button enters, or the form is named for it. */
function isSignIn(password: HTMLInputElement, submit: HTMLElement | null): boolean {
  const form = password.form;
  const named = form ? `${form.id} ${form.getAttribute("name") ?? ""} ${form.getAttribute("action") ?? ""}` : "";
  return (submit !== null && LOGIN_PRESS.test(wordsOf(submit))) || LOGIN_FORM.test(named);
}

const CONTROLS = "button, input[type=submit], input[type=button], input[type=image]";

/** Where a field's button is: its form, else the nearest block around it that holds a button. */
function scopeOf(field: HTMLInputElement): ParentNode {
  if (field.form) return field.form;
  for (let at = field.parentElement; at; at = at.parentElement) {
    if (at.querySelector(CONTROLS)) return at;
  }
  return field.ownerDocument;
}

/** The button that sends a field: a submit, else the one whose words say so; never "clear" or "certificate". */
function submitFor(field: HTMLInputElement): HTMLElement | null {
  const usable = Array.from(scopeOf(field).querySelectorAll<HTMLElement>(CONTROLS)).filter(
    (control) => visible(control) && !(control as HTMLButtonElement).disabled && !NOT_SUBMIT.test(wordsOf(control)),
  );
  const submits = usable.filter((control) => (control as HTMLButtonElement).type === "submit");
  return (
    submits.find((control) => control.tagName === "INPUT") ??
    submits[0] ??
    usable.find((control) => SUBMIT_WORDS.test(wordsOf(control))) ??
    null
  );
}

/** The fields of the court's code: one box per digit (four to eight), else the one field that names such a code. */
function codeFields(document: Document): HTMLInputElement[] {
  const usable = inputs(document).filter(typable);
  const boxes = usable.filter((input) => input.maxLength === 1);
  if (boxes.length >= 4 && boxes.length <= 8) return boxes;
  const one = usable.find(
    (input) =>
      input.autocomplete === "one-time-code" ||
      CODE_NAME.test(`${input.name} ${input.id}`) ||
      CODE_WORDS.test(wordsOf(input)),
  );
  return one ? [one] : [];
}

function captchaIn(scope: ParentNode): boolean {
  const frames = Array.from(scope.querySelectorAll("iframe")).some(
    (frame) =>
      visible(frame) &&
      (/recaptcha|hcaptcha|turnstile|captcha/i.test(frame.getAttribute("src") ?? "") ||
        /captcha/i.test(frame.getAttribute("title") ?? "")),
  );
  const widgets = Array.from(
    scope.querySelectorAll(".g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], img[src*=captcha i]"),
  ).some(visible);
  return frames || widgets;
}

function mark(element: Element | null | undefined, name: string): void {
  element?.setAttribute(SIGN_IN_MARK, name);
}

/**
 * Where the court's sign-in stands on this screen. With `marking`, the fields to type into are marked: `login`,
 * `password` and `submit`, or `code` (or `code-0`, `code-1`... one per box) and `code-submit`. The court's code is
 * read first: a court may open it over the form of the login, which stays behind it.
 */
export function signInState(document: Document, marking = false): SignInState {
  if (marking) {
    for (const marked of Array.from(document.querySelectorAll(`[${SIGN_IN_MARK}]`))) {
      marked.removeAttribute(SIGN_IN_MARK);
    }
  }
  const words = messageWords(document);
  const codes = codeFields(document);
  const first = codes[0];
  if (first) {
    if (captchaIn(first.form ?? document)) return { kind: "captcha" };
    if (marking) {
      if (codes.length === 1) mark(first, "code");
      else codes.forEach((box, index) => mark(box, `code-${index}`));
      mark(submitFor(first), "code-submit");
    }
    return { kind: "code", boxes: codes.length > 1 ? codes.length : 0, refused: REFUSED.test(words) };
  }
  const password = inputs(document).find((input) => input.type === "password" && visible(input) && !input.disabled);
  const login = password ? loginFieldFor(password) : null;
  const submit = password ? submitFor(password) : null;
  if (password && login && isSignIn(password, submit)) {
    if (captchaIn(password.form ?? document)) return { kind: "captcha" };
    if (BLOCKED.test(words)) return { kind: "blocked" };
    if (REFUSED.test(words)) return { kind: "refused" };
    if (marking) {
      mark(login, "login");
      mark(password, "password");
      mark(submit, "submit");
    }
    return { kind: "form" };
  }
  return { kind: "in" };
}

/**
 * The court's domain a system's host belongs to (`eproc1g.tjsp.jus.br` → `tjsp.jus.br`): ONE's browser types the
 * lawyer's login only on a page of it, over HTTPS (the eproc of TJSP signs in at `sso.tjsp.jus.br`).
 */
export function courtDomainOf(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  return labels.slice(labels[labels.length - 2] === "jus" ? -3 : -2).join(".");
}

/** Whether a page's address is the court's own, over HTTPS. */
export function onCourtDomain(address: string, domain: string): boolean {
  try {
    const url = new URL(address);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
