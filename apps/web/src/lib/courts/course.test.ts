// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  COURSE_REFUSALS,
  courseErrorKey,
  failureCode,
  inProjudiHours,
  movementId,
  movementsOf,
  snapshotOf,
} from "@/lib/courts/course";
import messages from "@flyee/content/messages/pt-BR.json";
import type { CourtProceeding } from "@flyee/courts/types";

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0031_court_tracking.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The body of a function of migration 0031. */
function body(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return MIGRATION.slice(start, MIGRATION.indexOf("\n$$;", start));
}

const refusals = (name: string): string[] =>
  [...body(name).matchAll(/'ok', false, 'code', '([a-z_]+)'/g)].map((match) => match[1]);

const proceeding = (changes: Partial<CourtProceeding> = {}): CourtProceeding => ({
  number: "5000123-60.2099.8.09.0051",
  unit: "Goiânia - 3º Juizado Especial Cível",
  className: null,
  subjects: [],
  phase: null,
  status: "Ativo",
  claimValue: null,
  distributedOn: null,
  finalOn: null,
  secret: false,
  lawyers: [],
  responsibles: [],
  pending: [],
  ...changes,
});

describe("what is kept of a reading of the court", () => {
  it("keeps the lawsuit as read, its lists cut short, and names its source", () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      name: `ADVOGADO ${index}`,
      oab: `${index} N`,
      party: "Polo Ativo",
      receivesNotices: true,
    }));
    const kept = snapshotOf(proceeding({ lawyers: many }), "projudi");
    expect(kept.vendor).toBe("projudi");
    expect((kept.lawyers as unknown[]).length).toBe(50);
    expect(kept.unit).toBe("Goiânia - 3º Juizado Especial Cível");
  });

  it("keeps a movement's id as the source gave it, or a stable name of it, and its words within their room", () => {
    expect(movementId("900000001")).toBe("900000001");
    const odd = "id com espaço / e barra";
    expect(movementId(odd)).toMatch(/^[A-Za-z0-9._:-]{1,100}$/);
    expect(movementId(odd)).toBe(movementId(odd));
    expect(movementId(odd)).not.toBe(movementId("id com espaço / e barro"));
    expect(movementId("x".repeat(150))).toMatch(/^[A-Za-z0-9._:-]{1,100}$/);
    const [kept] = movementsOf([
      { id: "1", at: "2026-08-03T20:36:41.000Z", title: "T".repeat(1500), detail: null, by: null },
    ]);
    expect(kept.title.length).toBe(1000);
  });
});

describe("the hours Projudi is read in by routine", () => {
  it("crosses midnight in Brasília, and the same hour twice is every hour", () => {
    // 23:00 and 05:00 in Brasília are in 22 to 6; 12:00 is not.
    expect(inProjudiHours(Date.parse("2026-10-11T02:00:00Z"), 22, 6)).toBe(true);
    expect(inProjudiHours(Date.parse("2026-10-11T08:00:00Z"), 22, 6)).toBe(true);
    expect(inProjudiHours(Date.parse("2026-10-11T15:00:00Z"), 22, 6)).toBe(false);
    expect(inProjudiHours(Date.parse("2026-10-11T09:00:00Z"), 22, 6)).toBe(false);
    expect(inProjudiHours(Date.parse("2026-10-11T15:00:00Z"), 8, 18)).toBe(true);
    expect(inProjudiHours(Date.parse("2026-10-11T15:00:00Z"), 0, 0)).toBe(true);
  });
});

describe("the words of the course of a lawsuit", () => {
  it("keeps a failure as a code the database takes", () => {
    expect(failureCode(new Error("projudi_http_503"))).toBe("projudi_http_503");
    expect(failureCode(new Error("projudi_refused: Operação Não Autorizada."))).toBe("projudi_refused");
    expect(failureCode(new Error("Escavador fora do ar"))).toBe("escavador_fora_do_ar");
    expect(failureCode("nada")).toBe("source_failed");
  });

  it("has words for every refusal the database answers a person with, and the list says them all", () => {
    const answered = [
      ...new Set([...refusals("request_proceeding_read"), ...refusals("acknowledge_proceeding_movements")]),
    ];
    expect([...answered].sort()).toEqual([...COURSE_REFUSALS].sort());
    for (const code of [...COURSE_REFUSALS, "case_not_found", "not_allowed_in_support_session", "anything else"]) {
      expect(product[courseErrorKey(code)], code).toBeTruthy();
    }
    expect(courseErrorKey("anything else")).toBe("course-error-failed");
  });
});
