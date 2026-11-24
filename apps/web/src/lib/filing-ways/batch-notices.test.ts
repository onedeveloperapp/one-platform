// @vitest-environment node
import { describe, expect, it } from "vitest";

import { batchStopKey, batchStopParams, CODE_WAIT_MINUTES, toldStop } from "@/lib/filing-ways/batch-notices";
import { bellCopyFor } from "@/lib/messages/bell-copy";

describe("what ONE's browser waits for, told to the lawyer of the batch (0284)", () => {
  it("tells every stop but one a person of the firm asked", () => {
    for (const why of [
      "court_code_missing",
      "court_login_refused",
      "unknown_outcome",
      "interrupted",
      "court_captcha",
    ]) {
      expect(toldStop(why), why).toBe(true);
    }
    for (const why of ["by_person", "by_lawyer", "by_person_code", null, ""]) expect(toldStop(why)).toBe(false);
  });

  it("says in the template what the protocol needs, never the code itself", () => {
    expect(batchStopParams({ name: "Ana Lima", systemName: "eproc do TJSP", kind: "code", codeKind: "app" })).toEqual([
      "Ana",
      "eproc do TJSP",
      "o tribunal pediu o código do seu aplicativo",
    ]);
    expect(batchStopParams({ name: "", systemName: "Projudi do TJGO", kind: "code", codeKind: "email" })).toEqual([
      "equipe",
      "Projudi do TJGO",
      "o tribunal mandou um código ao seu e-mail",
    ]);
    expect(batchStopParams({ name: "Ana", systemName: "eproc do TJSP", kind: "confirm" })[2]).toBe(
      "o ONE parou antes do primeiro envio e espera a sua confirmação",
    );
    expect(batchStopParams({ name: "Ana", systemName: "eproc do TJSP", kind: "stopped" })[2]).toBe(
      "o lote parou, e o motivo e o que fazer estão em Protocolo",
    );
    expect(batchStopKey("b-1", "confirm", "s-1")).toBe("filing-batch:b-1:confirm:s-1");
  });

  it("rings the bell with how long ONE waits for the code", () => {
    const copy = bellCopyFor("pt-BR");
    expect(copy.filingBatchCode("eproc do TJSP", false, CODE_WAIT_MINUTES).body).toContain(
      `nos próximos ${CODE_WAIT_MINUTES} minutos`,
    );
    expect(copy.filingBatchCode("Projudi do TJGO", true, CODE_WAIT_MINUTES).body).toContain("ao seu e-mail");
    for (const bell of [copy.filingBatchConfirm("eproc do TJSP"), copy.filingBatchStopped("eproc do TJSP")]) {
      expect(`${bell.title} ${bell.body}`).not.toMatch(/[—–!]/);
      expect(bell.body).toContain("Protocolo");
    }
  });
});
