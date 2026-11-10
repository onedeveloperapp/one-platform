/**
 * The pure rules of a firm's books (phase 4 of the plan of the controladoria and the finance): money as whole cents,
 * never a float; a bank statement in OFX read as the bank wrote it; the key that tells a statement's line apart; the
 * credits that are a client's money (a court's release, a judicial deposit), set apart by rule before any model; the
 * transfers between a firm's own accounts; and a firm's rule for a line. ONE records, reads, calculates and warns: it
 * never pays, charges or holds anybody's money, and nothing here moves any.
 */

/** A value written as a person or a bank writes it ("1.234,56", "-1234.56", "R$ 10,00") as whole cents, or null. */
export function parseCents(text: string): number | null {
  const raw = String(text ?? "")
    .replace(/R\$|\s| /g, "")
    .trim();
  if (!raw) return null;
  const negative = /^-|^\(.*\)$|-$/.test(raw);
  const body = raw.replace(/^[-+(]|[)-]$/g, "");
  if (!/^[0-9.,]+$/.test(body)) return null;
  // The last separator followed by one or two digits is the decimal one; every other separator groups thousands.
  const last = Math.max(body.lastIndexOf(","), body.lastIndexOf("."));
  let whole = body;
  let fraction = "";
  if (last >= 0 && /^[0-9]{1,2}$/.test(body.slice(last + 1))) {
    whole = body.slice(0, last);
    fraction = body.slice(last + 1);
  }
  // Thousands are grouped by three: "12,3" is no value, and never guessed into one.
  const groups = whole.split(/[.,]/);
  if (groups.length > 1 && (!/^[0-9]{1,3}$/.test(groups[0]) || groups.slice(1).some((group) => !/^[0-9]{3}$/.test(group)))) {
    return null;
  }
  whole = groups.join("");
  if (!/^[0-9]*$/.test(whole) || (whole === "" && fraction === "")) return null;
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Whole cents as a person reads them: "R$ 1.234,56", "-R$ 10,00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${whole},${String(abs % 100).padStart(2, "0")}`;
}

// ---------- OFX ----------

export type OfxLine = {
  /** The bank's own id of the line (FITID), when it gives one. */
  bankId: string | null;
  /** The day it was posted, as YYYY-MM-DD. */
  postedOn: string;
  /** Signed whole cents: a credit is positive, a debit negative. */
  cents: number;
  /** What the bank wrote of it (MEMO, else NAME), in one line. */
  memo: string;
};

export type OfxStatement = {
  kind: "bank" | "card";
  /** The account as the bank names it (its bank code and account number), for the person to tell it apart. */
  account: { bank: string | null; number: string | null };
  startsOn: string | null;
  endsOn: string | null;
  /** The balance the bank says the account had, and on which day. */
  balance: { cents: number; on: string } | null;
  lines: OfxLine[];
};

export type OfxRead = { ok: true; statement: OfxStatement } | { ok: false; code: "not_ofx" | "no_lines" };

/** An OFX day ("20261103", "20261103120000[-3:BRT]") as YYYY-MM-DD, or null. */
export function ofxDay(value: string | null | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1) return null;
  return `${year}-${month}-${day}`;
}

/** The value of a tag in an OFX block, closed (XML, OFX 2) or not (SGML, OFX 1): up to the next tag or line. */
function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
  if (!match) return null;
  const value = match[1].trim();
  return value === "" ? null : decodeEntities(value);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function blocks(text: string, name: string): string[] {
  const out: string[] = [];
  const opener = new RegExp(`<${name}>`, "gi");
  let found: RegExpExecArray | null;
  while ((found = opener.exec(text))) {
    const start = found.index + found[0].length;
    const close = text.toUpperCase().indexOf(`</${name.toUpperCase()}>`, start);
    const next = text.toUpperCase().indexOf(`<${name.toUpperCase()}>`, start);
    // SGML may leave a block unclosed: it then ends where the next one starts.
    const end = close >= 0 && (next < 0 || close < next) ? close : next >= 0 ? next : text.length;
    out.push(text.slice(start, end));
  }
  return out;
}

/**
 * Reads an OFX file as text (decoded by the browser before it gets here), bank or card. Every line with a day and a
 * value is kept, as the bank wrote it; a line without either is left out and never guessed.
 */
export function readOfx(text: string): OfxRead {
  const source = String(text ?? "");
  if (!/<OFX>/i.test(source) || !/<STMTTRN>/i.test(source)) {
    return /<OFX>/i.test(source) ? { ok: false, code: "no_lines" } : { ok: false, code: "not_ofx" };
  }
  const card = /<CCSTMTRS>/i.test(source);
  const from = blocks(source, card ? "CCACCTFROM" : "BANKACCTFROM")[0] ?? "";
  const list = blocks(source, "BANKTRANLIST")[0] ?? source;
  const lines: OfxLine[] = [];
  for (const block of blocks(list, "STMTTRN")) {
    const postedOn = ofxDay(tag(block, "DTPOSTED"));
    const cents = parseCents(tag(block, "TRNAMT") ?? "");
    if (!postedOn || cents === null || cents === 0) continue;
    const memo = [tag(block, "MEMO"), tag(block, "NAME")].filter(Boolean).join(" · ") || tag(block, "TRNTYPE") || "";
    lines.push({ bankId: tag(block, "FITID"), postedOn, cents, memo: memo.replace(/\s+/g, " ").slice(0, 300) });
  }
  if (lines.length === 0) return { ok: false, code: "no_lines" };
  const ledger = blocks(source, "LEDGERBAL")[0] ?? "";
  const balanceCents = parseCents(tag(ledger, "BALAMT") ?? "");
  const balanceOn = ofxDay(tag(ledger, "DTASOF"));
  return {
    ok: true,
    statement: {
      kind: card ? "card" : "bank",
      account: { bank: tag(from, "BANKID"), number: tag(from, "ACCTID") },
      startsOn: ofxDay(tag(list, "DTSTART")),
      endsOn: ofxDay(tag(list, "DTEND")),
      balance: balanceCents !== null && balanceOn ? { cents: balanceCents, on: balanceOn } : null,
      lines,
    },
  };
}

// ---------- A line's key, a client's money, a transfer ----------

/** A memo as the rules compare it: no accent, no case, single spaces. */
export function plainMemo(memo: string): string {
  return String(memo ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What tells a line of an account apart when the bank gives no id of its own, and what a line with another id but the
 * same day, value and memo is compared by (a possible repetition, kept and said, never dropped).
 */
export function lineKey(line: Pick<OfxLine, "postedOn" | "cents" | "memo">): string {
  return `${line.postedOn}|${line.cents}|${plainMemo(line.memo)}`;
}

/** A memo as words: what the rules of a client's money and a firm's rules read, punctuation taken out. */
export function memoWords(memo: string): string {
  return plainMemo(memo).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The words of a credit that is a client's money, never the firm's revenue: a court's release (alvará), a withdrawal of
 * a judicial deposit (levantamento), a judicial deposit, a payment order of the courts (RPV, precatório). The same list
 * is the setting `finance.client_money_words` the database reads (0126), and a test keeps the two together.
 */
export const CLIENT_MONEY_RULE = "dinheiro-de-cliente-v1";
export const CLIENT_MONEY_WORDS: readonly string[] = [
  "alvara",
  "levantamento",
  "deposito judicial",
  "dep judicial",
  "judicial",
  "requisicao de pequeno valor",
  "rpv",
  "precatorio",
];

/** A credit whose memo holds one of the words, whole: read by rule before any model, so it is never taken for revenue. */
export function isClientMoney(line: Pick<OfxLine, "cents" | "memo">, words: readonly string[] = CLIENT_MONEY_WORDS): boolean {
  if (line.cents <= 0) return false;
  const text = ` ${memoWords(line.memo)} `;
  return words.some((word) => text.includes(` ${memoWords(word)} `));
}

export type AccountLine = OfxLine & { id: string; accountId: string };

/**
 * The transfers between a firm's own accounts among its lines: a debit in one account and a credit of the same value
 * in another, at most `days` apart, each line in one pair only, the closest days first. What is left is no transfer.
 */
export function transferPairs(lines: readonly AccountLine[], days = 2): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const used = new Set<string>();
  const debits = lines.filter((line) => line.cents < 0).sort((a, b) => a.postedOn.localeCompare(b.postedOn));
  const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  for (const debit of debits) {
    if (used.has(debit.id)) continue;
    const candidates = lines
      .filter(
        (credit) =>
          credit.cents === -debit.cents &&
          credit.accountId !== debit.accountId &&
          !used.has(credit.id) &&
          Math.abs(dayOf(credit.postedOn) - dayOf(debit.postedOn)) <= days,
      )
      .sort(
        (a, b) =>
          Math.abs(dayOf(a.postedOn) - dayOf(debit.postedOn)) - Math.abs(dayOf(b.postedOn) - dayOf(debit.postedOn)),
      );
    const credit = candidates[0];
    if (credit) {
      used.add(debit.id);
      used.add(credit.id);
      out.push({ from: debit.id, to: credit.id });
    }
  }
  return out;
}

/** A firm's rule for its lines: the words a memo holds, and the way of the money. */
export type LineRule = { words: string; direction: "in" | "out" };

/** Whether a rule answers for a line: its words are in the memo, as the rules compare them, and the money goes its way. */
export function ruleAnswers(rule: LineRule, line: Pick<OfxLine, "cents" | "memo">): boolean {
  const words = memoWords(rule.words);
  if (words.length < 3) return false;
  if ((rule.direction === "in") !== line.cents > 0) return false;
  return ` ${memoWords(line.memo)} `.includes(` ${words} `);
}
