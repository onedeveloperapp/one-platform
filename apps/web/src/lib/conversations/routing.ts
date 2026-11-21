import { maskIdentifiers } from "@/lib/cases/drafts";
import type { TurnContext } from "@/lib/conversations/agent";

/**
 * The way a new contact on the firm's WhatsApp goes (migration 0257, the first phase of the plan "o escritório
 * preparado antes do primeiro atendimento", the owner, 2026-11-20): somebody who writes with no alert of ONE's and no
 * case goes the way of what they write about, among six, and nothing of it is the model's to decide. The task
 * `atendimento.assunto` only reads the subject (an area of law, a lawsuit the firm already carries, a greeting, nothing
 * of a client) and what the person needs; these rules choose the way, and ONE's words are the firm's (0191).
 *
 *   - A problem with a flight, where the firm uses the passenger module: the passenger's intake, as before.
 *   - An area the firm works in: ONE asks once what the person needs, and a person of the firm continues with it.
 *   - An area ONE knows that the firm said it does not work in: a kind refusal, never pointing to another firm
 *     (decision 3), and the conversation stays with the team, with no urgency.
 *   - A lawsuit that already runs: as an area, ONE asks once and a person continues.
 *   - Only a greeting: ONE says who it is and the firm's areas, and asks the subject, once.
 *   - Nothing of a client (advertising, a supplier, a wrong number): no answer, and the team sees it with no urgency.
 *
 * Until the firm said its operation (0256) ONE answers nobody new, and a person of the firm does (decision 2), unless
 * ONE already attended for the firm before. Whatever the model was unsure of goes to a person, never to a refusal.
 * Pure.
 */

export const ROUTE_TASK = "atendimento.assunto";

/** The module whose intake takes a problem with a flight (0068). */
export const PASSENGER_MODULE = "direito-do-passageiro";
/** The area of law of a problem with a flight (0256). */
export const PASSENGER_AREA = "passageiro";

/** An area of the firm; one of its own with the script in force (0274), which takes its contacts in by the script. */
export type FirmArea = { id: string; lawArea: string | null; name: string; scriptId: string | null };

/** What the routing reads of the firm (`firm_attendance`). */
export type Attendance = { attends: boolean; declared: boolean; areas: FirmArea[]; modules: string[] };

/** An area of law ONE knows (`law_areas`). */
export type LawAreaInfo = { key: string; name: string; covers: string };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function attendanceOf(raw: unknown): Attendance | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.ok !== true) return null;
  const areas = Array.isArray(row.areas) ? row.areas : [];
  return {
    attends: row.attends === true,
    declared: row.declared === true,
    areas: areas
      .filter((area): area is Record<string, unknown> => typeof area === "object" && area !== null)
      .filter((area) => text(area.id) && text(area.name))
      .map((area) => ({
        id: text(area.id),
        lawArea: text(area.law_area) || null,
        name: text(area.name),
        scriptId: text(area.script_id) || null,
      })),
    modules: Array.isArray(row.modules) ? row.modules.filter((key): key is string => typeof key === "string") : [],
  };
}

export type RouteSubject = "area" | "processo" | "cumprimento" | "nao_juridico";

/** What the task read. */
export type RouteReading = { subject: RouteSubject; area: string | null; summary: string | null; sure: boolean };

const SUBJECTS: readonly RouteSubject[] = ["area", "processo", "cumprimento", "nao_juridico"];

export function routeReadingOf(raw: unknown): RouteReading | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (!SUBJECTS.includes(row.assunto as RouteSubject)) return null;
  const subject = row.assunto as RouteSubject;
  const summary = text(row.resumo).replace(/\s+/g, " ").slice(0, 400);
  return {
    subject,
    area: subject === "area" ? text(row.area).toLowerCase() || null : null,
    // A mark of a masked identifier is the masking's, never the person's words.
    summary: summary && !/^\[[a-z]+ \d+\]$/i.test(summary) ? summary : null,
    sure: row.certeza === "alta",
  };
}

/** Where the routing of a conversation stands: whether ONE greeted, and what it asked a summary for. */
export type RouteState = { greeted: boolean; asked: string | null };

export function routeStateOf(raw: unknown): RouteState {
  const row = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { greeted: row.greeted === true, asked: text(row.asked) || null };
}

/** The key the model reads one of the firm's own areas by (one ONE does not know). */
export const ownAreaKey = (area: FirmArea): string => `propria-${area.id.replace(/-/g, "").slice(0, 8)}`;

/** The key an area of the firm is asked about by. */
const areaKey = (area: FirmArea): string => area.lawArea ?? ownAreaKey(area);

/** What the task reads: the firm, the areas of law ONE knows and the firm's own, and the conversation. */
export function routeInput(
  context: Pick<TurnContext, "firm" | "messages">,
  firm: Attendance,
  lawAreas: readonly LawAreaInfo[],
): Record<string, unknown> {
  return {
    escritorio: context.firm,
    areas_do_direito: [
      ...lawAreas.map((area) => ({ chave: area.key, nome: area.name, cobre: area.covers })),
      ...firm.areas
        .filter((area) => area.lawArea === null)
        .map((area) => ({ chave: ownAreaKey(area), nome: area.name, cobre: "" })),
    ],
    mensagens: context.messages.map((message) => ({
      quem: message.author,
      tipo: message.kind,
      texto: maskIdentifiers(message.text).slice(0, 2000),
    })),
  };
}

export type PersonTopic = "area" | "processo" | "outra" | "unsure" | "greeted";

export type Route =
  /** ONE does not attend for the firm yet: a person answers, and ONE says nothing. */
  | { way: "closed" }
  | { way: "passenger" }
  /** An area of the firm with its script published: the script's triage takes the contact in (0274). */
  | { way: "area"; area: FirmArea }
  | { way: "greet" }
  /** One question for what the person needs, before a person continues. */
  | { way: "ask"; topic: "area" | "processo" | "outra"; area: FirmArea | null; key: string }
  | { way: "person"; topic: PersonTopic; area: FirmArea | null; summary: string | null }
  | { way: "decline"; areaName: string }
  | { way: "aside" };

/** The way a new contact goes. */
export function routeOf(
  reading: RouteReading | null,
  firm: Attendance,
  state: RouteState,
  lawAreas: readonly LawAreaInfo[],
): Route {
  if (!firm.attends) return { way: "closed" };
  if (!reading) return { way: "person", topic: "unsure", area: null, summary: null };
  const summary = reading.summary;
  if (reading.subject === "nao_juridico") {
    return reading.sure ? { way: "aside" } : { way: "person", topic: "unsure", area: null, summary };
  }
  if (reading.subject === "cumprimento") {
    return state.greeted ? { way: "person", topic: "greeted", area: null, summary } : { way: "greet" };
  }
  if (!reading.sure) return { way: "person", topic: "unsure", area: null, summary };
  // Asked once: the answer, or none, goes to a person.
  const askOrPerson = (topic: "area" | "processo" | "outra", area: FirmArea | null, key: string): Route =>
    summary || state.asked === key ? { way: "person", topic, area, summary } : { way: "ask", topic, area, key };
  if (reading.subject === "processo") return askOrPerson("processo", null, "processo");

  const key = reading.area ?? "outra";
  if (key === PASSENGER_AREA && firm.modules.includes(PASSENGER_MODULE)) return { way: "passenger" };
  const area = firm.areas.find((candidate) => areaKey(candidate) === key) ?? null;
  if (area?.scriptId) return { way: "area", area };
  if (area) return askOrPerson("area", area, key);
  const known = lawAreas.find((candidate) => candidate.key === key);
  // An area ONE knows that the firm, having said its areas, does not work in; before it said them, a person decides.
  if (known && firm.declared) return { way: "decline", areaName: known.name };
  return askOrPerson("outra", null, key);
}

// ---------- What ONE writes, and what the team reads ----------

/** "A", "A e B", "A, B e C". */
export function listOf(names: readonly string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} e ${clean[clean.length - 1]}`;
}

/** ONE's greeting, with the firm's areas, before it asks the subject. */
export function greetingText(firm: string, areas: readonly string[]): string {
  const who = firm.trim() ? `do escritório ${firm.trim()}` : "do escritório";
  const cares = areas.length > 0 ? ` O escritório cuida de ${listOf(areas)}.` : "";
  return `Oi, aqui é o assistente virtual ${who}.${cares} Me conta em poucas palavras como posso ajudar.`;
}

/** The one question for what the person needs, before a person of the firm continues. */
export function askSummaryText(): string {
  return "Para eu passar para a pessoa certa do escritório, me conta em poucas palavras o que aconteceu e o que você precisa.";
}

/** The kind refusal of an area the firm does not work in: never pointing to another firm. */
export function notAttendedText(areaName: string): string {
  return `Obrigado por escrever. O escritório não atende casos de ${areaName}, por isso não vamos poder ajudar com este assunto. Se tiver outra questão, é só escrever aqui.`;
}

/** What the team reads in the panel when a person continues: the way, the area and what the person needs. */
export function personReason(route: Extract<Route, { way: "person" | "closed" | "decline" | "aside" }>): string {
  if (route.way === "closed") {
    return "O ONE ainda não atende por este escritório: falta dizer no setup as áreas que ele atende. Uma pessoa responde.";
  }
  if (route.way === "decline")
    return `Área que o escritório não atende (${route.areaName}): o ONE recusou com cuidado.`;
  if (route.way === "aside")
    return "A mensagem não parece de um cliente (propaganda, fornecedor ou número errado): o ONE não respondeu.";
  const need = route.summary ? ` O que a pessoa precisa: ${route.summary}` : " A pessoa ainda não disse o que precisa.";
  switch (route.topic) {
    case "area":
      return `Contato novo de ${route.area?.name ?? "uma área do escritório"}.${need}`;
    case "processo":
      return `Pergunta sobre um processo que já corre.${need}`;
    case "outra":
      return `Contato novo de um assunto fora das áreas que o escritório disse.${need}`;
    case "greeted":
      return "A pessoa cumprimentou de novo sem dizer o assunto.";
    default:
      return `O ONE não teve certeza do assunto.${need}`;
  }
}
