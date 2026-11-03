import { describe, expect, it } from "vitest";

import { personFields, personValues } from "@/lib/cases/forms";
import {
  CONSENT_KEY,
  DOCUMENT_KIND_KEY,
  documentLegsOf,
  FILTER_KEY,
  legFormsOf,
  legsForSave,
  localTimeLabel,
  PAX_ADULT_FORM,
  PAX_MINOR_FORM,
  paxDetailOf,
  paxErrorKey,
  paxOverviewOf,
  paxPageOf,
  paxPersonData,
  READING_KEY,
  readingErrorKey,
  TRIP_STATE_KEY,
} from "@/modules/direito-do-passageiro/agency/passengers";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

describe("what the agency's screens read", () => {
  it("reads the home's counts, the clause missing included", () => {
    expect(
      paxOverviewOf({
        travelers: 3,
        adults_waiting: 1,
        missing_identity: 2,
        upcoming: 0,
        watched: 1,
        consent_term: null,
      }),
    ).toEqual({ travelers: 3, adultsWaiting: 1, missingIdentity: 2, upcoming: 0, watched: 1, consentTerm: null });
    expect(paxOverviewOf({ consent_term: 2 }).consentTerm).toBe(2);
    expect(paxOverviewOf(null).travelers).toBe(0);
  });

  it("reads a page of passengers, leaving out a row it cannot name", () => {
    const page = paxPageOf({
      total: 2,
      rows: [
        {
          id: "t1",
          full_name: "Mariana Teste",
          cpf: "11144477735",
          minor: false,
          consent: "agreed",
          kinds: ["identity", "passport"],
          reading: true,
          next_departure: "2026-11-03T14:30:00",
          handed_over_at: null,
        },
        { id: null, full_name: "Sem id" },
      ],
    });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      id: "t1",
      consent: "agreed",
      kinds: ["identity"],
      reading: true,
      handedOver: false,
      minor: false,
    });
  });

  it("reads a passenger whole: record, documents, trips, answers and link", () => {
    const detail = paxDetailOf({
      traveler: {
        id: "t1",
        full_name: "Mariana Teste de Oliveira",
        cpf: "11144477735",
        birth_date: "1988-03-02",
        minor: false,
        read_fields: { full_name: { document: "d1" }, unknown: {} },
        handed_over_at: null,
      },
      guardian: null,
      children: [{ id: "t2", full_name: "Pedro Teste" }],
      documents: [
        {
          id: "d1",
          kind: "identity",
          source: "partner",
          reading: "done",
          name: "rg.jpg",
          read: { matches: "sim", legible: true, identified: "RG", note: "" },
        },
      ],
      trips: [
        {
          id: "r1",
          locator: "ABC123",
          holder_id: "t1",
          state: "watching",
          travelers: [{ id: "t1", full_name: "Mariana" }],
          legs: [
            {
              position: 2,
              flight_number: "LA3457",
              origin_iata: "GIG",
              destination_iata: "GRU",
              departure: "2026-11-10T09:00",
              arrival: "2026-11-10T10:05",
            },
            {
              position: 1,
              flight_number: "LA3456",
              origin_iata: "GRU",
              destination_iata: "GIG",
              departure: "2026-11-03T14:30",
              arrival: "2026-11-03T15:35",
            },
          ],
        },
      ],
      consent: "agreed",
      consents: [{ answer: "agreed", created_at: "2026-10-29T10:00:00Z" }],
      confirm_link: { created_at: "2026-10-29", expires_at: "2026-11-28", open: true },
    });
    expect(detail?.traveler.readFields).toEqual(["full_name"]);
    expect(detail?.children).toEqual([{ id: "t2", fullName: "Pedro Teste" }]);
    expect(detail?.documents[0].read).toEqual({ matches: true, legible: true, identified: "RG", note: "" });
    expect(detail?.trips[0].legs.map((leg) => leg.flightNumber)).toEqual(["LA3456", "LA3457"]);
    expect(detail?.confirmLink?.open).toBe(true);
    expect(detail?.traveler.draft).toBe(false);
    expect(paxDetailOf({})).toBeNull();
  });

  it("reads a passenger started from documents: a draft, its CPF kept apart, whose CPF it already is", () => {
    const traveler = paxDetailOf({
      traveler: {
        id: "t9",
        full_name: "Passageiro em cadastro",
        cpf: null,
        draft_cpf: "52998224725",
        draft: true,
        duplicate_of: "t1",
        read_fields: { cpf: { document: "d9" } },
      },
    })?.traveler;
    expect(traveler?.draft).toBe(true);
    expect(traveler?.cpf).toBe("52998224725");
    expect(traveler?.duplicateOf).toBe("t1");
    expect(traveler?.readFields).toEqual(["cpf"]);
  });
});

describe("the forms", () => {
  it("hands a passenger to the shared person form, which sends only what changed", () => {
    const traveler = paxDetailOf({
      traveler: { id: "t1", full_name: "Mariana Teste", phone: "5562999990001" },
    })?.traveler;
    const initial = personValues(paxPersonData(traveler ?? null));
    expect(initial.phone).toBe("62999990001");
    expect(personFields({ ...initial, email: "mariana@teste.invalid" }, PAX_ADULT_FORM, initial)).toEqual({
      email: "mariana@teste.invalid",
    });
    expect(PAX_MINOR_FORM).not.toContain("phone");
  });

  it("writes the legs as the database takes them", () => {
    expect(
      legsForSave([
        {
          flightNumber: "la 3456",
          originIata: "gru ",
          destinationIata: "gig",
          departure: "2026-11-03T14:30",
          arrival: "2026-11-03T15:35:00",
        },
      ]),
    ).toEqual([
      {
        flight_number: "LA3456",
        origin_iata: "GRU",
        destination_iata: "GIG",
        departure: "2026-11-03T14:30",
        arrival: "2026-11-03T15:35",
      },
    ]);
  });

  it("takes the legs ONE read of a trip's document into the trip's form", () => {
    const clean = documentLegsOf({
      ok: true,
      legs: [
        {
          position: 1,
          flight_number: "LA3456",
          origin_iata: "GRU",
          destination_iata: "REC",
          departure: "2099-05-10T08:10",
          arrival: "2099-05-10T11:25",
        },
      ],
      read: [],
      locator: "TSTM4R",
    });
    expect(clean).toEqual({
      state: "read",
      clean: true,
      locator: "TSTM4R",
      legs: [
        {
          flightNumber: "LA3456",
          originIata: "GRU",
          destinationIata: "REC",
          departure: "2099-05-10T08:10",
          arrival: "2099-05-10T11:25",
        },
      ],
    });
    // A leg the checks refused comes as it was read, for the agency to correct, in the form's local time.
    const refused = documentLegsOf({
      ok: false,
      code: "invalid_airport",
      position: 1,
      read: [{ flight_number: "LA 3456", origin_iata: "Guarulhos", departure: "2099-05-10 08:10:00" }],
      locator: null,
    });
    expect(refused.state === "read" && refused.clean).toBe(false);
    expect(refused.state === "read" ? refused.legs[0].departure : null).toBe("2099-05-10T08:10");
    expect(documentLegsOf({ ok: false, code: "reading" })).toEqual({ state: "reading" });
    expect(documentLegsOf({ ok: false, code: "no_legs", note: "Foto escura." })).toEqual({
      state: "none",
      note: "Foto escura.",
    });
    expect(documentLegsOf({ ok: false, code: "read_failed" })).toEqual({ state: "none", note: null });
    expect(legFormsOf([{}, null, "x"])).toEqual([]);
  });

  it("says a ticket's local time as a person reads it", () => {
    expect(localTimeLabel("2026-11-03T14:30")).toBe("03/11/2026 14:30");
    expect(localTimeLabel("2026-11-03")).toBe("03/11/2026");
    expect(localTimeLabel(null)).toBe("");
  });
});

describe("the words", () => {
  it("has words for every state, kind and filter", () => {
    for (const key of [
      ...Object.values(DOCUMENT_KIND_KEY),
      ...Object.values(CONSENT_KEY),
      ...Object.values(TRIP_STATE_KEY),
      ...Object.values(READING_KEY),
      ...Object.values(FILTER_KEY),
    ]) {
      expect(product[key], key).toBeTruthy();
    }
  });

  it("has words for every refusal it names, and a general one", () => {
    for (const code of [
      "second_factor_required",
      "partnership_ended",
      "invalid_cpf",
      "cpf_in_use",
      "holder_is_minor",
      "invalid_airport",
      "trip_locked",
      "no_consent_term",
      "wording_changed",
      "upload_limit",
      "draft",
      "not_draft",
      "whatever",
    ]) {
      expect(product[paxErrorKey(code)], code).toBeTruthy();
    }
    expect(paxErrorKey("whatever")).toBe("pax-error-failed");
    for (const code of ["image_unreadable", "provider_not_configured", null]) {
      expect(product[readingErrorKey(code)]).toBeTruthy();
    }
  });
});
