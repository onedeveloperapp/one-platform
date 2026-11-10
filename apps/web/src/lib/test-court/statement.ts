/**
 * The test statement (migration 0138): what a bank would show of the firm's test cases, written as an OFX statement the
 * books import (phase 4): each release of a test lawsuit as the court's money in (its memo has the words the books
 * read as a client's money), each client's part as the firm's Pix out with the client's name and CPF, each bill open
 * as paid or received on its day, and the month's bank fee. Every line has an id of its own, so importing the same
 * statement again adds nothing. Pure.
 */

export type TestStatementData = {
  firm: string;
  releases: { id: string; cents: number; on: string; cnj: string; court: string }[];
  transfers: {
    id: string;
    cents: number;
    on: string | null;
    status: string;
    name: string | null;
    cpf: string | null;
  }[];
  bills: { id: string; direction: "pay" | "receive"; cents: number; due_on: string; counterparty: string | null }[];
};

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    : [];
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const whole = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function readTestStatement(raw: unknown): TestStatementData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  return {
    firm: text(value.firm) ?? "",
    releases: list(value.releases).flatMap((row) => {
      const id = text(row.id);
      const on = text(row.on);
      return id && on && DAY.test(on) && whole(row.cents) > 0
        ? [{ id, cents: whole(row.cents), on, cnj: text(row.cnj) ?? "", court: text(row.court) ?? "" }]
        : [];
    }),
    transfers: list(value.transfers).flatMap((row) => {
      const id = text(row.id);
      return id && whole(row.cents) > 0
        ? [
            {
              id,
              cents: whole(row.cents),
              on: text(row.on),
              status: text(row.status) ?? "owed",
              name: text(row.name),
              cpf: text(row.cpf),
            },
          ]
        : [];
    }),
    bills: list(value.bills).flatMap((row) => {
      const id = text(row.id);
      const due = text(row.due_on);
      const direction = row.direction === "receive" ? "receive" : row.direction === "pay" ? "pay" : null;
      return id && due && DAY.test(due) && direction && whole(row.cents) > 0
        ? [{ id, direction, cents: whole(row.cents), due_on: due, counterparty: text(row.counterparty) }]
        : [];
    }),
  };
}

export type StatementLine = { id: string; on: string; cents: number; memo: string };

/** A memo as a bank writes it: capitals, no accent, no mark the format reserves. */
const memoOf = (words: string): string =>
  words
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[<>&]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 120);

const short = (id: string): string => id.replace(/-/g, "").slice(0, 12).toUpperCase();
const cpfMasked = (cpf: string | null): string => (cpf && /^\d{11}$/.test(cpf) ? `***${cpf.slice(3, 9)}**` : "");

/** The lines of the statement, by day; what has no day of its own falls on `today`. */
export function statementLines(data: TestStatementData, today: string): StatementLine[] {
  const lines: StatementLine[] = [];
  for (const release of data.releases) {
    lines.push({
      id: `ALV${short(release.id)}`,
      on: release.on > today ? today : release.on,
      cents: release.cents,
      memo: memoOf(`TED ALVARA JUDICIAL ${release.court} PROC ${release.cnj}`),
    });
  }
  for (const transfer of data.transfers) {
    lines.push({
      id: `PIX${short(transfer.id)}`,
      on: transfer.on && transfer.on <= today ? transfer.on : today,
      cents: -transfer.cents,
      memo: memoOf(`PIX ENVIADO ${transfer.name ?? "CLIENTE"} ${cpfMasked(transfer.cpf)}`),
    });
  }
  for (const bill of data.bills) {
    const on = bill.due_on > today ? today : bill.due_on;
    lines.push(
      bill.direction === "pay"
        ? { id: `BOL${short(bill.id)}`, on, cents: -bill.cents, memo: memoOf(`PAG BOLETO ${bill.counterparty ?? ""}`) }
        : {
            id: `REC${short(bill.id)}`,
            on,
            cents: bill.cents,
            memo: memoOf(`PIX RECEBIDO ${bill.counterparty ?? ""}`),
          },
    );
  }
  const month = today.slice(0, 7);
  lines.push({ id: `TAR${month.replace("-", "")}`, on: today, cents: -2990, memo: "TARIFA PACOTE DE SERVICOS" });
  return lines.sort((a, b) => a.on.localeCompare(b.on) || a.id.localeCompare(b.id));
}

const ofxDay = (day: string): string => `${day.replace(/-/g, "")}120000[-3:BRT]`;
const amount = (cents: number): string =>
  `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/** The OFX of the statement, from the first line's day to today, its balance the sum of its lines. */
export function writeTestStatement(data: TestStatementData, today: string): string {
  const lines = statementLines(data, today);
  const start = lines[0]?.on ?? today;
  const balance = lines.reduce((acc, line) => acc + line.cents, 0);
  const body = lines
    .map((line) =>
      [
        "<STMTTRN>",
        `<TRNTYPE>${line.cents < 0 ? "DEBIT" : "CREDIT"}`,
        `<DTPOSTED>${ofxDay(line.on)}`,
        `<TRNAMT>${amount(line.cents)}`,
        `<FITID>${line.id}`,
        `<MEMO>${line.memo}`,
        "</STMTTRN>",
      ].join("\n"),
    )
    .join("\n");
  return [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "ENCODING:UTF-8",
    "",
    "<OFX>",
    "<BANKMSGSRSV1><STMTTRNRS><STMTRS>",
    "<CURDEF>BRL",
    "<BANKACCTFROM><BANKID>0999<ACCTID>00000-0<ACCTTYPE>CHECKING</BANKACCTFROM>",
    "<BANKTRANLIST>",
    `<DTSTART>${ofxDay(start)}`,
    `<DTEND>${ofxDay(today)}`,
    body,
    "</BANKTRANLIST>",
    `<LEDGERBAL><BALAMT>${amount(balance)}<DTASOF>${ofxDay(today)}</LEDGERBAL>`,
    "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
    "</OFX>",
    "",
  ].join("\n");
}
