import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  agendaAddress,
  eventOf,
  HEARING_KINDS,
  HEARING_MODES,
  HEARING_OUTCOMES,
  HEARING_STATUSES,
  HEARING_VIEWS,
  HEARING_ZONES,
  hearingErrorKey,
  type HearingToSync,
  KIND_KEY,
  lastAgendaPage,
  MODE_KEY,
  momentIn,
  OUTCOME_KEY,
  OUTCOME_SAID_KEY,
  startingZone,
  STATUS_KEY,
  VIEW_KEY,
  ZONE_KEY,
} from "@/lib/hearings/hearings";
import { isEventId } from "@flyee/calendar/event-id";
import messages from "@flyee/content/messages/pt-BR.json";

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0037_hearings.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The values a check constraint of migration 0037 allows, in its order. */
function allowed(constraint: string): string[] {
  const start = MIGRATION.indexOf(`constraint ${constraint} check`);
  expect(start, constraint).toBeGreaterThan(-1);
  const list = /in \(([^)]+)\)/.exec(MIGRATION.slice(start));
  return [...(list?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe("what the code says matches what the database keeps", () => {
  it("lists the kinds, the ways, the states and the outcomes as the table does", () => {
    expect([...HEARING_KINDS]).toEqual(allowed("hearings_kind_check"));
    expect([...HEARING_MODES]).toEqual(allowed("hearings_mode_check"));
    expect([...HEARING_STATUSES]).toEqual(allowed("hearings_status_check"));
    expect([...HEARING_OUTCOMES]).toEqual(allowed("hearings_outcome_check"));
  });

  it("asks the database for the lists it has, and says a hearing in the zones it takes", () => {
    const body = /create or replace function public\.firm_hearings[\s\S]*?\$\$;/.exec(MIGRATION)?.[0] ?? "";
    for (const view of HEARING_VIEWS) expect(body, view).toContain(`'${view}'`);
    const zones = /create or replace function public\.hearing_zone_ok[\s\S]*?\$\$;/.exec(MIGRATION)?.[0] ?? "";
    const taken = [...zones.matchAll(/'(America\/[A-Za-z_]+)'/g)].map((match) => match[1]);
    expect([...HEARING_ZONES].sort()).toEqual(taken.sort());
  });

  it("has words for every kind, way, state, outcome, list, zone and refusal", () => {
    const keys = [
      ...Object.values(KIND_KEY),
      ...Object.values(MODE_KEY),
      ...Object.values(STATUS_KEY),
      ...Object.values(OUTCOME_KEY),
      ...Object.values(OUTCOME_SAID_KEY),
      ...Object.values(ZONE_KEY),
      ...Object.values(VIEW_KEY).flatMap((view) => Object.values(view)),
      ...[
        "not_found",
        "not_allowed",
        "not_allowed_in_support_session",
        "not_filed",
        "duplicate",
        "closed",
        "reason_required",
        "zone_required",
        "invalid_data",
        "anything else",
        null,
      ].map(hearingErrorKey),
    ];
    for (const key of keys) expect(product[key], key).toBeTruthy();
  });
});

describe("how a hearing is said", () => {
  it("says a moment in the zone of the hearing", () => {
    // 17h of UTC: 14h in Brasília, 13h in Manaus, 12h in Acre.
    const at = "2026-11-10T17:00:00.000Z";
    expect(momentIn(at, "America/Sao_Paulo")).toEqual({
      day: "10/11/2026",
      weekday: "terça-feira",
      time: "14:00",
      isoDay: "2026-11-10",
      isoTime: "14:00",
    });
    expect(momentIn(at, "America/Manaus").time).toBe("13:00");
    expect(momentIn(at, "America/Rio_Branco").time).toBe("12:00");
    // A late hearing in Acre is still the day before in Brasília's UTC midnight terms: its own day is kept.
    expect(momentIn("2026-11-11T02:30:00.000Z", "America/Rio_Branco").isoDay).toBe("2026-11-10");
  });

  it("starts a new hearing on the court's zone only when the court has one", () => {
    expect(startingZone({ seat: "America/Sao_Paulo", others: [] })).toBe("America/Sao_Paulo");
    expect(startingZone({ seat: "America/Manaus", others: [] })).toBe("America/Manaus");
    // Amazonas keeps the Acre time in some comarcas: the person says which.
    expect(startingZone({ seat: "America/Manaus", others: ["America/Eirunepe"] })).toBe("");
    expect(startingZone(null)).toBe("");
    // The zones a court keeps are the ones the database lists.
    const courts = /update public\.courts set other_zones = case uf([\s\S]*?)end/.exec(MIGRATION)?.[1] ?? "";
    expect([...courts.matchAll(/'(America\/[A-Za-z_]+)'/g)].map((match) => match[1])).toEqual([
      "America/Eirunepe",
      "America/Noronha",
    ]);
  });

  it("writes the address of a list and its page, the first ones saying nothing", () => {
    expect(agendaAddress("proximas", 0)).toBe("/agenda");
    expect(agendaAddress("sem_resultado", 0)).toBe("/agenda?ver=sem_resultado");
    expect(agendaAddress("realizadas", 2)).toBe("/agenda?ver=realizadas&pagina=3");
    expect(lastAgendaPage(0)).toBe(0);
    expect(lastAgendaPage(26)).toBe(1);
  });
});

describe("the event a hearing becomes in the firm's calendar", () => {
  const read: HearingToSync = {
    id: "5a1c0b7e-3d2f-4e8a-9b6c-0123456789ab",
    org_id: "o",
    claim: 1,
    revision: 2,
    status: "scheduled",
    kind: "conciliacao",
    starts_at: "2026-11-10T17:00:00+00:00",
    time_zone: "America/Sao_Paulo",
    duration_minutes: 60,
    mode: "videoconferencia",
    place: null,
    link: "https://videoconferencia.invalid/sala-7",
    attendee: "Ana Souza",
    outcome: null,
    case_id: "c1",
    case_seq: 12,
    cnj: "50004016120998090051",
    court: "TJGO",
    comarca: "Goiânia",
    unit: null,
    calendar_id: "agenda-1@group.calendar.invalid",
    connection_id: "k1",
    synced_calendar: null,
  };

  it("says what it is, of which case, when, how and who goes, and leads to the case, naming nobody of the case", () => {
    const event = eventOf(read, "https://app.one.invalid/");
    expect(isEventId(event.id)).toBe(true);
    expect(event.summary).toBe("Audiência de conciliação · Caso 12");
    expect(event.start).toBe("2026-11-10T17:00:00.000Z");
    expect(event.end).toBe("2026-11-10T18:00:00.000Z");
    expect(event.timeZone).toBe("America/Sao_Paulo");
    expect(event.location).toBe("https://videoconferencia.invalid/sala-7");
    expect(event.sourceUrl).toBe("https://app.one.invalid/casos/c1");
    expect(event.description).toContain("Processo 5000401-61.2099.8.09.0051 · TJGO · Goiânia");
    expect(event.description).toContain("Quem vai: Ana Souza");
    expect(event.description).not.toMatch(/[—–!]/);
    expect(`${event.summary} ${event.description}`).not.toContain("Maria");
  });

  it("says a hearing held, and with what came of it", () => {
    expect(eventOf({ ...read, status: "held", outcome: "acordo" }, "https://app.one.invalid").summary).toBe(
      "Realizada com acordo: Audiência de conciliação · Caso 12",
    );
    expect(eventOf({ ...read, status: "held", outcome: null }, "https://app.one.invalid").summary).toBe(
      "Realizada: Audiência de conciliação · Caso 12",
    );
  });
});
