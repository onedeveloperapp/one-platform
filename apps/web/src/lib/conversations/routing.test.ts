import { describe, expect, it } from "vitest";

import {
  type Attendance,
  attendanceOf,
  greetingText,
  type LawAreaInfo,
  listOf,
  notAttendedText,
  ownAreaKey,
  personReason,
  routeInput,
  routeOf,
  type RouteReading,
  routeReadingOf,
  routeStateOf,
} from "@/lib/conversations/routing";
import { eventWords, type ThreadEvent, TOLD_WAYS } from "@/lib/whatsapp/conversations";

const LAW: LawAreaInfo[] = [
  { key: "passageiro", name: "Direito do Passageiro", covers: "voo cancelado" },
  { key: "familia", name: "Família e sucessões", covers: "divórcio" },
  { key: "trabalhista", name: "Trabalhista", covers: "demissão" },
];

const FAMILY = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  lawArea: "familia",
  name: "Família e sucessões",
  scriptId: null,
};
const AGRO = {
  id: "e5f6a7b8-0000-4000-8000-000000000002",
  lawArea: null,
  name: "Direito do agronegócio",
  scriptId: null,
};

const firm = (over: Partial<Attendance> = {}): Attendance => ({
  attends: true,
  declared: true,
  areas: [{ id: "p", lawArea: "passageiro", name: "Direito do Passageiro", scriptId: null }, FAMILY, AGRO],
  modules: ["direito-do-passageiro"],
  ...over,
});

const read = (over: Partial<RouteReading>): RouteReading => ({
  subject: "area",
  area: null,
  summary: null,
  sure: true,
  ...over,
});

const FRESH = { greeted: false, asked: null };

describe("routeOf", () => {
  it("lets a person answer while ONE does not attend for the firm, whatever was written", () => {
    expect(routeOf(read({ area: "passageiro" }), firm({ attends: false }), FRESH, LAW)).toEqual({ way: "closed" });
  });

  it("takes a subject of an area with its script published to the script's triage (0274)", () => {
    const scripted = { ...FAMILY, scriptId: "c2730000-0000-4000-8000-000000000001" };
    expect(routeOf(read({ area: "familia" }), firm({ areas: [scripted, AGRO] }), FRESH, LAW)).toEqual({
      way: "area",
      area: scripted,
    });
    // With no script published, ONE asks once what the person needs and a person continues, as before.
    expect(routeOf(read({ area: "familia" }), firm(), FRESH, LAW)).toMatchObject({ way: "ask", topic: "area" });
  });

  it("takes a problem with a flight to the passenger's intake only where the firm uses the module", () => {
    expect(routeOf(read({ area: "passageiro" }), firm(), FRESH, LAW)).toEqual({ way: "passenger" });
    const without = firm({ modules: [], areas: [FAMILY] });
    expect(routeOf(read({ area: "passageiro" }), without, FRESH, LAW)).toEqual({
      way: "decline",
      areaName: "Direito do Passageiro",
    });
  });

  it("asks once what the person needs in an area of the firm, then a person continues", () => {
    expect(routeOf(read({ area: "familia" }), firm(), FRESH, LAW)).toEqual({
      way: "ask",
      topic: "area",
      area: FAMILY,
      key: "familia",
    });
    expect(routeOf(read({ area: "familia" }), firm(), { greeted: false, asked: "familia" }, LAW)).toEqual({
      way: "person",
      topic: "area",
      area: FAMILY,
      summary: null,
    });
    expect(routeOf(read({ area: "familia", summary: "quer se divorciar" }), firm(), FRESH, LAW)).toEqual({
      way: "person",
      topic: "area",
      area: FAMILY,
      summary: "quer se divorciar",
    });
  });

  it("knows the firm's own areas by their key", () => {
    const route = routeOf(read({ area: ownAreaKey(AGRO), summary: "contrato de arrendamento" }), firm(), FRESH, LAW);
    expect(route).toMatchObject({ way: "person", area: AGRO });
  });

  it("refuses an area ONE knows that the firm said it does not work in, and leaves it to a person before it said", () => {
    expect(routeOf(read({ area: "trabalhista" }), firm(), FRESH, LAW)).toEqual({
      way: "decline",
      areaName: "Trabalhista",
    });
    expect(routeOf(read({ area: "trabalhista" }), firm({ declared: false }), FRESH, LAW)).toMatchObject({
      way: "ask",
      topic: "outra",
    });
  });

  it("asks once about a lawsuit that already runs", () => {
    expect(routeOf(read({ subject: "processo" }), firm(), FRESH, LAW)).toMatchObject({ way: "ask", topic: "processo" });
    expect(routeOf(read({ subject: "processo" }), firm(), { greeted: false, asked: "processo" }, LAW)).toMatchObject({
      way: "person",
      topic: "processo",
    });
  });

  it("greets once, and a second greeting goes to a person", () => {
    expect(routeOf(read({ subject: "cumprimento" }), firm(), FRESH, LAW)).toEqual({ way: "greet" });
    expect(routeOf(read({ subject: "cumprimento" }), firm(), { greeted: true, asked: null }, LAW)).toMatchObject({
      way: "person",
      topic: "greeted",
    });
  });

  it("sets aside what is surely nothing of a client, and gives a person anything the model was unsure of", () => {
    expect(routeOf(read({ subject: "nao_juridico" }), firm(), FRESH, LAW)).toEqual({ way: "aside" });
    expect(routeOf(read({ subject: "nao_juridico", sure: false }), firm(), FRESH, LAW)).toMatchObject({
      way: "person",
      topic: "unsure",
    });
    expect(routeOf(read({ area: "trabalhista", sure: false }), firm(), FRESH, LAW)).toMatchObject({
      way: "person",
      topic: "unsure",
    });
    expect(routeOf(null, firm(), FRESH, LAW)).toMatchObject({ way: "person", topic: "unsure" });
  });
});

describe("the readings", () => {
  it("reads the task's answer, the area only for an area, and never a mark as the summary", () => {
    expect(
      routeReadingOf({ assunto: "area", area: " Familia ", resumo: "quer  se divorciar", certeza: "alta" }),
    ).toEqual({ subject: "area", area: "familia", summary: "quer se divorciar", sure: true });
    expect(routeReadingOf({ assunto: "processo", area: "familia", resumo: "[nome 1]", certeza: "baixa" })).toEqual({
      subject: "processo",
      area: null,
      summary: null,
      sure: false,
    });
    expect(routeReadingOf({ assunto: "outro" })).toBeNull();
    expect(routeReadingOf(null)).toBeNull();
  });

  it("reads the firm's attendance and the routing's state", () => {
    expect(
      attendanceOf({
        ok: true,
        attends: true,
        declared: false,
        areas: [
          { id: "x", law_area: null, name: "Agro", script_id: "s1" },
          { id: "", name: "sem id" },
        ],
        modules: ["direito-do-passageiro", 3],
      }),
    ).toEqual({
      attends: true,
      declared: false,
      areas: [{ id: "x", lawArea: null, name: "Agro", scriptId: "s1" }],
      modules: ["direito-do-passageiro"],
    });
    expect(attendanceOf({ ok: false })).toBeNull();
    expect(routeStateOf({ greeted: true, asked: "familia" })).toEqual({ greeted: true, asked: "familia" });
    expect(routeStateOf(null)).toEqual({ greeted: false, asked: null });
  });

  it("hands the model the areas ONE knows and the firm's own, and the messages masked", () => {
    const input = routeInput(
      { firm: "Souza Advogados", messages: [{ author: "cliente", kind: "text", text: "oi", at: "" }] },
      firm(),
      LAW,
    );
    const areas = input.areas_do_direito as { chave: string }[];
    expect(areas.map((area) => area.chave)).toEqual(["passageiro", "familia", "trabalhista", ownAreaKey(AGRO)]);
    expect(input.mensagens).toEqual([{ quem: "cliente", tipo: "text", texto: "oi" }]);
  });
});

describe("what ONE writes", () => {
  it("greets with the firm's areas, and refuses without pointing anywhere", () => {
    expect(listOf(["A", "B", "C"])).toBe("A, B e C");
    expect(greetingText("Souza", ["Família e sucessões", "Trabalhista"])).toBe(
      "Oi, aqui é o assistente virtual do escritório Souza. O escritório cuida de Família e sucessões e Trabalhista. Me conta em poucas palavras como posso ajudar.",
    );
    expect(greetingText("", [])).toBe(
      "Oi, aqui é o assistente virtual do escritório. Me conta em poucas palavras como posso ajudar.",
    );
    expect(notAttendedText("Trabalhista")).not.toMatch(/outro escritório|indic/i);
  });

  it("tells the team the way, the area and what the person needs", () => {
    expect(personReason({ way: "person", topic: "area", area: FAMILY, summary: "quer se divorciar" })).toBe(
      "Contato novo de Família e sucessões. O que a pessoa precisa: quer se divorciar",
    );
    expect(personReason({ way: "closed" })).toMatch(/setup/);
  });

  it("writes no dash and no exclamation mark", () => {
    const words = [
      greetingText("Souza", ["Família"]),
      notAttendedText("Trabalhista"),
      personReason({ way: "aside" }),
      personReason({ way: "decline", areaName: "Trabalhista" }),
    ].join(" ");
    expect(words).not.toMatch(/[—–!]/);
  });
});

describe("the thread's words of a new contact's way", () => {
  const event = (kind: string, way: string | null, reason: string | null): ThreadEvent => ({
    id: "e",
    kind,
    at: "",
    momentLabel: "",
    caseId: null,
    seq: null,
    reason,
    actorName: null,
    fromPhone: false,
    paper: null,
    way,
  });

  it("tells each way the thread shows, and the conversation set aside with its reason", () => {
    expect(eventWords(event("routed", "greet", null)).key).toBe("inbox-event-routed-greet");
    expect(eventWords(event("routed", "ask", "Família e sucessões"))).toEqual({
      key: "inbox-event-routed-ask-area",
      values: { area: "Família e sucessões" },
    });
    expect(eventWords(event("routed", "decline", "Trabalhista")).values).toEqual({ area: "Trabalhista" });
    expect(eventWords(event("routed", "closed", null)).key).toBe("inbox-event-routed-closed");
    expect(eventWords(event("set_aside", null, "Propaganda")).values).toEqual({ reason: "Propaganda" });
    // A person called and a conversation set aside are told by their own events.
    expect(TOLD_WAYS).not.toContain("person");
    expect(TOLD_WAYS).not.toContain("aside");
  });
});
