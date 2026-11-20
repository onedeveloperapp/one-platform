/**
 * What ONE's browser extension (`apps/web/extension/`) reads of a court system's screen while a lawyer works in it
 * logged in with their own login: the names of its fields, lists, buttons and tables, so ONE's filing in that system
 * can later be written against the real screen. Never what is written in them: no field's value, no option chosen
 * among people, no row of a table, no hidden field (they carry the session's tokens). The lawyer's login, code and
 * certificate never pass through here, and nothing leaves the lawyer's computer: the extension saves a file that the
 * lawyer sends (the owner's choice of 2026-11-18: the robot runs in the lawyer's own browser, on their own session).
 *
 * Pure over a `Document`, so it is tested in jsdom; the extension runs it in each frame of the court's page.
 */

/**
 * The court systems the extension knows, by the host they answer at. The eproc of TJSP joined on 2026-11-20, the
 * first one a lawyer of the pilot maps (its small-claims and civil courts file new lawsuits there: `court_systems`
 * of migration 0021).
 */
export type CourtSystemKey = "eproc-tjsp" | "projudi-tjgo" | "eproc-tjrj";

export const COURT_SYSTEMS: Record<CourtSystemKey, { host: string; name: string }> = {
  "eproc-tjsp": { host: "eproc1g.tjsp.jus.br", name: "eproc do TJSP" },
  "projudi-tjgo": { host: "projudi.tjgo.jus.br", name: "Projudi do TJGO" },
  "eproc-tjrj": { host: "eproc1g.tjrj.jus.br", name: "eproc do TJRJ" },
};

/** The systems the extension knows, as a sentence lists them ("o a, o b ou o c"; every name is masculine). */
export function courtSystemNames(): string {
  const names = Object.values(COURT_SYSTEMS).map((system) => `o ${system.name}`);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ou ${names[names.length - 1]}` : (names[0] ?? "");
}

/** The system a host is, or null for a page the extension does not map. */
export function courtSystemOf(host: string): CourtSystemKey | null {
  const clean = host.trim().toLowerCase();
  return (Object.keys(COURT_SYSTEMS) as CourtSystemKey[]).find((key) => COURT_SYSTEMS[key].host === clean) ?? null;
}

export type MappedField = {
  kind: "input" | "select" | "textarea" | "button" | "link";
  /** An input's type (text, checkbox, file...); null for the rest. */
  type: string | null;
  id: string | null;
  name: string | null;
  /** The words a person reads for it: its label, or the text beside it. */
  label: string | null;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  visible: boolean;
  /** A select's own list (codes and their names), except a list of people, which keeps only its size. */
  options: { value: string; text: string }[] | null;
  optionCount: number | null;
  /** How to find it again: a CSS selector and, when it matches several, which of them. */
  selector: string;
  index: number;
};

export type MappedTable = { selector: string; index: number; headers: string[]; rows: number };

export type MappedScreen = {
  system: CourtSystemKey | null;
  host: string;
  path: string;
  /** Only the parameters that name the screen (`acao`, `PaginaAtual`...): never a hash, a token or a number. */
  params: Record<string, string>;
  title: string;
  headings: string[];
  fields: MappedField[];
  tables: MappedTable[];
  capturedAt: string;
};

/** One thing the lawyer did while the path was recorded: never what they typed. */
export type MappedStep = {
  at: string;
  event: "page" | "click" | "change";
  path: string;
  params: Record<string, string>;
  kind: MappedField["kind"] | null;
  type: string | null;
  selector: string | null;
  index: number | null;
  label: string | null;
  /** A select's chosen code, when the list is the system's own (a class, a comarca), never a person. */
  option: string | null;
  /** A checkbox or radio as it was left. */
  checked: boolean | null;
};

type Place = { host: string; pathname: string; search: string };

const TEXT_LIMIT = 120;
const OPTION_LIMIT = 400;
const FIELD_LIMIT = 600;
const TABLE_LIMIT = 40;
const HEADING_LIMIT = 40;

/** A list of people (parties, lawyers, users): its names are not the system's own codes. */
const PEOPLE =
  /(parte|pessoa|advogad|usu[aá]rio|cliente|nome|autor|r[eé]u|procurador|representante|assessor|assistente|destinat|interessad|servidor|magistrad)/i;

/** The parameters of an address that name a screen. */
const SCREEN_PARAMS = /^(acao|acao_origem|acao_retorno|paginaatual|passoatual|passo|tipo|menu|aba|operacao)$/i;

/**
 * A text as the map keeps it: one line, at most 120 characters, with what could be a person's data taken out (an
 * e-mail, a run of ten digits or more: a CPF, a CNPJ, a lawsuit's number, a phone).
 */
export function redact(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]")
    .replace(/\d[\d.\-/ ]{8,}\d/g, (run) => (run.replace(/\D/g, "").length >= 10 ? "[número]" : run))
    .slice(0, TEXT_LIMIT);
}

/** The parameters of the address that name the screen, and nothing else. */
export function screenParams(search: string): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (SCREEN_PARAMS.test(key) && /^[\w.-]{1,60}$/.test(value) && !/\d{10,}/.test(value)) kept[key] = value;
  }
  return kept;
}

/** A path with any long number taken out (a lawsuit's number in the address). */
const cleanPath = (pathname: string): string => pathname.replace(/\d{10,}/g, "[número]").slice(0, 200);

const cssEscape = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`);

function isVisible(element: Element): boolean {
  if (element instanceof HTMLInputElement && element.type === "hidden") return false;
  const view = element.ownerDocument.defaultView;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node instanceof HTMLElement && node.hidden) return false;
    const style = view?.getComputedStyle(node);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }
  return true;
}

/** A CSS selector that finds the element again, with its position among the matches. */
export function locate(element: Element): { selector: string; index: number } {
  const document = element.ownerDocument;
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  if (id && /^[A-Za-z][\w:.-]{0,80}$/.test(id)) {
    const selector = `#${cssEscape(id)}`;
    if (document.querySelectorAll(selector).length === 1) return { selector, index: 0 };
  }
  const name = element.getAttribute("name");
  if (name && /^[\w:.[\]-]{1,80}$/.test(name)) {
    const selector = `${tag}[name="${name}"]`;
    const all = Array.from(document.querySelectorAll(selector));
    return { selector, index: Math.max(0, all.indexOf(element)) };
  }
  // A path from the nearest ancestor with an id, or from the body: tags and their places among their siblings.
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.body && parts.length < 8) {
    const parent: Element | null = node.parentElement;
    const nodeTag = node.tagName.toLowerCase();
    const anchorId = node !== element ? node.getAttribute("id") : null;
    if (anchorId && /^[A-Za-z][\w:.-]{0,80}$/.test(anchorId)) {
      parts.unshift(`#${cssEscape(anchorId)}`);
      break;
    }
    const current: Element = node;
    const sameTag = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [];
    parts.unshift(sameTag.length > 1 ? `${nodeTag}:nth-of-type(${sameTag.indexOf(current) + 1})` : nodeTag);
    node = parent;
  }
  const selector = parts.join(" > ") || tag;
  const all = Array.from(document.querySelectorAll(selector));
  return { selector, index: Math.max(0, all.indexOf(element)) };
}

/** The text of an element without the fields inside it (a label that wraps its own input). */
function ownText(element: Element): string {
  let text = "";
  element.childNodes.forEach((child) => {
    if (child.nodeType === 3) text += child.textContent ?? "";
    else if (child instanceof Element && !child.matches("input, select, textarea, button, script, style, option")) {
      text += ` ${ownText(child)}`;
    }
  });
  return text;
}

/** The words a person reads for a field: its label, its aria, or the short text just before it (a cell or a tag). */
function labelOf(element: Element): string | null {
  const document = element.ownerDocument;
  const pick = (text: string | null | undefined) => {
    const clean = redact(text);
    return clean && clean.length <= 100 ? clean : null;
  };
  const aria = pick(element.getAttribute("aria-label"));
  if (aria) return aria;
  const id = element.getAttribute("id");
  if (id) {
    const forLabel = document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
    const text = forLabel ? pick(ownText(forLabel)) : null;
    if (text) return text;
  }
  const wrapping = element.closest("label");
  if (wrapping) {
    const text = pick(ownText(wrapping));
    if (text) return text;
  }
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = pick(
      labelledBy
        .split(/\s+/)
        .map((part) => document.getElementById(part)?.textContent ?? "")
        .join(" "),
    );
    if (text) return text;
  }
  if (element.matches("button, input[type=submit], input[type=button], input[type=reset], a")) {
    const caption = pick(element instanceof HTMLInputElement ? element.value : ownText(element));
    if (caption) return caption;
  }
  // The text before it in the same box, then in the cell before its cell (the court's forms are often tables).
  let sibling = element.previousElementSibling;
  let steps = 0;
  while (sibling && steps < 3) {
    if (sibling.matches("input, select, textarea, button")) break;
    const text = pick(ownText(sibling));
    if (text) return text;
    sibling = sibling.previousElementSibling;
    steps += 1;
  }
  const cell = element.closest("td, th");
  const previousCell = cell?.previousElementSibling;
  if (previousCell) {
    const text = pick(ownText(previousCell));
    if (text) return text;
  }
  return pick(element.getAttribute("title")) ?? pick(element.getAttribute("placeholder"));
}

function kindOf(element: Element): MappedField["kind"] | null {
  if (element instanceof HTMLSelectElement) return "select";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLButtonElement || element.getAttribute("role") === "button") return "button";
  if (element instanceof HTMLInputElement) {
    return ["submit", "button", "reset", "image"].includes(element.type) ? "button" : "input";
  }
  if (element instanceof HTMLAnchorElement) return "link";
  return null;
}

/**
 * The words of an action a row of a table offers ("Incluir", "Remover", "Endereço"), never a person's name: what ONE's
 * robot may press inside a table (the eproc lists a party it found with "Incluir" in the row).
 */
const ROW_ACTION =
  /^(incluir|adicionar|remover|excluir|editar|alterar|selecionar|escolher|consultar|detalhar|endere[cç]o( e contato)?|contato|favorito|principal|definir)\b/i;

/**
 * A link worth mapping: a step of the system (a menu, "Incluir outros advogados"), never a document or a person. In a
 * table only for ONE's robot (`rows`), and only one whose words are an action.
 */
function isActionLink(element: Element, label: string | null, rows: boolean): boolean {
  if (!label || label.length > 60) return false;
  if (/\.(pdf|p7s|doc|docx|html?|jpe?g|png)\b/i.test(label) || /\[número\]|\[e-mail\]/.test(label)) return false;
  if (!element.closest("td, th")) return true;
  return rows && ROW_ACTION.test(label);
}

/**
 * A field as the map keeps it, or null for what is not mapped (a hidden field, a link that is not a step). `rows`: the
 * capture of ONE's robot, which also keeps the actions of a table's rows.
 */
export function mapField(element: Element, rows = false): MappedField | null {
  const kind = kindOf(element);
  if (!kind) return null;
  if (element instanceof HTMLInputElement && element.type === "hidden") return null;
  const label = labelOf(element);
  if (kind === "link" && !isActionLink(element, label, rows)) return null;
  const id = element.getAttribute("id");
  const name = element.getAttribute("name");
  const about = `${label ?? ""} ${id ?? ""} ${name ?? ""}`;
  let options: MappedField["options"] = null;
  let optionCount: number | null = null;
  if (element instanceof HTMLSelectElement) {
    optionCount = element.options.length;
    // "Tipo de Pessoa", "Tipo de Parte": the system's own kinds, not people.
    if (/^tipo\b/i.test(label ?? "") || !PEOPLE.test(about)) {
      options = Array.from(element.options)
        .slice(0, OPTION_LIMIT)
        .map((option) => ({ value: redact(option.value).slice(0, 60), text: redact(option.text) }));
    }
  }
  const { selector, index } = locate(element);
  return {
    kind,
    type: element instanceof HTMLInputElement ? element.type : null,
    id: id && /^[\w:.-]{1,80}$/.test(id) ? id : null,
    name: name && /^[\w:.[\]-]{1,80}$/.test(name) ? name : null,
    label,
    required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
    disabled: (element as HTMLInputElement).disabled === true,
    readOnly: (element as HTMLInputElement).readOnly === true,
    visible: isVisible(element),
    options,
    optionCount,
    selector,
    index,
  };
}

/**
 * The structure of the screen in this document (one frame): what the extension saves when the lawyer asks, and what
 * ONE's robot reads of a screen (`{ rows: true }`: with the actions of a table's rows, still never what is in them).
 */
export function captureScreen(
  document: Document,
  place: Place,
  now: Date,
  options: { rows?: boolean } = {},
): MappedScreen {
  const fields: MappedField[] = [];
  const seen = new Set<string>();
  for (const element of Array.from(
    document.querySelectorAll("input, select, textarea, button, a[href], [role=button]"),
  )) {
    if (fields.length >= FIELD_LIMIT) break;
    const field = mapField(element, options.rows === true);
    if (!field) continue;
    // A button repeated on every row of a table ("Incluir") is one button of the screen, found in any row.
    if (element.closest("tr")) {
      field.selector = field.selector.replace(/\btr:nth-of-type\(\d+\)/g, "tr");
      field.index = 0;
    }
    const key = `${field.kind}|${field.selector}|${field.label ?? ""}|${field.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push(field);
  }

  const headings: string[] = [];
  for (const element of Array.from(document.querySelectorAll("h1, h2, h3, h4, legend, caption, [role=heading]"))) {
    if (headings.length >= HEADING_LIMIT) break;
    const text = redact(element.textContent);
    if (text && isVisible(element) && !headings.includes(text)) headings.push(text);
  }

  // A table keeps its column names and how many rows it had: never what is in them.
  const tables: MappedTable[] = [];
  for (const table of Array.from(document.querySelectorAll("table"))) {
    if (tables.length >= TABLE_LIMIT) break;
    const headers = Array.from(table.querySelectorAll("th"))
      .map((cell) => redact(cell.textContent))
      .filter(Boolean)
      .slice(0, 30);
    if (headers.length === 0) continue;
    const { selector, index } = locate(table);
    tables.push({ selector, index, headers, rows: table.querySelectorAll("tbody tr").length });
  }

  return {
    system: courtSystemOf(place.host),
    host: place.host.toLowerCase(),
    path: cleanPath(place.pathname),
    params: screenParams(place.search),
    title: redact(document.title),
    headings,
    fields,
    tables,
    capturedAt: now.toISOString(),
  };
}

/** What a click or a change was, while the path is recorded: which field and how it was left, never what was typed. */
export function stepOf(event: Event, place: Place, now: Date): MappedStep | null {
  const target =
    event.target instanceof Element ? event.target.closest("input, select, textarea, button, a, [role=button]") : null;
  if (!target) return null;
  const field = mapField(target);
  if (!field) return null;
  const type = event.type === "click" ? "click" : event.type === "change" ? "change" : null;
  if (!type) return null;
  // A click on a text field says nothing; its change says it was filled, without what.
  if (
    type === "click" &&
    (field.kind === "textarea" ||
      field.kind === "select" ||
      (field.kind === "input" && !["checkbox", "radio", "file"].includes(field.type ?? "")))
  ) {
    return null;
  }
  let option: string | null = null;
  if (type === "change" && target instanceof HTMLSelectElement && field.options) {
    option = redact(target.value).slice(0, 60) || null;
  }
  const checked =
    target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio")
      ? target.checked
      : null;
  return {
    at: now.toISOString(),
    event: type,
    path: cleanPath(place.pathname),
    params: screenParams(place.search),
    kind: field.kind,
    type: field.type,
    selector: field.selector,
    index: field.index,
    label: field.label,
    option,
    checked,
  };
}

/** A page opened while the path is recorded. */
export function pageStep(place: Place, now: Date): MappedStep {
  return {
    at: now.toISOString(),
    event: "page",
    path: cleanPath(place.pathname),
    params: screenParams(place.search),
    kind: null,
    type: null,
    selector: null,
    index: null,
    label: null,
    option: null,
    checked: null,
  };
}
