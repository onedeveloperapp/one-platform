import { documentText, moneyInWords, numberInWords, readReceipts, receiptDocument, receiptOfBill } from "./receipts";
import { describe, expect, it } from "vitest";

describe("a value written out (0152)", () => {
  it.each([
    [1, "um"],
    [16, "dezesseis"],
    [21, "vinte e um"],
    [100, "cem"],
    [101, "cento e um"],
    [123, "cento e vinte e três"],
    [1000, "mil"],
    [1050, "mil e cinquenta"],
    [1250, "mil duzentos e cinquenta"],
    [1500, "mil e quinhentos"],
    [2100, "dois mil e cem"],
    [21_345, "vinte e um mil trezentos e quarenta e cinco"],
    [1_000_000, "um milhão"],
    [1_500_000, "um milhão e quinhentos mil"],
    [2_000_001, "dois milhões e um"],
  ])("%i is %s", (value, words) => {
    expect(numberInWords(value)).toBe(words);
  });

  it.each([
    [150_000, "mil e quinhentos reais"],
    [100, "um real"],
    [150, "um real e cinquenta centavos"],
    [1, "um centavo"],
    [99, "noventa e nove centavos"],
    [1_001, "dez reais e um centavo"],
    [100_000_000, "um milhão de reais"],
    [250_000_000, "dois milhões e quinhentos mil reais"],
    [0, "zero real"],
  ])("%i cents are %s", (cents, words) => {
    expect(moneyInWords(cents)).toBe(words);
  });
});

describe("what a receipt says", () => {
  const facts = {
    firm: "Teste Advocacia",
    firmDocument: "11222333000181",
    payer: "Maria Teste de Oliveira",
    payerCpf: "52998224725",
    cents: 150_000,
    paidOn: "2026-11-09",
    about: "Entrada dos honorários",
    caseSeq: 42,
    issuedOn: "2026-11-10",
  };

  it("names who paid, the value in figures and in words, what for, and the firm with its CNPJ", () => {
    const { title, blocks } = receiptDocument(facts);
    expect(title).toBe("Recibo do caso nº 42");
    const text = JSON.stringify(blocks);
    expect(text).toContain(
      "Teste Advocacia, CNPJ nº 11.222.333/0001-81 recebeu de Maria Teste de Oliveira, CPF nº 529.982.247-25,",
    );
    expect(text).toContain("(mil e quinhentos reais), referente a Entrada dos honorários, do caso nº 42.");
    expect(text).toContain("09/11/2026");
    expect(text).toContain("Emitido em 10 de novembro de 2026.");
  });

  it("leaves out a document not on record, and a case it has none of", () => {
    const { title, blocks } = receiptDocument({ ...facts, firmDocument: null, payerCpf: null, caseSeq: null });
    expect(title).toBe("Recibo");
    const text = JSON.stringify(blocks);
    expect(text).toContain("Teste Advocacia recebeu de Maria Teste de Oliveira a quantia de");
    expect(text).not.toContain("CPF");
    expect(text).not.toContain("caso nº");
  });

  it("writes no dash and no exclamation", () => {
    expect(JSON.stringify(receiptDocument(facts).blocks)).not.toMatch(/[–—!]/);
  });

  it("writes a CPF and a CNPJ by their digits only", () => {
    expect(documentText("529.982.247-25")).toBe("529.982.247-25");
    expect(documentText("123")).toBeNull();
  });
});

describe("the receipts as the database answers them", () => {
  const raw = [
    {
      id: "r1",
      bill_id: "b1",
      status: "void",
      cents: 100,
      paid_on: "2026-11-01",
      issued_documents: { verify_code: "ABCDEFGHJKMN", file_id: "f1" },
    },
    {
      id: "r2",
      bill_id: "b1",
      status: "issued",
      cents: 100,
      paid_on: "2026-11-02",
      issued_documents: [{ file_id: "f2" }],
    },
    { id: "r3", bill_id: "b2", status: "nonsense" },
  ];

  it("keeps what it reads and leaves out the rest", () => {
    const receipts = readReceipts(raw);
    expect(receipts.map((receipt) => receipt.id)).toEqual(["r1", "r2"]);
    expect(receipts[0].verifyCode).toBe("ABCDEFGHJKMN");
    expect(receipts[1].fileId).toBe("f2");
  });

  it("shows on a bill the receipt in force before one voided", () => {
    expect(receiptOfBill(readReceipts(raw), "b1")?.id).toBe("r2");
    expect(receiptOfBill(readReceipts(raw), "b2")).toBeNull();
  });
});
