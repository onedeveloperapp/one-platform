/**
 * The ways to file on a court's screen as the screens show them (the owner, 2026-11-20; migrations 0263 and 0264):
 * which ways a lawyer may choose at a system (those the platform turned on there, none more automated than the
 * firm's, and always by hand), where a court login stands, which systems a lawyer is asked about (`systemsFor`: the
 * courts of their states, of the lawsuits they sign and of their choices, else every one ONE works on), and why ONE
 * does or does not file a lawsuit on a court's screen (`screenStanding`). Pure: the screens and the setups read it.
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
  /**
   * The systems of the lawsuits the person signs that are still to be filed, by key: a lawsuit goes to the client's
   * domicile, often a state the lawyer is not registered in (the five causes a year of the Estatuto, art. 10, § 2).
   */
  lawsuitSystems: string[];
  /**
   * Whether ONE prepares the firm's filing packages at all, as the firm said in its setup (0256, `one_filing`): a firm
   * that said no is asked nothing of how it files, nor is any lawyer of it. Absent: it does.
   */
  onePrepares?: boolean;
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

/**
 * The way a lawyer files at a system now, as the database files by it (`approve_filing_batch`, 0264): their own
 * choice while ONE still offers it, else by hand. The firm's way is only what is marked for them to choose: an
 * automated way asks each lawyer's own acknowledgment, and a lawyer who never gave it files by hand.
 */
export function wayInForce(data: Pick<FilingWaysData, "myWays" | "firmWay">, system: ScreenSystem): Way {
  const mine = data.myWays[system.key];
  return mine && waysOffered(system, data.firmWay).includes(mine) ? mine : "hand";
}

/**
 * The way marked for a lawyer to choose at a system, under a firm's way (the one saved, or the one being chosen on
 * the same screen): their own choice while it is offered, else the firm's (the canvas the owner approved: "Vem
 * marcada a forma que o escritório escolheu"), else the most automated way offered.
 */
export function wayProposed(
  mine: Way | null | undefined,
  system: Pick<ScreenSystem, "ways">,
  firmWay: Way | null,
): Way {
  const offered = waysOffered(system, firmWay);
  if (mine && offered.includes(mine)) return mine;
  if (firmWay && offered.includes(firmWay)) return firmWay;
  return offered[0] ?? "hand";
}

/** The systems ONE files on the screen of: those where the platform turned an automated way on. */
export const workingSystems = (systems: readonly ScreenSystem[]): ScreenSystem[] =>
  systems.filter((system) => system.ways.length > 0);

/**
 * The systems a lawyer is asked how they file in, the same on every screen that asks it (the setups, the settings,
 * the home's reminder), among those ONE works on: the courts of the states they are registered in, those of the
 * lawsuits they sign still to be filed, and those they already chose a way at; none of these, every one ONE works
 * on. The states alone missed the lawsuits: a lawyer registered in Rio de Janeiro, whose lawsuit went to the client's
 * domicile in São Paulo, was asked nothing in their setup (the owner's test of 2026-11-23).
 */
export function systemsFor(
  data: Pick<FilingWaysData, "systems" | "myWays" | "lawsuitSystems">,
  states: readonly string[],
): ScreenSystem[] {
  const working = workingSystems(data.systems);
  const mine = working.filter(
    (system) =>
      (system.uf !== null && states.includes(system.uf)) ||
      data.lawsuitSystems.includes(system.key) ||
      data.myWays[system.key] !== undefined,
  );
  return mine.length > 0 ? mine : working;
}

/**
 * The systems where a lawyer has a way to choose, under a firm's way: those they are asked about (`systemsFor`)
 * where ONE offers more than by hand. None while the firm chose no automated way: a lawyer then has nothing to choose.
 */
export function systemsToChoose(
  data: Pick<FilingWaysData, "systems" | "myWays" | "lawsuitSystems">,
  states: readonly string[],
  firmWay: Way | null,
): ScreenSystem[] {
  return systemsFor(data, states).filter((system) => waysOffered(system, firmWay).length > 1);
}

/**
 * What a lawyer's own setup asks of the filing (the owner's three ways, 2026-11-20): its step is there when the
 * lawyer has a way to choose at a court they are asked about, or decides for a firm that chose none yet (the firm's
 * way comes first); and it is owed while the firm's way, or the lawyer's at one of those courts, was never chosen.
 */
export function personFilingStep(
  data: Pick<
    FilingWaysData,
    "systems" | "firmWay" | "myWays" | "decidesForFirm" | "lawyer" | "lawsuitSystems" | "onePrepares"
  >,
  states: readonly string[],
): { shown: boolean; owed: boolean } {
  if (!data.lawyer || data.onePrepares === false) return { shown: false, owed: false };
  const firmForm = data.decidesForFirm && data.firmWay === null;
  const mine = systemsToChoose(data, states, data.firmWay);
  return {
    shown: firmForm || mine.length > 0,
    owed: firmForm || mine.some((system) => !data.myWays[system.key]),
  };
}

/**
 * What a lawsuit's package needs to go on a court's screen (0263, 0264), as the case reads it: the system, the
 * firm's way, and the way each lawyer of the lawsuit chose there (null: never chose).
 */
export type ScreenFilingFacts = {
  key: string;
  name: string;
  ways: string[];
  firmWay: Way | null;
  lawyers: { userId: string; way: Way | null }[];
  /** The person reading, so a screen tells their own turn from a colleague's. */
  viewerId?: string | null;
};

/**
 * Why ONE does or does not file a lawsuit on a court's screen, and whose turn it is: who decides for the firm never
 * chose the firm's way; a lawyer of the lawsuit never chose theirs at this system (or chose one the firm's way no
 * longer offers); a lawyer of it may hand it to ONE in a batch; or it is filed by hand, as the firm or every lawyer
 * of it chose. Null where ONE does not file on this screen or the lawsuit has no lawyer yet.
 */
export type ScreenStanding =
  | { kind: "firm_unchosen" }
  | { kind: "choose"; lawyers: string[] }
  | { kind: "batch"; lawyers: string[] }
  | { kind: "hand" };

export function screenStanding(facts: ScreenFilingFacts): ScreenStanding | null {
  const system = {
    ways: facts.ways.filter((way): way is Exclude<Way, "hand"> => way === "browser" || way === "extension"),
  };
  if (system.ways.length === 0 || facts.lawyers.length === 0) return null;
  if (facts.firmWay === null) return { kind: "firm_unchosen" };
  const offered = waysOffered(system, facts.firmWay);
  if (offered.length < 2) return { kind: "hand" };
  const automated = (way: Way | null) => way !== null && way !== "hand" && offered.includes(way);
  const batch = facts.lawyers.filter((lawyer) => automated(lawyer.way)).map((lawyer) => lawyer.userId);
  if (batch.length > 0) return { kind: "batch", lawyers: batch };
  const choose = facts.lawyers.filter((lawyer) => lawyer.way !== "hand").map((lawyer) => lawyer.userId);
  return choose.length > 0 ? { kind: "choose", lawyers: choose } : { kind: "hand" };
}

/**
 * What a lawyer's choice at a system asks before it is saved: the court login, for ONE's browser with none kept (or
 * one the court refused, or one being changed); the acknowledgment, for an automated way being chosen or a login
 * being given, since the database keeps the text it was given for; and whether anything is to be saved at all (by
 * hand included, the first time: a lawyer who chose it is never asked again, nor told ONE could file for them).
 */
export function lawyerChoiceAsks(input: {
  way: Way;
  saved: Way | null | undefined;
  login: Pick<CourtLogin, "state"> | null;
  changing: boolean;
}): { login: boolean; aware: boolean; save: boolean } {
  const login =
    input.way === "browser" &&
    (!input.login || input.login.state === "refused" || input.login.state === "blocked" || input.changing);
  const aware = input.way !== "hand" && (input.way !== input.saved || login);
  return { login, aware, save: input.way !== input.saved || login || aware };
}

/** What the firm's choice asks before it is saved: the firm's acknowledgment for an automated way being chosen. */
export function firmChoiceAsks(input: { way: Way | null; saved: Way | null }): { aware: boolean; save: boolean } {
  // Nothing chosen yet (the setup marks no way before the firm chooses one): nothing to save, nothing to acknowledge.
  if (input.way === null) return { aware: false, save: false };
  const save = input.way !== input.saved;
  return { aware: save && input.way !== "hand", save };
}

/** The points of an acknowledgment's text, its lines that open with "- ", as the screens list them. */
export function termPoints(bodyMd: string): string[] {
  return bodyMd
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
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
