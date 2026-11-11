import { DOSSIER_ZONE_NAME, dossierMoment } from "@/lib/cases/dossier";

/**
 * The evidence kit of a case (migration 0209, M4 sprint S12), as the dossier lays it out: the legs' scheduled moments,
 * what ONE told the passenger of the flight, and each proof of the moment (a photo, a receipt, a boarding pass) with
 * the moment ONE received it by the platform's clock, how far that was from the scheduled departure, the moment the
 * photo says it was taken by its device's clock when it says one, and the file's fingerprint. Pure: the database gives
 * the instants; this file reads them and puts them in words, in the order they happened.
 */

export type KitLeg = {
  position: number;
  flight: string | null;
  origin: string | null;
  destination: string | null;
  affected: boolean;
  departureAt: string | null;
  arrivalAt: string | null;
  actualArrivalAt: string | null;
};

export type KitAlert = { kind: string; delayMinutes: number | null; sentAt: string };

export type KitProof = {
  id: string;
  kind: string;
  source: string;
  person: string | null;
  receivedAt: string;
  /** As the device wrote it, at its local time, and its offset when it wrote one. */
  takenLocal: string | null;
  takenOffset: string | null;
  sha256: string | null;
};

export type EvidenceKit = { legs: KitLeg[]; alerts: KitAlert[]; proofs: KitProof[] };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const isInstant = (value: string | null): value is string => value !== null && !Number.isNaN(Date.parse(value));
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : [];

/** The database's answer (`case_evidence_moments`), or null when it is no kit. */
export function readEvidenceKit(raw: unknown): EvidenceKit | null {
  const answer = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!answer || answer.ok !== true) return null;
  return {
    legs: rows(answer.legs).map((row) => ({
      position: typeof row.position === "number" ? row.position : 1,
      flight: text(row.flight),
      origin: text(row.origin),
      destination: text(row.destination),
      affected: row.affected === true,
      departureAt: text(row.departure_at),
      arrivalAt: text(row.arrival_at),
      actualArrivalAt: text(row.actual_arrival_at),
    })),
    alerts: rows(answer.alerts).flatMap((row) => {
      const sentAt = text(row.sent_at);
      return isInstant(sentAt)
        ? [
            {
              kind: String(row.kind ?? ""),
              delayMinutes: typeof row.delay_minutes === "number" ? row.delay_minutes : null,
              sentAt,
            },
          ]
        : [];
    }),
    proofs: rows(answer.proofs).flatMap((row) => {
      const receivedAt = text(row.received_at);
      const id = text(row.id);
      if (!id || !isInstant(receivedAt)) return [];
      return [
        {
          id,
          kind: String(row.kind ?? ""),
          source: String(row.source ?? ""),
          person: text(row.person),
          receivedAt,
          takenLocal: text(row.taken_local),
          takenOffset: text(row.taken_offset),
          sha256: text(row.sha256),
        },
      ];
    }),
  };
}

/** A flight as people write it: `LA 3456`. */
const flightWords = (flight: string | null): string =>
  flight ? `voo ${flight.replace(/^([A-Z0-9]{2})(\d)/, "$1 $2")}` : "voo sem número registrado";

/** A span of time in words: `2 horas e 5 minutos`, `3 dias`. */
export function spanWords(minutes: number): string {
  const whole = Math.round(Math.abs(minutes));
  if (whole >= 48 * 60) {
    const days = Math.round(whole / (24 * 60));
    return `${days} dias`;
  }
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const hourWords = hours === 1 ? "1 hora" : `${hours} horas`;
  const minuteWords = rest === 1 ? "1 minuto" : `${rest} minutos`;
  if (hours === 0) return minuteWords;
  if (rest === 0) return hourWords;
  return `${hourWords} e ${minuteWords}`;
}

const ALERT: Record<string, string> = {
  delayed: "o atraso",
  cancelled: "o cancelamento",
  changed: "a mudança do voo pela companhia",
};

const SOURCE: Record<string, string> = {
  client: "enviada pelo cliente no link do escritório",
  whatsapp: "enviada pelo cliente na conversa do WhatsApp",
  firm: "juntada por uma pessoa do escritório",
};

/** The instant a device's local moment stands for, when the device wrote its offset; null otherwise. */
export function takenInstant(local: string | null, offset: string | null): string | null {
  if (!local || !offset) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/.exec(local.slice(0, 19));
  if (!match || !/^[+-]\d{2}:\d{2}$/.test(offset)) return null;
  const at = Date.parse(`${match[1]}T${match[2]}${offset}`);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** What the file says of when it was made, in words. */
function takenWords(proof: KitProof): string {
  const instant = takenInstant(proof.takenLocal, proof.takenOffset);
  if (instant)
    return `a foto diz que foi tirada em ${dossierMoment(instant)} (${DOSSIER_ZONE_NAME}), pelo relógio do aparelho`;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(proof.takenLocal ?? "");
  if (match)
    return `a foto diz que foi tirada em ${match[3]}/${match[2]}/${match[1]} às ${match[4]}, na hora do aparelho`;
  return "o arquivo não diz quando foi feito";
}

type Event = { at: number; order: number; words: string };

/**
 * The kit as lines, in the order things happened: each leg's scheduled departure and arrival (and the arrival on
 * record), each word ONE sent about the flight, and each proof as it arrived. `kindWord` names a kind of document.
 */
export function evidenceTimeline(kit: EvidenceKit, kindWord: (kind: string) => string): string[] {
  const events: Event[] = [];
  const add = (instant: string | null, order: number, words: string) => {
    if (isInstant(instant)) events.push({ at: Date.parse(instant), order, words });
  };
  const legs = [...kit.legs].sort((a, b) => a.position - b.position);
  for (const leg of legs) {
    const route = leg.origin && leg.destination ? ` de ${leg.origin} para ${leg.destination}` : "";
    add(leg.departureAt, 0, `partida prevista do ${flightWords(leg.flight)}${route}`);
    add(
      leg.arrivalAt,
      1,
      `chegada prevista do ${flightWords(leg.flight)}${leg.destination ? ` a ${leg.destination}` : ""}`,
    );
    add(leg.actualArrivalAt, 2, `chegada registrada no caso do ${flightWords(leg.flight)}`);
  }
  for (const alert of kit.alerts) {
    const what = ALERT[alert.kind] ?? "um problema no voo";
    const late =
      alert.kind === "delayed" && alert.delayMinutes ? `, de ${spanWords(alert.delayMinutes)} na chegada` : "";
    add(alert.sentAt, 3, `o ONE avisou o passageiro pelo WhatsApp sobre ${what}${late}`);
  }
  // Each proof is said against the departure of the leg the problem was on, or of the first leg.
  const reference =
    legs.find((leg) => leg.affected && isInstant(leg.departureAt)) ?? legs.find((leg) => isInstant(leg.departureAt));
  for (const proof of kit.proofs) {
    const parts = [`chegou ao ONE ${kindWord(proof.kind).toLowerCase()}${proof.person ? ` de ${proof.person}` : ""}`];
    parts.push(SOURCE[proof.source] ?? "enviada ao escritório");
    if (reference?.departureAt) {
      const minutes = (Date.parse(proof.receivedAt) - Date.parse(reference.departureAt)) / 60_000;
      const when =
        Math.abs(minutes) < 1
          ? "no minuto da partida prevista"
          : `${spanWords(minutes)} ${minutes > 0 ? "depois" : "antes"} da partida prevista do ${flightWords(reference.flight)}`;
      parts.push(when);
    }
    parts.push(takenWords(proof));
    parts.push(
      proof.sha256 ? `impressão digital do arquivo ${proof.sha256.slice(0, 16)}` : "sem impressão digital registrada",
    );
    add(proof.receivedAt, 4, parts.join(", "));
  }
  return events
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((event) => `${dossierMoment(new Date(event.at).toISOString())}: ${event.words}`);
}
