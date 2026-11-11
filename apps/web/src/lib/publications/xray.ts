import { kindOfCommunication } from "@flyee/courts/djen-systems";
import type { DjenCommunication } from "@flyee/courts/types";

/**
 * The x-ray by the OAB (M6), the pure half: what the DJEN published of one registration at the bar in some days, in
 * numbers only (communications, lawsuits, by court, by kind of lawsuit, by month, and the lawsuits whose texts name
 * each airline). Public data of the gazette, read at that moment and never kept: nothing of a party, a lawsuit's
 * number or a text leaves this function.
 */
export type XrayAirline = { iata: string; name: string; names: string[] };

export type Xray = {
  communications: number;
  lawsuits: number;
  byCourt: { court: string; lawsuits: number }[];
  byKind: { juizado: number; comum: number; other: number };
  byMonth: { month: string; communications: number }[];
  byAirline: { iata: string; name: string; lawsuits: number }[];
};

const plain = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function xrayOf(communications: readonly DjenCommunication[], airlines: readonly XrayAirline[]): Xray {
  const lawsuits = new Map<string, { court: string; kind: "juizado" | "comum" | null; words: string[] }>();
  const months = new Map<string, number>();
  for (const communication of communications) {
    const key = communication.cnj || communication.hash;
    const lawsuit = lawsuits.get(key) ?? {
      court: communication.court || "?",
      kind: null,
      words: [],
    };
    lawsuit.kind ??= kindOfCommunication({ className: communication.className, unit: communication.unit });
    lawsuit.words.push(plain(communication.text.slice(0, 4000)));
    lawsuits.set(key, lawsuit);
    const month = communication.availableOn.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) months.set(month, (months.get(month) ?? 0) + 1);
  }

  const courts = new Map<string, number>();
  const byKind = { juizado: 0, comum: 0, other: 0 };
  const matchers = airlines.map((airline) => ({
    airline,
    patterns: airline.names
      .filter((name) => name.trim().length >= 3)
      .map((name) => new RegExp(`(^|[^A-Z0-9])${escape(plain(name.trim()))}([^A-Z0-9]|$)`)),
  }));
  const airlineCounts = new Map<string, number>();
  for (const lawsuit of lawsuits.values()) {
    courts.set(lawsuit.court, (courts.get(lawsuit.court) ?? 0) + 1);
    byKind[lawsuit.kind ?? "other"] += 1;
    const text = lawsuit.words.join(" ");
    // A lawsuit counts for an airline only when its texts name that one alone.
    const named = matchers.filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)));
    if (named.length === 1) {
      const iata = named[0]!.airline.iata;
      airlineCounts.set(iata, (airlineCounts.get(iata) ?? 0) + 1);
    }
  }

  return {
    communications: communications.length,
    lawsuits: lawsuits.size,
    byCourt: [...courts.entries()]
      .map(([court, count]) => ({ court, lawsuits: count }))
      .sort((a, b) => b.lawsuits - a.lawsuits || a.court.localeCompare(b.court)),
    byKind,
    byMonth: [...months.entries()]
      .map(([month, count]) => ({ month, communications: count }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    byAirline: [...airlineCounts.entries()]
      .map(([iata, count]) => ({
        iata,
        name: airlines.find((airline) => airline.iata === iata)?.name ?? iata,
        lawsuits: count,
      }))
      .sort((a, b) => b.lawsuits - a.lawsuits || a.name.localeCompare(b.name)),
  };
}
