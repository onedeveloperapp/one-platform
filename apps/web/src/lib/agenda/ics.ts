import {
  addDays,
  agendaEntries,
  type AgendaItems,
  type AgendaPerson,
  caseWords,
  entryCase,
  entryId,
  hearingCancelled,
  outsideName,
  zoneWords,
} from "./agenda";

/**
 * A person's calendar link (migration 0132) as an iCalendar file (RFC 5545), which the iPhone, Outlook and Google
 * subscribe to: each fatal and internal deadline a whole-day event, each hearing at its moment in UTC (so every
 * calendar shows it in its own zone, Manaus's included), a cancelled one kept as cancelled. An event names the act or
 * "Prazo" and the case's number, never anybody of the case. Pure.
 */

export type IcsEvent = {
  uid: string;
  summary: string;
  description: string | null;
  url: string | null;
  /** A whole day ("2026-11-12"), or a moment with its end (ISO). */
  when: { day: string } | { start: string; end: string };
  cancelled: boolean;
  stamp: string;
};

const escape = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const compactDay = (day: string): string => day.replace(/-/g, "");
const compactMoment = (moment: string): string =>
  new Date(moment)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

/** A content line folded at 75 octets, as the format asks (a fold never splits a character). */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += character;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function writeIcs(name: string, events: readonly IcsEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ONE//Agenda//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(name)}`,
    "X-WR-TIMEZONE:America/Sao_Paulo",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${escape(event.uid)}`, `DTSTAMP:${compactMoment(event.stamp)}`);
    if ("day" in event.when) {
      lines.push(
        `DTSTART;VALUE=DATE:${compactDay(event.when.day)}`,
        `DTEND;VALUE=DATE:${compactDay(addDays(event.when.day, 1))}`,
      );
      lines.push("TRANSP:TRANSPARENT");
    } else {
      lines.push(`DTSTART:${compactMoment(event.when.start)}`, `DTEND:${compactMoment(event.when.end)}`);
    }
    lines.push(`SUMMARY:${escape(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escape(event.description)}`);
    if (event.url) lines.push(`URL:${escape(event.url)}`);
    lines.push(`STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

const MODE_WORDS: Record<string, string> = {
  presencial: "Presencial",
  videoconferencia: "Por videoconferência",
  hibrida: "Presencial e por videoconferência",
};

/**
 * The events of a person's link: the items they answer for (or the whole firm's, for who reads it whole), from the
 * days the feed read. The address of the case in ONE goes in each event, and ONE and the e-mail of the morning are
 * what count: a calendar may take hours to show a change.
 */
export function agendaEvents(
  items: AgendaItems,
  person: AgendaPerson,
  range: { from: string; to: string },
  origin: string,
  now: Date,
): IcsEvent[] {
  const stamp = now.toISOString();
  return agendaEntries(items, person, range.from, range.to).map((entry): IcsEvent => {
    const { caseId, caseSeq: seq, cnj } = entryCase(entry);
    const url = caseId ? `${origin}/casos/${caseId}` : null;
    const summary = [outsideName(entry), caseWords(seq)].filter(Boolean).join(" · ");
    if (entry.kind === "hearing") {
      const start = entry.hearing.startsAt;
      const end = new Date(Date.parse(start) + items.durationMinutes * 60_000).toISOString();
      const zone = zoneWords(entry.hearing.timeZone);
      return {
        uid: `${entryId(entry).replace(":", "-")}@one-agenda`,
        summary,
        description: [
          cnj ? `Processo ${cnj}` : null,
          MODE_WORDS[entry.hearing.mode] ?? null,
          zone ? `No tribunal, ${entry.time} no ${zone}.` : null,
          url ? `Abra no ONE: ${url}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        url,
        when: { start, end },
        cancelled: hearingCancelled(entry.hearing),
        stamp,
      };
    }
    // A session at a known hour is an event of that hour; the limit to register says its hour in words (0219).
    if (entry.kind === "session" && entry.time) {
      const start = new Date(`${entry.day}T${entry.time}:00-03:00`).toISOString();
      const end = new Date(Date.parse(start) + items.durationMinutes * 60_000).toISOString();
      return {
        uid: `${entryId(entry).replace(":", "-")}@one-agenda`,
        summary,
        description: [cnj ? `Processo ${cnj}` : null, url ? `Abra no ONE: ${url}` : null].filter(Boolean).join("\n"),
        url,
        when: { start, end },
        cancelled: false,
        stamp,
      };
    }
    return {
      uid: `${entryId(entry).replace(":", "-")}@one-agenda`,
      summary,
      description: [
        cnj ? `Processo ${cnj}` : null,
        entry.kind === "oral" && entry.time ? `Até as ${entry.time}, no sistema do tribunal.` : null,
        url ? `Abra no ONE: ${url}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      url,
      when: { day: entry.day },
      cancelled: false,
      stamp,
    };
  });
}
