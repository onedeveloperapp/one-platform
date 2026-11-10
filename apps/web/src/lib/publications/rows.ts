import type { PublicationRow } from "@/lib/publications/facts";
import type { Said } from "@/lib/publications/list-state";
import type { PublicationCategory } from "@/lib/publications/publications";
import { readingOnCard } from "@/lib/publications/reading-words";

/**
 * Where a publication of a case stands, as its line says it (the owner's canvas "ONE · Publicações no caso",
 * 2026-11-10): what asks the person's action (`ask`), what ONE is doing (`working`) and what is settled (`done`),
 * the words of its state with their values, and the one thing the line offers: the awareness given in place
 * (`ack`), or the publication to open (`open`). Pure: the card of the case reads it, a test keeps it.
 */
export type PublicationPlace = "ask" | "working" | "done";

export type PublicationLine = {
  place: PublicationPlace;
  tone: "attention" | "waiting" | "done" | "info";
  key: string;
  values: Record<string, string>;
  action: "ack" | "open" | null;
};

/** What the screen knows of a publication beyond its row: what the person said of it since it was read. */
export type PublicationSeen = {
  said: Said | null;
  /** The person said they saw its cancelling. */
  seenCancel: boolean;
  /** The person said they are aware of ONE's triage. */
  acked: boolean;
};

/** A day as the line says it: 07/11. */
export const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** A moment in a zone, as the line says it: 20/11 and 14:00. */
function momentOf(at: string, timeZone: string): { day: string; time: string } {
  const date = new Date(at);
  const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
  return { day, time };
}

export function publicationLine(row: PublicationRow, seen: PublicationSeen): PublicationLine {
  const line = (
    place: PublicationPlace,
    tone: PublicationLine["tone"],
    key: string,
    action: PublicationLine["action"] = null,
    values: Record<string, string> = {},
  ): PublicationLine => ({ place, tone, key, values, action });

  // A publication the court cancelled: seen, it is settled; unseen after a triage, the firm says it saw it.
  if (!row.active) {
    return row.cancelUnseen && !seen.seenCancel
      ? line("ask", "attention", "case-rows-pub-cancelled-unseen", "open")
      : line("done", "info", "case-rows-pub-cancelled");
  }

  const category: PublicationCategory | null = seen.said ? seen.said.category : row.category;
  if (category === null) {
    return row.triageState === "working"
      ? line("working", "waiting", "case-rows-pub-triaging")
      : line(
          "ask",
          "attention",
          row.triageState === "left" ? "case-rows-pub-untriaged-left" : "case-rows-pub-untriaged",
          "open",
        );
  }

  // ONE triaged it: the awareness the lawyer owes, given in place.
  if (row.ackOwed && !seen.acked && !seen.said) {
    return row.lawyers.length > 0
      ? line("ask", "attention", "case-rows-pub-ack", "ack", { names: row.lawyers.join(", ") })
      : line("ask", "attention", "case-rows-pub-ack-anyone", "ack");
  }
  // The AI's triage of a category let out of the shadow, waiting for a person's check (0035).
  if (row.byAi && row.reviewDue && !seen.said) return line("ask", "attention", "case-rows-pub-review", "open");
  // A decision nobody could tell is the judgment (0096).
  if (category === "decisao" && row.judgment === null)
    return line("ask", "attention", "case-rows-pub-judgment", "open");

  // What ONE reads of it (0040): reading, or left to a person and not done since.
  const reading = readingOnCard(category, row.readings, seen.said?.reading ?? null, seen.said?.at, undefined);
  if (reading?.status === "due") {
    return line(
      "working",
      "waiting",
      reading.kind === "deadline" ? "case-rows-pub-reading-deadline" : "case-rows-pub-reading-hearing",
    );
  }
  if (reading && (reading.status === "unread" || reading.status === "failed")) {
    const doneSince =
      reading.kind === "deadline"
        ? row.deadlines.length > 0 || row.anyDeadline
        : row.hearings.length > 0 || row.hearingSettled;
    if (!doneSince) {
      return line(
        "ask",
        "attention",
        reading.kind === "deadline" ? "case-rows-pub-left-deadline" : "case-rows-pub-left-hearing",
        "open",
      );
    }
  }

  // Settled: what came of it.
  const hearing = row.hearings.find((item) => item.status === "scheduled") ?? null;
  if (hearing) return line("done", "done", "case-rows-pub-hearing", null, momentOf(hearing.startsAt, hearing.timeZone));
  const deadline = row.deadlines[0] ?? null;
  if (deadline) {
    const day = deadline.urgentOn ?? deadline.dueOn;
    if (!day) return line("working", "waiting", "case-rows-pub-deadline-counting");
    return line(
      "done",
      "done",
      deadline.status === "confirmed" ? "case-rows-pub-deadline" : "case-rows-pub-deadline-proposed",
      null,
      { day: shortDay(day) },
    );
  }
  if (category === "decisao" && row.judgment?.value) return line("done", "done", "case-rows-pub-judgment-yes");
  // Who settled it: who gave the awareness of ONE's triage, who triaged it, or ONE.
  if (!seen.said && row.ackedBy) return line("done", "done", "case-rows-pub-acked", null, { name: row.ackedBy });
  if (!seen.said && row.triagedBy)
    return line("done", "done", "case-rows-pub-triaged-by", null, { name: row.triagedBy });
  if (!seen.said && row.byAi) return line("done", "done", "case-rows-pub-triaged-one");
  return line("done", "done", "case-rows-pub-triaged");
}

/** The publications of a case in the order of their lines: what asks first (the oldest first), then ONE's work, then the rest. */
export function orderPublications<T extends { row: PublicationRow; line: PublicationLine }>(items: readonly T[]) {
  const ask = items
    .filter((item) => item.line.place === "ask")
    .sort((a, b) => a.row.availableOn.localeCompare(b.row.availableOn));
  const working = items.filter((item) => item.line.place === "working");
  const done = items
    .filter((item) => item.line.place === "done")
    .sort((a, b) => b.row.availableOn.localeCompare(a.row.availableOn));
  return { ask, working, done };
}
