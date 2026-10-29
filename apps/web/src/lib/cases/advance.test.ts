import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ADVANCE_WAITING, caseAdvanceOf, lawsuitsWaiting, waitingFix, waitingKey } from "@/lib/cases/advance";
import { caseHolder, caseMissing, type MissingParty, type PersonData, type RequiredDocument } from "@/lib/cases/cases";
import { lawsuitPlan, type RuleParty } from "@/lib/cases/rules";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;
const ROOT = path.resolve(process.cwd(), "..", "..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0039_case_advance.sql"), "utf8");

// Every person here is invented.

const TODAY = "2026-10-14";
const WAGES = [{ validFrom: "2026-01-01", cents: 162100, act: "Decreto 12.797/2025" }];
const COURTS = [
  { acronym: "TJGO", uf: "GO" },
  { acronym: "TJSP", uf: "SP" },
];
const SYSTEMS = [
  { court: "TJGO", proceeding_kind: "juizado", system: "projudi", confirmed: true },
  { court: "TJGO", proceeding_kind: "comum", system: "projudi", confirmed: false },
];

const person = (overrides: Partial<PersonData>): PersonData => ({
  person_id: "maria",
  party_id: "p-maria",
  full_name: "Maria Teste",
  cpf: "12345678909",
  birth_date: "1985-04-02",
  nationality: "brasileira",
  marital_status: "casado",
  profession: "professora",
  email: null,
  phone: null,
  postal_code: "74000000",
  street: "Rua das Flores",
  address_number: "10",
  complement: null,
  district: "Centro",
  city: "Goiânia",
  uf: "GO",
  ...overrides,
});

const MARIA: MissingParty = { partyId: "p-maria", role: "claimant", guardianPartyId: null, person: person({}) };
const LUCAS: MissingParty = {
  partyId: "p-lucas",
  role: "claimant",
  guardianPartyId: "p-maria-guardian",
  person: person({ person_id: "lucas", party_id: "p-lucas", full_name: "Lucas Teste", birth_date: "2018-03-01" }),
};
const REQUIRED: RequiredDocument[] = [
  { kind: "identity", per: "claimant" },
  { kind: "address_proof", per: "holder" },
  { kind: "ticket", per: "case", or: ["boarding_pass"] },
];
const PAPERS = [
  { kind: "identity", party_id: "p-maria", status: "accepted" },
  { kind: "address_proof", party_id: "p-maria", status: "accepted" },
  { kind: "boarding_pass", party_id: null, status: "accepted" },
];

const ruleParty = (party: MissingParty, claimCents: number | null): RuleParty => ({
  partyId: party.partyId,
  role: party.role,
  guardianPartyId: party.guardianPartyId,
  birthDate: party.person.birth_date,
  city: party.person.city,
  uf: party.person.uf,
  claimCents,
});

describe("what ONE waits for before it creates a case's lawsuits", () => {
  it("reads what the case lacks with the same rule the case screen shows", () => {
    expect(caseHolder([LUCAS, MARIA], TODAY)?.partyId).toBe("p-maria");
    expect(caseMissing({ parties: [MARIA], documents: PAPERS, segments: 1, required: REQUIRED, today: TODAY })).toEqual(
      [],
    );
    const lacking = caseMissing({
      parties: [MARIA],
      documents: PAPERS.filter((paper) => paper.kind !== "address_proof"),
      segments: 0,
      required: REQUIRED,
      today: TODAY,
    });
    expect(lacking.map((item) => item.type)).toEqual(["document", "flight"]);
    expect(caseMissing({ parties: [], documents: [], segments: 0, required: REQUIRED, today: TODAY })).toEqual([]);
  });

  it("waits for what is missing and for somebody who claims, never for a Valor da Causa Pedido (0064)", () => {
    expect(lawsuitsWaiting({ missing: [{ type: "flight" }], claims: [1000000] })).toBe("case_incomplete");
    expect(lawsuitsWaiting({ missing: [], claims: [] })).toBe("no_claimants");
    // A claimant with no value goes with none, and the judge defines it.
    expect(lawsuitsWaiting({ missing: [], claims: [1000000, null] })).toBeNull();
    expect(lawsuitsWaiting({ missing: [], claims: [null] })).toBeNull();
    expect(lawsuitsWaiting({ missing: [], claims: [1000000, 500000] })).toBeNull();
  });

  it("waits for the client to confirm the data an agency handed over (0071), after what is missing", () => {
    expect(lawsuitsWaiting({ missing: [], claims: [null], unconfirmedHandoff: true })).toBe("client_confirmation");
    expect(lawsuitsWaiting({ missing: [{ type: "flight" }], claims: [null], unconfirmedHandoff: true })).toBe(
      "case_incomplete",
    );
    expect(lawsuitsWaiting({ missing: [], claims: [null], unconfirmedHandoff: false })).toBeNull();
  });
});

describe("the lawsuits the rules plan, as the screen and ONE create them", () => {
  const common = { wages: WAGES, ceilingTimes: 40, courts: COURTS, systems: SYSTEMS, day: TODAY };

  it("plans an adult at the domicile, with the system the court table confirms", () => {
    expect(lawsuitPlan({ ...common, parties: [ruleParty(MARIA, 1000000)], familyChoice: "together" })).toEqual({
      ok: true,
      plan: [
        {
          fields: {
            kind: "juizado",
            court: "TJGO",
            comarca: "Goiânia",
            forum_basis: "domicile",
            forum_city: "Goiânia",
            system: "projudi",
          },
          parties: ["p-maria"],
        },
      ],
    });
  });

  it("takes a family with a minor to the civil court together, and leaves an unconfirmed system to a person", () => {
    const planned = lawsuitPlan({
      ...common,
      parties: [ruleParty(MARIA, 1000000), ruleParty(LUCAS, 1000000)],
      familyChoice: "together",
    });
    expect(planned.ok && planned.plan.map((item) => [item.fields.kind, item.fields.system, item.parties])).toEqual([
      ["comum", null, ["p-maria", "p-lucas"]],
    ]);
  });

  it("says why it plans nothing", () => {
    expect(lawsuitPlan({ ...common, wages: [], parties: [ruleParty(MARIA, 1)], familyChoice: "together" })).toEqual({
      ok: false,
      code: "ceiling_unknown",
    });
    expect(lawsuitPlan({ ...common, parties: [], familyChoice: "together" })).toEqual({
      ok: false,
      code: "no_claimants",
    });
    const homeless = { ...ruleParty(MARIA, 1000000), city: null };
    expect(lawsuitPlan({ ...common, parties: [homeless], familyChoice: "together" })).toEqual({
      ok: false,
      code: "domicile_unknown",
    });
  });
});

describe("the words of what ONE waits for", () => {
  it("has words for every code, for a refusal it does not know, and for each way to put it right", () => {
    for (const code of ADVANCE_WAITING) expect(product[waitingKey(code)], code).toBeTruthy();
    expect(waitingKey("draft_in_course")).toBe("advance-waiting-refused");
    expect(product[waitingKey("draft_in_course")]).toBeTruthy();
    for (const code of ["no_signer", "no_model"]) {
      const fix = waitingFix(code);
      expect(fix && product[fix.key], code).toBeTruthy();
    }
    expect(waitingFix("held")).toBeNull();
  });

  it("knows every code the database writes", () => {
    const written = [...MIGRATION.matchAll(/waiting := coalesce\(waiting, '([a-z_]+)'\)/g)].map((match) => match[1]);
    expect(written.length).toBeGreaterThan(0);
    for (const code of written) expect(ADVANCE_WAITING, code).toContain(code);
  });

  it("reads the record of a case, and nothing it does not know", () => {
    expect(caseAdvanceOf({ waiting: "no_model", checked_at: "2026-10-14T12:00:00Z" })).toEqual({
      waiting: "no_model",
      checkedAt: "2026-10-14T12:00:00Z",
    });
    expect(caseAdvanceOf({ waiting: "<b>", checked_at: null })).toEqual({ waiting: null, checkedAt: null });
    expect(caseAdvanceOf(null)).toBeNull();
  });
});
