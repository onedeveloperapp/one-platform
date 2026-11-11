/**
 * The watch over the DJEN (migration 0201), the pure half: what the database answers of an outage, of a court whose
 * links point to another system, and of the operator's watch, read into plain shapes.
 */

const COURT_SYSTEM_NAMES = ["projudi", "eproc", "pje", "esaj", "outro"] as const;
export type WatchedSystem = (typeof COURT_SYSTEM_NAMES)[number];

const isSystem = (value: unknown): value is WatchedSystem =>
  typeof value === "string" && (COURT_SYSTEM_NAMES as readonly string[]).includes(value);

const int = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.max(Math.round(n), 0) : 0;
};

const day = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

const moment = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;

/** The day of Brasília a moment falls on. */
export const brasiliaDay = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/** An outage the firm is told of: since when the DJEN does not answer. */
export type DjenOutage = { downSince: string; downDay: string };

export function readDjenOutage(raw: unknown): DjenOutage | null {
  if (!raw || typeof raw !== "object") return null;
  const since = moment((raw as Record<string, unknown>).down_since);
  return since ? { downSince: since, downDay: brasiliaDay(since) } : null;
}

/** A court and kind whose links point mostly to another system than the platform's table says. */
export type CourtSystemSignal = {
  court: string;
  kind: "juizado" | "comum";
  tableSystem: WatchedSystem | null;
  confirmed: boolean;
  seenSystem: WatchedSystem;
  seen: number;
  total: number;
  percent: number;
  firstSeen: string | null;
};

export function readCourtSystemSignal(
  raw: unknown,
  court = "",
  kind: "juizado" | "comum" = "juizado",
): CourtSystemSignal | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!isSystem(row.seen_system)) return null;
  const rowKind = row.kind === "comum" || row.kind === "juizado" ? row.kind : kind;
  return {
    court: typeof row.court === "string" ? row.court : court,
    kind: rowKind,
    tableSystem: isSystem(row.table_system) ? row.table_system : null,
    confirmed: row.confirmed === true,
    seenSystem: row.seen_system,
    seen: int(row.seen),
    total: int(row.total),
    percent: Math.min(int(row.percent), 100),
    firstSeen: day(row.first_seen),
  };
}

export type DjenProbeRow = {
  court: string;
  day: string | null;
  at: string;
  outcome: "ok" | "error" | "rate_limited";
  latencyMs: number | null;
  items: number;
  withoutText: number;
  error: string | null;
};

export type DjenWatch = {
  lastProbeAt: string | null;
  lastOkAt: string | null;
  fresh: boolean;
  downSince: string | null;
  dayItems: number;
  dayWithoutText: number;
  empty: boolean;
  probes: DjenProbeRow[];
  signals: CourtSystemSignal[];
  courtsSeen: number;
};

/** The operator's watch as `admin_djen_watch` answers it; null for an answer that is not one. */
export function readDjenWatch(raw: unknown): DjenWatch | null {
  if (!raw || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;
  const state = (answer.state && typeof answer.state === "object" ? answer.state : {}) as Record<string, unknown>;
  const probes = Array.isArray(answer.probes) ? answer.probes : [];
  const signals = Array.isArray(answer.signals) ? answer.signals : [];
  return {
    lastProbeAt: moment(state.last_probe_at),
    lastOkAt: moment(state.last_ok_at),
    fresh: state.fresh === true,
    downSince: moment(state.down_since),
    dayItems: int(state.day_items),
    dayWithoutText: int(state.day_without_text),
    empty: state.empty === true,
    probes: probes.flatMap((probe): DjenProbeRow[] => {
      if (!probe || typeof probe !== "object") return [];
      const row = probe as Record<string, unknown>;
      const at = moment(row.at);
      const outcome =
        row.outcome === "ok" || row.outcome === "error" || row.outcome === "rate_limited" ? row.outcome : null;
      if (!at || !outcome || typeof row.court !== "string") return [];
      return [
        {
          court: row.court,
          day: day(row.day),
          at,
          outcome,
          latencyMs: row.latency_ms == null ? null : int(row.latency_ms),
          items: int(row.items),
          withoutText: int(row.without_text),
          error: typeof row.error === "string" ? row.error : null,
        },
      ];
    }),
    signals: signals.flatMap((signal) => {
      const read = readCourtSystemSignal(signal);
      return read ? [read] : [];
    }),
    courtsSeen: int(answer.courts_seen),
  };
}
