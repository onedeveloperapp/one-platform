/**
 * What ONE's browser extension (`apps/web/extension/`) reads of a court system's screen while a lawyer works in it
 * logged in with their own login: the names of its fields, lists, buttons and tables, so ONE's filing in that system
 * can later be written against the real screen. Never what is written in them: no field's value, no option chosen
 * among people, no row of a table, no hidden field (they carry the session's tokens). The lawyer's login, code and
 * certificate never pass through here, and nothing leaves the lawyer's computer: the extension saves a file that the
 * lawyer sends (the owner's choice of 2026-11-18: the robot runs in the lawyer's own browser, on their own session).
 *
 * ONE's robot reads a little more of the screen it fills (`{ rows: true }`, 2026-11-26, after the PJe of TJRJ where it
 * chose the same line three times and could not see what its search found): the code chosen in each list of the
 * system's own, whether each box is ticked and each field filled (a yes or a no, never the words), and the lines of a
 * table of the system's own codes (`isCodeTable`: its subjects, its classes), never of a table of people, documents or
 * lawsuits.
 *
 * Pure over a `Document`, so it is tested in jsdom; the extension runs it in each frame of the court's page.
 */

/**
 * The court systems the extension knows, by the host they answer at. The eproc of TJSP joined on 2026-11-20, the
 * first one a lawyer of the pilot maps (its small-claims and civil courts file new lawsuits there: `court_systems`
 * of migration 0021). The PJe of TJRJ joined on 2026-11-25 (migration 0304), where the small-claims courts of the Capital
 * take new lawsuits until the eproc comes there: by the extension alone, since the lawyer signs with their certificate.
 */
export type CourtSystemKey = "eproc-tjsp" | "projudi-tjgo" | "eproc-tjrj" | "pje-tjrj";

export const COURT_SYSTEMS: Record<CourtSystemKey, { host: string; name: string }> = {
  "eproc-tjsp": { host: "eproc1g.tjsp.jus.br", name: "eproc do TJSP" },
  "projudi-tjgo": { host: "projudi.tjgo.jus.br", name: "Projudi do TJGO" },
  "eproc-tjrj": { host: "eproc1g.tjrj.jus.br", name: "eproc do TJRJ" },
  "pje-tjrj": { host: "tjrj.pje.jus.br", name: "PJe do TJRJ" },
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
  /**
   * What the screen holds now, for ONE's robot only (`{ rows: true }`), never what was written: the code of the line
   * chosen in a list of the system's own (null when none, never of a list of people), whether a box is ticked, and
   * whether a field holds something (a yes or a no, never its words). Without them ONE chose again, reading after
   * reading, a line the screen already held (the PJe of TJRJ, 2026-11-26).
   */
  chosen?: string | null;
  checked?: boolean;
  filled?: boolean;
};

/**
 * A line of a table of the system's own codes (its subjects, its classes), for ONE's robot only: the words of its cells
 * and the actions it offers ("Adicionar"), each found again by its own selector, so ONE presses the line of the subject
 * it searched and never the first one by chance. Never a line of a table of people, documents or lawsuits.
 */
export type MappedLine = { cells: string[]; actions: MappedField[] };

export type MappedTable = {
  selector: string;
  index: number;
  headers: string[];
  rows: number;
  /** Only for a table of the system's own codes (`isCodeTable`), only in the robot's reading. */
  lines?: MappedLine[];
};

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

/** A column of codes: "Cód.", "Código", "Cod". */
const CODE_COLUMN = /^c[oó]d(igo|\.)?(\s|$)/i;

/** A column of a person, a document, a lawsuit or a moment: its table is never read line by line. */
const NOT_CODES =
  /(nome|parte|pessoa|cpf|cnpj|\brg\b|advogad|autor|r[eé]u\b|polo|procurador|representante|usu[aá]rio|cliente|juiz|magistrad|servidor|destinat|interessad|e-?mail|telefone|celular|endere[cç]o|processo|documento|arquivo|anexo|data|hora|n[uú]mero)/i;

/**
 * Whether a table holds the system's own codes (its subjects, its classes), by its column names: one column of codes,
 * none of a person, a document, a lawsuit or a moment. Only such a table is read line by line, for ONE's robot.
 */
export function isCodeTable(headers: readonly string[]): boolean {
  return headers.some((header) => CODE_COLUMN.test(header.trim())) && !headers.some((header) => NOT_CODES.test(header));
}

const LINES_MOST = 60;
const CELLS_MOST = 8;
const LINE_ACTIONS_MOST = 4;

/** The words an action of a line shows: its own words, else its title or its picture's (an icon "Adicionar"). */
function lineActionLabel(element: Element): string | null {
  const pick = (text: string | null | undefined) => {
    const clean = redact(text);
    return clean && clean.length <= 60 ? clean : null;
  };
  const image = element.querySelector("img");
  return (
    pick(element.getAttribute("aria-label")) ??
    pick(element instanceof HTMLInputElement ? element.value : ownText(element)) ??
    pick(element.getAttribute("title")) ??
    pick(image?.getAttribute("alt")) ??
    pick(image?.getAttribute("title")) ??
    iconWords(element)
  );
}

/**
 * The words for an action that is only an icon, read from the icon's own names (the PJe adds a subject by an arrow
 * with no word, 2026-11-26): "ícone: seta para a esquerda". Never null for an action of a line, so the line keeps it.
 */
function iconWords(element: Element): string {
  const named = [element, ...Array.from(element.querySelectorAll("i, span, img, svg"))]
    .map((node) => `${node.getAttribute("class") ?? ""} ${node.getAttribute("src") ?? ""}`)
    .join(" ")
    .toLowerCase();
  const KNOWN: [RegExp, string][] = [
    [/arrow-left|seta.?esq|chevron-left|angle-left|left/, "seta para a esquerda"],
    [/arrow-right|seta.?dir|chevron-right|angle-right|right/, "seta para a direita"],
    [/plus|add|adicionar|incluir|mais/, "mais"],
    [/trash|lixeira|excluir|remove|delete|minus/, "lixeira"],
    [/pencil|edit|editar|lapis/, "lápis"],
    [/check|ok|confirm/, "marca de confirmar"],
  ];
  const found = KNOWN.find(([pattern]) => pattern.test(named));
  return found ? `ícone: ${found[1]}` : "ícone sem nome";
}

/** The lines of a table of the system's codes: each cell's words and the actions each line offers. */
function linesOf(table: HTMLTableElement): MappedLine[] {
  const lines: MappedLine[] = [];
  for (const row of Array.from(table.querySelectorAll("tr"))) {
    if (lines.length >= LINES_MOST) break;
    // A line of this table, never of a table inside it.
    if (row.closest("table") !== table) continue;
    const cells = Array.from(row.children).filter((cell) => cell.tagName === "TD");
    if (cells.length === 0) continue;
    const actions: MappedField[] = [];
    for (const element of Array.from(
      row.querySelectorAll(
        "a[href], a[onclick], button, input[type=button], input[type=submit], input[type=image], [role=button]",
      ),
    )) {
      if (actions.length >= LINE_ACTIONS_MOST) break;
      const label = lineActionLabel(element);
      if (!label || /\.(pdf|p7s|docx?|html?|jpe?g|png)\b/i.test(label) || /\[número\]|\[e-mail\]/.test(label)) continue;
      const { selector, index } = locate(element);
      actions.push({
        kind: element instanceof HTMLAnchorElement ? "link" : "button",
        type: element instanceof HTMLInputElement ? element.type : null,
        id: null,
        name: null,
        label,
        required: false,
        disabled: (element as HTMLButtonElement).disabled === true,
        readOnly: false,
        visible: isVisible(element),
        options: null,
        optionCount: null,
        selector,
        index,
      });
    }
    // Every cell in its place, an empty one too: the cells line up with the column names.
    lines.push({ cells: cells.slice(0, CELLS_MOST).map((cell) => redact(ownText(cell))), actions });
  }
  return lines;
}

/**
 * A field as the map keeps it, or null for what is not mapped (a hidden field, a link that is not a step). `rows`: the
 * capture of ONE's robot, which also keeps the actions of a table's rows and what each field holds now (the code
 * chosen in a list of the system's own, a box ticked, a field filled or not), never what a person wrote.
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
    ...(rows ? holding(element, options !== null) : {}),
  };
}

/**
 * What a field holds now, as ONE's robot reads it: the code chosen in a list of the system's own (as its options are
 * kept), a box ticked or not, a field filled or not. Never a value a person wrote, nor the line chosen among people.
 */
function holding(element: Element, systemList: boolean): Pick<MappedField, "chosen" | "checked" | "filled"> {
  if (element instanceof HTMLSelectElement) {
    if (!systemList) return {};
    const line = element.selectedIndex >= 0 ? element.options[element.selectedIndex] : null;
    return { chosen: line ? redact(line.value).slice(0, 60) : null };
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") return { checked: element.checked };
    if (element.type === "file") return { filled: (element.files?.length ?? 0) > 0 };
    if (["hidden", "password", "submit", "button", "image", "reset"].includes(element.type)) return {};
    return { filled: element.value.trim() !== "" };
  }
  if (element instanceof HTMLTextAreaElement) return { filled: element.value.trim() !== "" };
  return {};
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

  // A table keeps its column names and how many rows it had: never what is in them, but, for ONE's robot, the lines of
  // a table of the system's own codes (the subjects a search found), each with the actions it offers.
  const tables: MappedTable[] = [];
  for (const table of Array.from(document.querySelectorAll("table"))) {
    if (tables.length >= TABLE_LIMIT) break;
    const headers = Array.from(table.querySelectorAll("th"))
      .map((cell) => redact(cell.textContent))
      .filter(Boolean)
      .slice(0, 30);
    if (headers.length === 0) continue;
    const { selector, index } = locate(table);
    const lines = options.rows === true && isCodeTable(headers) ? linesOf(table) : null;
    tables.push({
      selector,
      index,
      headers,
      rows: table.querySelectorAll("tbody tr").length,
      ...(lines ? { lines } : {}),
    });
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
