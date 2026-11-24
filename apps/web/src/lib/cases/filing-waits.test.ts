// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  type FilingWaitsOwed,
  filingWaitsOwedOf,
  filingWaitsParams,
  remindNow,
  sinceWords,
  systemWords,
} from "@/lib/cases/filing-waits";
import { bellCopyFor } from "@/lib/messages/bell-copy";

const OWED: FilingWaitsOwed = {
  packageId: "p-1",
  orgId: "o-1",
  caseId: "c-1",
  seq: 12,
  court: "TJSP",
  system: "eproc",
  systemName: "eproc do TJSP",
  since: "2026-11-20T15:00:00Z",
  isTest: false,
  userId: "u-1",
  name: "Ana Advogada Lima",
  round: 1,
};

describe("the reminder of a package that waits to be filed (0269)", () => {
  it("reads the database's answer, leaving out what is not one", () => {
    expect(
      filingWaitsOwedOf([
        {
          package_id: "p-1",
          org_id: "o-1",
          case_id: "c-1",
          seq: 12,
          court: "TJSP",
          system: "eproc",
          system_name: "eproc do TJSP",
          since: "2026-11-20T15:00:00Z",
          is_test: false,
          user_id: "u-1",
          name: "Ana Advogada Lima",
          round: 1,
        },
        { package_id: "p-2", round: 0 },
        null,
      ]),
    ).toEqual([OWED]);
    expect(filingWaitsOwedOf(null)).toEqual([]);
  });

  it("reaches a person only on a weekday's working hours in Brasília", () => {
    expect(remindNow(new Date("2026-11-23T12:00:00Z"))).toBe(true); // a Monday, 09:00 in Brasília
    expect(remindNow(new Date("2026-11-23T10:30:00Z"))).toBe(false); // 07:30
    expect(remindNow(new Date("2026-11-23T21:59:00Z"))).toBe(true); // 18:59
    expect(remindNow(new Date("2026-11-23T22:00:00Z"))).toBe(false); // 19:00
    expect(remindNow(new Date("2026-11-22T15:00:00Z"))).toBe(false); // a Sunday
    expect(remindNow(new Date("2026-11-21T15:00:00Z"))).toBe(false); // a Saturday
  });

  it("writes the template's values and the bell in the reader's words", () => {
    expect(filingWaitsParams(OWED)).toEqual([
      "Ana",
      "A ação do caso 12",
      "eproc do TJSP",
      "sexta-feira, 20 de novembro",
    ]);
    expect(filingWaitsParams({ ...OWED, seq: null, name: "" })[0]).toBe("equipe");
    expect(systemWords({ court: "TJGO", system: "projudi", systemName: null })).toBe("Projudi do TJGO");
    expect(sinceWords("2026-11-21T02:00:00Z")).toBe("sexta-feira, 20 de novembro");
    const bell = bellCopyFor("pt-BR").filingWaits(
      "A ação do caso nº 12",
      "eproc do TJSP",
      "sexta-feira, 20 de novembro",
    );
    expect(bell.title).toBe("Ação pronta para protocolar");
    expect(bell.body).not.toMatch(/[—–!]/);
  });
});
