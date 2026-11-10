import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  arrecadacaoBarcode,
  arrecadacaoLine,
  cobrancaBarcode,
  cobrancaLine,
  dueFromFactor,
  factorOf,
  mod10,
  mod11Arrecadacao,
  mod11Cobranca,
  readBoleto,
} from "./boleto.ts";

/** A collection bill of an invented bank's free field, due on a day, of a value in cents. */
function cobranca(due: string, cents: number): string {
  const head = `3419${String(factorOf(due)).padStart(4, "0")}${String(cents).padStart(10, "0")}`;
  const free = "1090000000017654321000";
  return cobrancaLine(cobrancaBarcode(head + free.padEnd(25, "0")));
}

describe("the typed line of a bill", () => {
  it("computes the check digits as FEBRABAN does", () => {
    // 3 4 1 9 1 0 9 0 0 with weights 2 and 1 from the right: 6+4+2+9+2+0+9+0+0 = 32, so 8.
    assert.equal(mod10("341910900"), 8);
    assert.equal(mod10("0000000000"), 0);
    assert.equal(mod11Cobranca("0000000000000000000000000000000000000000000"), 1);
    assert.equal(mod11Arrecadacao("00000000000"), 0);
  });

  it("reads the due factor in the cycle nearest to the day it is read on, the new cycle from 2025-02-22", () => {
    assert.equal(dueFromFactor(1000, "2026-11-10"), "2025-02-22");
    assert.equal(dueFromFactor(9999, "2025-01-01"), "2025-02-21");
    assert.equal(dueFromFactor(factorOf("2026-11-20"), "2026-11-10"), "2026-11-20");
    assert.equal(dueFromFactor(0, "2026-11-10"), null);
    assert.equal(factorOf("2025-02-22"), 1000);
  });

  it("reads a collection bill: its value, its due day and its bank, every digit checked", () => {
    const line = cobranca("2026-11-20", 18990);
    assert.equal(line.length, 47);
    const read = readBoleto(line.replace(/^(\d{5})(\d{5})/, "$1.$2 "), "2026-11-10");
    assert.ok(read.ok);
    assert.equal(read.boleto.kind, "cobranca");
    assert.equal(read.boleto.cents, 18990);
    assert.equal(read.boleto.dueOn, "2026-11-20");
    assert.equal(read.boleto.bank, "341");
    assert.equal(read.boleto.barcode.length, 44);
    // The barcode read back gives the same line.
    const again = readBoleto(read.boleto.barcode, "2026-11-10");
    assert.ok(again.ok && again.boleto.line === line);
  });

  it("refuses a line with a digit typed wrong, in a field or in the general digit", () => {
    const line = cobranca("2026-11-20", 18990);
    const wrongField = line.slice(0, 2) + ((Number(line[2]) + 1) % 10) + line.slice(3);
    assert.deepEqual(readBoleto(wrongField, "2026-11-10"), { ok: false, code: "field_digit" });
    const wrongValue = line.slice(0, 46) + ((Number(line[46]) + 1) % 10);
    assert.deepEqual(readBoleto(wrongValue, "2026-11-10"), { ok: false, code: "general_digit" });
    assert.deepEqual(readBoleto("123", "2026-11-10"), { ok: false, code: "length" });
  });

  it("reads an arrecadação of a power company with its value, by module 10, and one by module 11", () => {
    // 8, segment 3 (power), value id 6 (value in reais, module 10), the value, the company and its own code.
    const power = arrecadacaoLine(arrecadacaoBarcode("836" + "00000018990" + "0048" + "20261120" + "12345678901234567"));
    assert.equal(power.length, 48);
    const read = readBoleto(power, "2026-11-10");
    assert.ok(read.ok);
    assert.equal(read.boleto.kind, "arrecadacao");
    assert.equal(read.boleto.cents, 18990);
    assert.equal(read.boleto.segment, "3");
    assert.equal(read.boleto.dueOn, null);
    const tax = arrecadacaoLine(arrecadacaoBarcode("818" + "00000045000" + "0101" + "20261120" + "98765432109876543"));
    const taxRead = readBoleto(tax, "2026-11-10");
    assert.ok(taxRead.ok && taxRead.boleto.cents === 45000);
    const wrong = tax.slice(0, 5) + ((Number(tax[5]) + 1) % 10) + tax.slice(6);
    assert.deepEqual(readBoleto(wrong, "2026-11-10"), { ok: false, code: "field_digit" });
  });

  it("says when an arrecadação's value is the payer's to say", () => {
    const reference = arrecadacaoLine(arrecadacaoBarcode("817" + "00000000000" + "0101" + "20261120" + "98765432109876543"));
    const read = readBoleto(reference, "2026-11-10");
    assert.ok(read.ok && read.boleto.cents === null);
  });
});
