import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatCents,
  isClientMoney,
  lineKey,
  ofxDay,
  parseCents,
  readOfx,
  ruleAnswers,
  transferPairs,
} from "./finance.ts";

describe("money as whole cents", () => {
  const cases: [string, number | null][] = [
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["-1234.56", -123456],
    ["R$ 10,00", 1000],
    ["10,5", 1050],
    ["1.234", 123400],
    ["-0,01", -1],
    ["(15,90)", -1590],
    ["150.00-", -15000],
    ["abc", null],
    ["", null],
    ["12,3,4", null],
    ["1.234.567,89", 123456789],
  ];
  for (const [text, cents] of cases) {
    it(`reads ${JSON.stringify(text)}`, () => assert.equal(parseCents(text), cents));
  }
  it("writes cents as a person reads them", () => {
    assert.equal(formatCents(123456), "R$ 1.234,56");
    assert.equal(formatCents(-1000), "-R$ 10,00");
    assert.equal(formatCents(5), "R$ 0,05");
  });
});

const SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0341<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261101000000[-3:BRT]
<DTEND>20261130000000[-3:BRT]
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261103120000[-3:BRT]
<TRNAMT>2500.00
<FITID>A1
<MEMO>TED ALVARA JUDICIAL TJGO
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261104
<TRNAMT>-189.90
<FITID>A2
<MEMO>PAG BOLETO ENERGIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261105
<TRNAMT>0
<FITID>A3
<MEMO>NADA
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>12310.10<DTASOF>20261130</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("an OFX statement", () => {
  it("reads a bank's SGML statement as the bank wrote it", () => {
    const read = readOfx(SGML);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.statement.kind, "bank");
    assert.deepEqual(read.statement.account, { bank: "0341", number: "12345-6" });
    assert.equal(read.statement.startsOn, "2026-11-01");
    assert.equal(read.statement.endsOn, "2026-11-30");
    assert.deepEqual(read.statement.balance, { cents: 1231010, on: "2026-11-30" });
    // A line with no value is left out, never guessed.
    assert.deepEqual(read.statement.lines, [
      { bankId: "A1", postedOn: "2026-11-03", cents: 250000, memo: "TED ALVARA JUDICIAL TJGO" },
      { bankId: "A2", postedOn: "2026-11-04", cents: -18990, memo: "PAG BOLETO ENERGIA" },
    ]);
  });

  it("reads an XML card statement, closed tags and entities", () => {
    const xml = `<?xml version="1.0"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CCACCTFROM><ACCTID>4111</ACCTID></CCACCTFROM><BANKTRANLIST>
<STMTTRN><DTPOSTED>20261010</DTPOSTED><TRNAMT>-42,50</TRNAMT><FITID>X</FITID><NAME>Livraria &amp; Cia</NAME></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const read = readOfx(xml);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.statement.kind, "card");
    assert.deepEqual(read.statement.lines, [{ bankId: "X", postedOn: "2026-10-10", cents: -4250, memo: "Livraria & Cia" }]);
  });

  it("says what is no statement", () => {
    assert.deepEqual(readOfx("data;valor\n2026-01-01;10"), { ok: false, code: "not_ofx" });
    assert.deepEqual(readOfx("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>"), { ok: false, code: "no_lines" });
    assert.equal(ofxDay("20260231"), null);
  });
});

describe("a line's key, a client's money, a transfer, a rule", () => {
  it("keys a line by its day, value and memo as the rules compare it", () => {
    assert.equal(
      lineKey({ postedOn: "2026-11-03", cents: 100, memo: "  Pix  RECEBIDO João " }),
      "2026-11-03|100|pix recebido joao",
    );
  });

  it("sets a court's money apart from revenue, by rule", () => {
    assert.equal(isClientMoney({ cents: 250000, memo: "TED ALVARA JUDICIAL TJGO" }), true);
    assert.equal(isClientMoney({ cents: 90000, memo: "Levantamento dep. judicial" }), true);
    assert.equal(isClientMoney({ cents: 50000, memo: "PIX RECEBIDO HONORARIOS" }), false);
    // A debit is never a client's money arriving.
    assert.equal(isClientMoney({ cents: -250000, memo: "ALVARA" }), false);
  });

  it("pairs a debit and a credit of the same value between two of the firm's accounts", () => {
    const pairs = transferPairs([
      { id: "a", accountId: "bank", postedOn: "2026-11-03", cents: -50000, memo: "TED", bankId: null },
      { id: "b", accountId: "cash", postedOn: "2026-11-04", cents: 50000, memo: "TED", bankId: null },
      { id: "c", accountId: "bank", postedOn: "2026-11-03", cents: 50000, memo: "PIX", bankId: null },
      { id: "d", accountId: "card", postedOn: "2026-11-20", cents: 50000, memo: "PAG", bankId: null },
    ]);
    assert.deepEqual(pairs, [{ from: "a", to: "b" }]);
  });

  it("answers for a line with a rule's words and way", () => {
    assert.equal(ruleAnswers({ words: "energia", direction: "out" }, { cents: -18990, memo: "PAG BOLETO ENERGIA" }), true);
    assert.equal(ruleAnswers({ words: "energia", direction: "in" }, { cents: -18990, memo: "PAG BOLETO ENERGIA" }), false);
    assert.equal(ruleAnswers({ words: "ab", direction: "out" }, { cents: -1, memo: "ab" }), false);
  });
});
