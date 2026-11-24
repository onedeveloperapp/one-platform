/**
 * A chronology read as a timeline (the owner, 2026-11-24, on the canvas "Cartões do caso, antes e depois": the
 * chronology was sixteen numbered sentences with the day and the hour written inside each, and the day or the delay
 * could only be found by reading them all). The chronology stays the text ONE writes and the client confirms, one
 * fact per line (`chronologyLines`); this rule only reads what each line opens with, as ONE writes it: a day
 * ("31/08/2025"), then the moment of it after a comma ("10:30", "depois das 18:35"), then a colon and the fact. A
 * line that opens with neither stays under the fact before it, in the order ONE wrote, and nothing is reordered or
 * dropped: a line the rule cannot read is shown whole, with no moment.
 *
 * What the official record of the flights said (ONE writes "segundo o registro da ANAC") is marked, and the words
 * are taken out of the sentence, which the mark says. Pure, so the screens and the tests share it.
 */

export type ChronologyEvent = {
  /** The moment as the line says it ("10:30", "depois das 18:35"); null when it says none. */
  time: string | null;
  /**
   * The line says its own moment: a full point of the timeline. A fact with no moment (one that follows, or a day with no
   * hour) is a smaller point, so a dot never stands beside an empty hour as if the hour were missing.
   */
  marked: boolean;
  /** The fact, without the day, the moment or the mark of the record. */
  text: string;
  /** The fact came from the official record of the flights (ANAC). */
  record: boolean;
};

/** The facts of one day, in the order ONE wrote them; `day` null for what comes before any day is said. */
export type ChronologyDay = { day: string | null; events: ChronologyEvent[] };

const DAY = /^(\d{1,2}\/\d{1,2}\/\d{4})\b\s*(.*)$/u;
/** After the day's comma: a short moment holding an hour ("10:30", "10h", "depois das 18:35"), then ": " and the fact. */
const MOMENT = /^(.{0,30}?\d{1,2}(?::\d{2}|h\d{0,2}))\s*:\s+(.+)$/u;
/** A line that opens with an hour alone, the day being the one before. */
const HOUR = /^(\d{1,2}:\d{2})\s*:\s+(.+)$/u;
const RECORD = /,?\s*segundo o registro da ANAC/iu;

const capital = (text: string): string => (text ? text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) : text);

/** One line: its day (if it opens with one), its moment and its fact. */
function readLine(line: string): { day: string | null; time: string | null; text: string } {
  const trimmed = line.trim();
  const dated = DAY.exec(trimmed);
  if (dated) {
    const rest = dated[2];
    if (rest.startsWith(",")) {
      const moment = MOMENT.exec(rest.slice(1).trim());
      if (moment) return { day: dated[1], time: moment[1].trim(), text: moment[2].trim() };
    }
    if (rest.startsWith(":")) return { day: dated[1], time: null, text: rest.slice(1).trim() };
    // A day the rule cannot split from its fact: the line is kept whole, under that day.
    return { day: dated[1], time: null, text: rest.replace(/^[,\s-]+/u, "").trim() || trimmed };
  }
  const hour = HOUR.exec(trimmed);
  if (hour) return { day: null, time: hour[1], text: hour[2].trim() };
  return { day: null, time: null, text: trimmed };
}

export function chronologyTimeline(lines: readonly string[]): ChronologyDay[] {
  const days: ChronologyDay[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const read = readLine(line);
    const record = RECORD.test(read.text);
    const text = capital((record ? read.text.replace(RECORD, "") : read.text).trim());
    const event: ChronologyEvent = {
      time: read.time,
      marked: read.time !== null,
      text,
      record,
    };
    const current = days[days.length - 1];
    if (read.day !== null && current?.day !== read.day) days.push({ day: read.day, events: [event] });
    else if (current) current.events.push(event);
    else days.push({ day: read.day, events: [event] });
  }
  return days;
}

/** The pieces of a fact, an amount of money apart, for a screen to stress it ("R$ 26,21"). */
export function moneyParts(text: string): { text: string; money: boolean }[] {
  return text
    .split(/(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2})/u)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, money: /^R\$/u.test(part) }));
}
