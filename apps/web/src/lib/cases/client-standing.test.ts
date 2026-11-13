import { describe, expect, it } from "vitest";

import type { ClientLinkView, ClientTasks } from "@/lib/cases/client-link";
import { clientStanding } from "@/lib/cases/client-standing";

type OpenView = Extract<ClientLinkView, { state: "open" }>;

// Every person here is invented.
const ana = {
  person_id: "pe1",
  party_id: "pa1",
  party_ids: ["pa1"],
  full_name: "Ana Teste",
  cpf: "52998224725",
  birth_date: "1985-04-02",
  nationality: "brasileira",
  marital_status: "solteira",
  profession: "professora",
  email: null,
  phone: "62999990000",
  postal_code: "74000000",
  street: "Rua das Flores",
  address_number: "10",
  complement: null,
  district: "Centro",
  city: "Goiânia",
  uf: "GO",
  roles: ["claimant"],
  is_holder: true,
};

const view = (more: Partial<OpenView> = {}, caseMore: Partial<OpenView["case"]> = {}): OpenView => ({
  state: "open",
  firm: "Escritório Teste",
  link: { person_id: "pe1", expires_at: "2026-12-03T12:00:00Z", finished_at: null, uploads_left: 30 },
  case: { seq: 128, incident: "cancellation", flight_date: "2026-10-20", airline: null, editable: true, ...caseMore },
  people: [ana],
  segments: [],
  documents: [],
  required_documents: [{ kind: "identity", per: "claimant" }],
  ...more,
});

const tasks = (more: Partial<ClientTasks> = {}): ClientTasks => ({
  account: null,
  signatures: [],
  terms: [],
  statements: [],
  course: [],
  notices: null,
  civilCourt: null,
  agency: null,
  interview: null,
  priorComplaint: null,
  pieceFacts: [],
  judgments: [],
  publicationNews: [],
  residence: [],
  freeJustice: null,
  ...more,
});

const segment = {
  id: "s1",
  position: 1,
  flight_number: "XX1234",
  origin_iata: "GYN",
  destination_iata: "GRU",
  scheduled_departure_local: null,
  scheduled_arrival_local: null,
  actual_departure_local: null,
  actual_arrival_local: null,
  booking_reference: null,
  affected: true,
  source: "document",
};
const accepted = (id: string, kind: string) => ({
  id,
  kind,
  party_id: "pa1",
  status: "accepted" as const,
  rejected_reason: null,
  name: `${kind}.pdf`,
  created_at: "2026-11-01T12:00:00Z",
});
const signature = (status: "pending" | "signed", signedAt: string | null) => ({
  id: `sig-${status}`,
  method: "zapsign" as const,
  status,
  kind: "procuracao",
  name: "Procuração",
  sign_url: null,
  signed_at: signedAt,
  enotariado_url: null,
});
const lawsuit = (status: "filed" | "closed", filedAt: string) => ({
  id: `l-${filedAt}`,
  kind: "juizado",
  court: "TJGO",
  comarca: "Goiânia",
  cnj: "00051016820998090051",
  status,
  filed_at: filedAt,
  time_zone: "America/Sao_Paulo",
  next_hearing: null,
  movements: [],
});

describe("where a client's case stands on their link", () => {
  it("asks the steps in the order of the case, each counted, and the head counts the same steps", () => {
    const standing = clientStanding(
      view(),
      tasks({
        signatures: [signature("pending", null)],
        account: "missing",
        terms: [{ id: "t1", slug: "dados", version: 1, title: "Uso dos dados", body_md: "", accepted_at: null }],
      }),
      "2026-11-13",
    );
    expect(standing.steps.map((step) => [step.key, step.count])).toEqual([
      ["sign", 1],
      ["documents", 1],
      ["data", 1],
      ["account", 1],
      ["answers", 1],
      ["finish", 1],
    ]);
    expect(standing.steps.find((step) => step.key === "data")?.trip).toBe(true);
    expect(standing.steps.find((step) => step.key === "answers")?.answers).toEqual(["terms"]);
    expect(standing).toMatchObject({ stage: "papers", turn: "client", since: null });
  });

  it("asks a person's data when a field is missing, and none once complete", () => {
    const short = { ...ana, profession: null };
    const owed = clientStanding(view({ people: [short], segments: [segment] }), tasks(), "2026-11-13");
    expect(owed.steps.find((step) => step.key === "data")).toMatchObject({ count: 1, trip: false });
    const complete = clientStanding(view({ segments: [segment] }), tasks(), "2026-11-13");
    expect(complete.steps.some((step) => step.key === "data")).toBe(false);
    expect(complete.done).toEqual(expect.arrayContaining(["data", "trip"]));
  });

  it("says what was sent, given and answered as done, never as a step", () => {
    const standing = clientStanding(
      view({ documents: [accepted("d1", "identity")], segments: [segment] }, {}),
      tasks({
        signatures: [signature("signed", "2026-10-14T12:00:00Z")],
        terms: [
          {
            id: "t1",
            slug: "dados",
            version: 1,
            title: "Uso dos dados",
            body_md: "",
            accepted_at: "2026-10-04T12:00:00Z",
          },
        ],
        pieceFacts: [{ id: "f1", kind: "juizado", facts: "Os fatos", status: "confirmed", note: null }],
      }),
      "2026-11-13",
    );
    expect(standing.steps.map((step) => step.key)).toEqual(["finish"]);
    expect(standing.done).toEqual(["sign", "pieceFacts", "documents", "data", "trip", "terms"]);
  });

  it("is the firm's turn once the client finished, from that day, and the signature's while a paper waits", () => {
    const finished = { ...view({ documents: [accepted("d1", "identity")], segments: [segment] }) };
    finished.link = { ...finished.link, finished_at: "2026-11-10T12:00:00Z" };
    const preparing = clientStanding(finished, tasks(), "2026-11-13");
    expect(preparing).toMatchObject({ stage: "signature", turn: "firm", since: "2026-11-10T12:00:00Z" });
    expect(preparing.done).toContain("finish");

    const signing = clientStanding(finished, tasks({ signatures: [signature("pending", null)] }), "2026-11-13");
    expect(signing).toMatchObject({ stage: "signature", turn: "client" });
    expect(signing.steps.map((step) => step.key)).toEqual(["sign"]);

    const signed = clientStanding(
      finished,
      tasks({ signatures: [signature("signed", "2026-11-12T12:00:00Z")] }),
      "2026-11-13",
    );
    expect(signed).toMatchObject({ stage: "action", turn: "firm" });
  });

  it("asks nothing of the papers once the case is locked, and is the court's from the first lawsuit filed", () => {
    const locked = view({ documents: [accepted("d1", "identity")], segments: [segment] }, { editable: false });
    const court = clientStanding(
      locked,
      tasks({ course: [lawsuit("filed", "2026-10-24"), lawsuit("filed", "2026-10-20")] }),
      "2026-11-13",
    );
    expect(court).toMatchObject({ stage: "court", turn: "court", since: "2026-10-20", steps: [] });

    const asked = clientStanding(
      locked,
      tasks({
        course: [lawsuit("filed", "2026-10-24")],
        judgments: [
          {
            id: "j1",
            kind: "juizado",
            result: "procedente",
            cents: 500000,
            freeJustice: false,
            agrees: null,
            decision: null,
          },
        ],
      }),
      "2026-11-13",
    );
    expect(asked.steps).toEqual([{ key: "answers", count: 1, answers: ["judgments"] }]);
    expect(asked.turn).toBe("client");

    const closed = clientStanding(locked, tasks({ course: [lawsuit("closed", "2026-10-24")] }), "2026-11-13");
    expect(closed).toMatchObject({ stage: "result", turn: "closed" });
  });

  it("counts every answer the firm asks under one step, in its order", () => {
    const standing = clientStanding(
      view({ documents: [accepted("d1", "identity")], segments: [segment] }),
      tasks({
        civilCourt: [
          {
            party_id: "pa1",
            name: "Ana Teste",
            minor: false,
            wording: "Aceito",
            accepted: null,
            recorded_at: null,
            source: null,
          },
        ],
        freeJustice: {
          items: [
            { partyId: "pa1", name: "Ana Teste", minor: false, asks: null, recordedAt: null, appeal: false },
            { partyId: "pa2", name: "Pedro Teste", minor: true, asks: true, recordedAt: "2026-11-01", appeal: false },
          ],
          issued: false,
          income: false,
          ownParty: "pa1",
        },
        residence: [
          {
            id: "r1",
            holder: "Maria Teste",
            city: "Goiânia",
            relation: null,
            note: null,
            answered_at: null,
            issued: false,
          },
        ],
      }),
      "2026-11-13",
    );
    expect(standing.steps.find((step) => step.key === "answers")).toEqual({
      key: "answers",
      count: 3,
      answers: ["civilCourt", "freeJustice", "residence"],
    });
  });
});
