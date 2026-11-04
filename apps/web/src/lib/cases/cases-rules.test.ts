// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  CASE_STATUSES,
  caseErrorKey,
  CAUSE_KEY,
  CAUSES,
  DOCUMENT_KIND_KEY,
  DOCUMENT_KINDS,
  DOCUMENT_STATUS_KEY,
  documentNeeds,
  documentsFor,
  EVENT_KEY,
  FILE_REFUSAL_KEY,
  formatLocalTime,
  isNeedMet,
  localTimeForField,
  MARITAL_KEY,
  MARITAL_STATUSES,
  missingItems,
  ORIGIN_KEY,
  ORIGINS,
  PERSON_FIELD_KEY,
  type PersonData,
  phoneForField,
  phonesOfWaId,
  type RequiredDocument,
  STATUS_KEY,
  waIdCandidates,
} from "@/lib/cases/cases";
import { personFields, personValues, segmentFields, segmentValues } from "@/lib/cases/forms";
import { WHATSAPP_COPY } from "@/lib/messages/whatsapp-copy";
import { INCIDENT_KEY, INCIDENTS } from "@/modules/direito-do-passageiro/incidents";
import messages from "@flyee/content/messages/pt-BR.json";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0022_cases.sql"), "utf8");
// The cases and what came with them: the signatures and the client's acceptances.
const CASE_MIGRATIONS = [
  "0022_cases.sql",
  "0023_signatures.sql",
  "0024_document_checks.sql",
  "0025_case_rules.sql",
  "0026_statements.sql",
  "0027_filing.sql",
]
  .map((file) => fs.readFileSync(path.join(ROOT, "packages/db/migrations", file), "utf8"))
  .join(String.fromCharCode(10));
// What else writes in the timeline of a case: the publications of the courts, the pieces, the dossier, the
// flights, the course in court and the import of a portfolio (their refusals are their own modules').
const TIMELINE_MIGRATIONS = [
  CASE_MIGRATIONS,
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0028_publications.sql"), "utf8"),
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0029_drafts.sql"), "utf8"),
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0030_flight_checks.sql"), "utf8"),
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0031_court_tracking.sql"), "utf8"),
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0032_portfolio_import.sql"), "utf8"),
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0042_package_signatures.sql"), "utf8"),
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0052_case_carry_on.sql"), "utf8"),
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0054_signature_papers.sql"), "utf8"),
  fs.readFileSync(path.join(ROOT, "packages/db/migrations/0088_notices_by_default.sql"), "utf8"),
].join(String.fromCharCode(10));
const product = messages.product as Record<string, string>;

/** The values a check constraint of migration 0022 allows, in its order. */
function allowed(constraint: string): string[] {
  const start = MIGRATION.indexOf(`constraint ${constraint} check`);
  expect(start, constraint).toBeGreaterThan(-1);
  const body = MIGRATION.slice(start, MIGRATION.indexOf(")", MIGRATION.indexOf("in (", start)));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

const person = (changes: Partial<PersonData> = {}): PersonData => ({
  person_id: "p-1",
  party_id: "party-1",
  full_name: "Maria Teste",
  cpf: "12345678909",
  birth_date: "1985-04-02",
  nationality: "brasileira",
  marital_status: "casado",
  profession: "Professora",
  email: null,
  phone: null,
  postal_code: "74000000",
  street: "Rua Teste",
  address_number: "10",
  complement: null,
  district: "Centro",
  city: "Goiânia",
  uf: "GO",
  ...changes,
});

const REQUIRED: RequiredDocument[] = [
  { kind: "identity", per: "claimant" },
  { kind: "address_proof", per: "holder" },
  { kind: "ticket", per: "case", or: ["boarding_pass"] },
];

describe("what a case still needs", () => {
  const holder = person();
  const child = person({
    person_id: "p-2",
    party_id: "party-2",
    full_name: "Joao Teste",
    cpf: null,
    birth_date: "2018-07-01",
  });

  it("asks an adult for what a power of attorney names, and a minor only for who they are", () => {
    const missing = missingItems({
      holder: person({ profession: null, uf: null }),
      claimants: [person({ profession: null, uf: null }), child],
      documents: [],
      segments: 1,
      required: [],
      today: "2026-10-09",
    });
    expect(missing).toEqual([
      { type: "fields", personId: "p-1", name: "Maria Teste", fields: ["profession", "uf"] },
      { type: "fields", personId: "p-2", name: "Joao Teste", fields: ["cpf"] },
    ]);
  });

  it("asks each claimant for their identity, the holder for the proof of address and the case for the ticket, first", () => {
    const missing = missingItems({
      holder,
      claimants: [holder, child],
      documents: [{ kind: "identity", party_id: "party-1", status: "received" }],
      segments: 0,
      required: REQUIRED,
      today: "2026-10-09",
    });
    // The documents come before the data: ONE reads a person's data in them.
    expect(missing).toEqual([
      { type: "document", kind: "identity", personId: "p-2", name: "Joao Teste" },
      { type: "document", kind: "address_proof", personId: "p-1", name: "Maria Teste" },
      { type: "document", kind: "ticket", personId: null, name: null },
      { type: "fields", personId: "p-2", name: "Joao Teste", fields: ["cpf"] },
      { type: "flight" },
    ]);
  });

  it("takes the boarding pass for the ticket, and counts a refused document as missing", () => {
    const missing = missingItems({
      holder,
      claimants: [holder],
      documents: [
        { kind: "identity", party_id: "party-1", status: "rejected" },
        { kind: "address_proof", party_id: "party-1", status: "accepted" },
        { kind: "boarding_pass", party_id: null, status: "received" },
      ],
      segments: 2,
      required: REQUIRED,
      today: "2026-10-09",
    });
    expect(missing).toEqual([{ type: "document", kind: "identity", personId: "p-1", name: "Maria Teste" }]);
  });

  it("takes the holder's proof of address under any of their parties, never under a child's or nobody's", () => {
    const needs = documentNeeds({
      holder,
      holderPartyIds: ["party-1", "party-g"],
      claimants: [holder, child],
      required: REQUIRED,
    });
    expect(needs.map((need) => need.key)).toEqual([
      "identity-party-1",
      "identity-party-2",
      "address_proof-holder",
      "ticket-case",
    ]);
    const proof = needs.find((need) => need.kind === "address_proof")!;
    expect(isNeedMet(proof, [{ kind: "address_proof", party_id: "party-g", status: "received" }])).toBe(true);
    expect(isNeedMet(proof, [{ kind: "address_proof", party_id: null, status: "accepted" }])).toBe(false);
    expect(isNeedMet(proof, [{ kind: "address_proof", party_id: "party-2", status: "received" }])).toBe(false);
    // The screen lists what was sent for a need with the same rule "what is missing" counts by.
    expect(
      documentsFor(proof, [
        { kind: "address_proof", party_id: "party-2", status: "received" },
        { kind: "address_proof", party_id: "party-1", status: "rejected" },
      ]),
    ).toEqual([{ kind: "address_proof", party_id: "party-1", status: "rejected" }]);
  });

  it("has nothing to ask of a complete case", () => {
    expect(
      missingItems({
        holder,
        claimants: [holder],
        documents: [
          { kind: "identity", party_id: "party-1", status: "accepted" },
          { kind: "address_proof", party_id: "party-1", status: "received" },
          { kind: "ticket", party_id: null, status: "accepted" },
        ],
        segments: 1,
        required: REQUIRED,
        today: "2026-10-09",
      }),
    ).toEqual([]);
  });
});

describe("phones and WhatsApp ids", () => {
  it("finds a Brazilian mobile by the id WhatsApp may know it by, with or without the ninth digit", () => {
    expect(waIdCandidates("55 (62) 99999-0001")).toEqual(["5562999990001", "556299990001"]);
    expect(waIdCandidates("556232220001")).toEqual(["556232220001"]);
    expect(waIdCandidates("")).toEqual([]);
    expect(phonesOfWaId("556299990001")).toEqual(["556299990001", "5562999990001"]);
    // A landline (starts with 2 to 5) never had a ninth digit.
    expect(phonesOfWaId("556232220001")).toEqual(["556232220001"]);
    expect(phonesOfWaId("5562999990001")).toEqual(["5562999990001"]);
  });

  it("shows a stored Brazilian phone as the phone field types it", () => {
    expect(phoneForField("5562999990001")).toBe("62999990001");
    expect(phoneForField("556232220001")).toBe("6232220001");
    expect(phoneForField("351912345678")).toBe("351912345678");
    expect(phoneForField(null)).toBe("");
  });
});

describe("local times, as the ticket prints them", () => {
  it("reads a stored time into the input and back into words", () => {
    expect(localTimeForField("2026-10-01T14:30:00")).toBe("2026-10-01T14:30");
    expect(localTimeForField("2026-10-01 14:30:00")).toBe("2026-10-01T14:30");
    expect(localTimeForField(null)).toBe("");
    expect(formatLocalTime("2026-10-01T14:30:00")).toBe("01/10/2026 14:30");
    expect(formatLocalTime("ontem")).toBe("");
  });
});

describe("what a form sends", () => {
  it("sends digits for the masked fields, null for an empty one, and only what changed", () => {
    const start = personValues(person({ phone: "5562999990001" }));
    expect(start.phone).toBe("62999990001");
    const edited = {
      ...start,
      cpf: "123.456.789-09",
      phone: "(62) 98888-0002",
      postal_code: "74000-001",
      complement: "",
    };
    expect(personFields(edited, ["cpf", "phone", "postal_code", "complement"])).toEqual({
      cpf: "12345678909",
      phone: "62988880002",
      postal_code: "74000001",
      complement: null,
    });
    expect(personFields(edited, ["full_name", "cpf", "phone", "postal_code"], start)).toEqual({
      phone: "62988880002",
      postal_code: "74000001",
    });
  });

  it("sends a leg whole, the problem marked by default", () => {
    const values = segmentValues(null);
    expect(values.affected).toBe(true);
    expect(segmentFields({ ...values, flight_number: " G3 1234 ", origin_iata: "gru" })).toMatchObject({
      flight_number: "G3 1234",
      origin_iata: "gru",
      destination_iata: null,
      affected: true,
    });
  });
});

describe("the words of the cases", () => {
  it("knows exactly the values the tables allow", () => {
    expect([...INCIDENTS]).toEqual(allowed("cases_incident_check"));
    expect([...CASE_STATUSES]).toEqual(allowed("cases_status_check"));
    expect([...ORIGINS]).toEqual(allowed("cases_origin_check"));
    expect([...CAUSES].sort()).toEqual(allowed("cases_cause_check").sort());
    expect([...MARITAL_STATUSES]).toEqual(allowed("people_marital_check"));
    expect([...DOCUMENT_KINDS]).toEqual(allowed("case_documents_kind_check"));
  });

  it("has words for every value, field and refusal", () => {
    const keys = [
      ...Object.values(INCIDENT_KEY),
      ...Object.values(STATUS_KEY),
      ...Object.values(ORIGIN_KEY),
      ...Object.values(CAUSE_KEY),
      ...Object.values(MARITAL_KEY),
      ...Object.values(DOCUMENT_KIND_KEY),
      ...Object.values(DOCUMENT_STATUS_KEY),
      ...Object.values(PERSON_FIELD_KEY),
      ...Object.values(FILE_REFUSAL_KEY),
      ...Object.values(EVENT_KEY),
    ];
    for (const key of keys) expect(product[key], key).toBeTruthy();
  });

  it("names every event the database writes in a timeline", () => {
    const kinds = new Set(
      [...TIMELINE_MIGRATIONS.matchAll(/record_case_event\([^,]+,\s*[^,]+,\s*'([a-z_]+)'/g)].map((match) => match[1]),
    );
    // `document_` + the decision, `signature_` + how the provider ended it.
    kinds.delete("document_");
    kinds.delete("signature_");
    for (const kind of ["document_accepted", "document_rejected", "signature_refused", "signature_expired"])
      kinds.add(kind);
    for (const kind of kinds) expect(EVENT_KEY[kind], kind).toBeTruthy();
  });

  it("has words for every refusal the database answers, and the app's own", () => {
    const success = new Set([
      "added",
      "attached",
      "created",
      "finished",
      "received",
      "recorded",
      "removed",
      "reserved",
      "revoked",
      "saved",
      "unchanged",
      "already_revoked",
      "requested",
      "cancelled",
      "signed",
      "already_signed",
      "opened",
      "failed",
      "accepted",
      "started",
      "sent",
      "ready",
      "filed",
      "measured",
      "insisted",
      "discarded",
      "found",
      "declined",
    ]);
    const codes = new Set(
      [...CASE_MIGRATIONS.matchAll(/'code', '([a-z_]+)'/g)]
        .map((match) => match[1])
        .filter((code) => !success.has(code)),
    );
    // `invalid_` + a free-text field's name.
    codes.delete("invalid_");
    for (const field of ["nationality", "profession", "street", "address_number", "complement", "district", "city"]) {
      codes.add(`invalid_${field}`);
    }
    for (const code of [
      "not_allowed_in_support_session",
      "not_authorized",
      "lookup_unavailable",
      "lookup_not_configured",
      "backend_not_configured",
      "link_not_open",
      "case_not_editable",
      "window_closed",
      "no_conversation",
      "empty",
      "type_not_allowed",
      "too_large",
      "not_uploaded",
      "storage_unavailable",
      "unavailable",
    ]) {
      codes.add(code);
    }
    // Answers to a request the screens never make: the generic words are enough.
    const generic = new Set([
      "invalid_source",
      "invalid_decision",
      "invalid_status",
      "invalid_result",
      "invalid_token",
      // Answers only the backend reads (it opens and closes an envelope).
      "not_opening",
      "invalid_answer",
      "invalid_evidence",
      // Answers only the backend reads (it processes a document and applies an unattended check).
      "invalid_outcome",
      "not_working",
      "normalized",
      "already_normalized",
      "run_not_found",
      "waits_for_a_person",
      // The screen never sends an empty acceptance.
      "terms_required",
      // Nor an account with both an audio and a text, a channel or a court system outside its own lists.
      "statement_required",
      "invalid_channel",
      "invalid_system",
      // What only the worker of a filing package reads.
      "invalid_items",
      // What only the backend reads of the measure of a photo, and the answer of a photo taken back, which no
      // screen shows (the client has already chosen another).
      "invalid_quality",
      "already_measured",
      "nothing_to_insist",
      "already_sent",
    ]);
    for (const code of codes) {
      const key = caseErrorKey(code);
      if (!generic.has(code)) expect(key, code).not.toBe("case-error-failed");
      expect(product[key], `${code} -> ${key}`).toBeTruthy();
    }
    expect(caseErrorKey("something_else")).toBe("case-error-failed");
  });
});

describe("a client's link", () => {
  it("opens only a token of the shape the app mints", async () => {
    const { isTokenShape } = await import("@/lib/cases/client-link");
    expect(isTokenShape("A".repeat(43))).toBe(true);
    expect(isTokenShape("abc_DEF-123".padEnd(43, "x"))).toBe(true);
    expect(isTokenShape("curto")).toBe(false);
    expect(isTokenShape("../".padEnd(43, "x"))).toBe(false);
    expect(isTokenShape("x".repeat(129))).toBe(false);
  });

  it("is sent with the firm's name and the address, in plain words", () => {
    const text = WHATSAPP_COPY["pt-BR"].clientLink({
      firstName: "Maria",
      firm: "Souza Advogados",
      url: "https://x.test/c/abc",
    });
    expect(text).toContain("Olá, Maria.");
    expect(text).toContain("Souza Advogados");
    expect(text).toContain("https://x.test/c/abc");
    expect(WHATSAPP_COPY["pt-BR"].clientLink({ firstName: "", firm: "F", url: "u" }).startsWith("Olá.")).toBe(true);
  });
});
