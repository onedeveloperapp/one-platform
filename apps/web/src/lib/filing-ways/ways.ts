/**
 * The ways to file on a court's screen as the screens show them (the owner, 2026-11-20; migrations 0263 and 0264):
 * which ways a lawyer may choose at a system (those the platform turned on there, none more automated than the
 * firm's, and always by hand), where a court login stands, and which systems a lawyer files in (the courts of the
 * states of their registrations at the bar). Pure: the screens and the setups read it.
 */

export const WAYS = ["browser", "extension", "hand"] as const;
export type Way = (typeof WAYS)[number];

export const isWay = (value: unknown): value is Way => (WAYS as readonly unknown[]).includes(value);

/** How automated a way is: the firm's way is the most a lawyer of it may choose (`filing_way_rank`, 0263). */
export const WAY_RANK: Record<Way, number> = { browser: 3, extension: 2, hand: 1 };

export type ScreenSystem = {
  key: string;
  name: string;
  court: string;
  /** The court's system: `projudi`, `eproc`, `pje`, `esaj`. */
  system: string;
  /** The state of the court, when the platform knows it. */
  uf: string | null;
  /** The automated ways the platform turned on at this system. */
  ways: Exclude<Way, "hand">[];
  ruleNote: string | null;
};

export type CourtLoginState = "verified" | "unchecked" | "refused" | "blocked";

export type CourtLogin = {
  connectionId: string;
  system: string;
  hint: string | null;
  state: CourtLoginState;
  verifiedAt: string | null;
};

export type ExtensionLink = {
  id: string;
  label: string | null;
  linkedAt: string | null;
  lastSeenAt: string | null;
};

export type FilingTerm = { id: string; title: string; bodyMd: string };

export type FilingWaysData = {
  systems: ScreenSystem[];
  firmWay: Way | null;
  /** The person's way at each system they chose one at. */
  myWays: Record<string, Way>;
  logins: CourtLogin[];
  link: ExtensionLink | null;
  terms: { firm: FilingTerm | null; lawyer: FilingTerm | null };
  decidesForFirm: boolean;
  lawyer: boolean;
  /** The states of the person's registrations at the bar. */
  myStates: string[];
};

/**
 * The ways a lawyer may choose at a system, the most automated first, by hand always among them: an automated one
 * only once the firm chose its way (its acknowledgment of the risk comes first), and none beyond it.
 */
export function waysOffered(system: Pick<ScreenSystem, "ways">, firmWay: Way | null): Way[] {
  if (firmWay === null) return ["hand"];
  const ceiling = WAY_RANK[firmWay];
  const offered: Way[] = [...system.ways.filter((way) => WAY_RANK[way] <= ceiling), "hand"];
  return offered.sort((a, b) => WAY_RANK[b] - WAY_RANK[a]);
}

/** The way a lawyer files at a system now: theirs when they chose one ONE still offers, else the firm's, else by hand. */
export function wayAt(data: Pick<FilingWaysData, "myWays" | "firmWay">, system: ScreenSystem): Way {
  const offered = waysOffered(system, data.firmWay);
  const mine = data.myWays[system.key];
  if (mine && offered.includes(mine)) return mine;
  const firm = data.firmWay ?? "hand";
  return offered.includes(firm) ? firm : (offered[0] ?? "hand");
}

/** The systems a lawyer files in: those of the courts of the states they are registered in, else every one ONE works on. */
export function systemsFor(systems: readonly ScreenSystem[], myStates: readonly string[]): ScreenSystem[] {
  const working = systems.filter((system) => system.ways.length > 0);
  const mine = working.filter((system) => system.uf !== null && myStates.includes(system.uf));
  return mine.length > 0 ? mine : working;
}

/** Where a court login stands, from its connection: checked by the court, not yet, or refused or blocked by it. */
export function courtLoginState(row: {
  status: string;
  last_error: string | null;
  metadata: unknown;
}): CourtLoginState {
  if (row.last_error === "court_refused") return "refused";
  if (row.last_error === "court_blocked") return "blocked";
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  return row.status === "connected" && typeof metadata.verified_at === "string" ? "verified" : "unchecked";
}
