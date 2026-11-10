/**
 * The closing goals of the controladoria (migration 0113): a goal of closings for a period, for every case of the firm
 * or a part of them (a module, a kind of problem, where the cases came from, one partner agency). What counts as a
 * closing is the plan of the case's journey's to say: until it does, the database answers no count (`rule` null), and
 * the screens say so. Pure: the answer read, where each goal stands against today, the views of the list, the periods
 * the panel offers, the progress and the input of a save.
 */

/** Where the cases of a goal came from, as the database writes it (`cases.origin`). */
export const GOAL_ORIGINS = ["agency", "referral", "ads", "organic", "returning_client", "other"] as const;
export type GoalOrigin = (typeof GOAL_ORIGINS)[number];
export const isGoalOrigin = (value: unknown): value is GoalOrigin =>
  (GOAL_ORIGINS as readonly unknown[]).includes(value);

/** The words of each origin. */
export const ORIGIN_KEY: Record<GoalOrigin, string> = {
  agency: "goals-origin-agency",
  referral: "goals-origin-referral",
  ads: "goals-origin-ads",
  organic: "goals-origin-organic",
  returning_client: "goals-origin-returning",
  other: "goals-origin-other",
};

export type ClosingGoal = {
  id: string;
  /** The period, days of Brasília (`YYYY-MM-DD`), both included. */
  startsOn: string;
  endsOn: string;
  module: string | null;
  incident: string | null;
  origin: GoalOrigin | null;
  partnership: string | null;
  /** The partner agency by its name. */
  partner: string | null;
  target: number;
  /** How many closings it has; null while no rule says what a closing is. */
  closings: number | null;
  archivedAt: string | null;
  archiveReason: string | null;
};

export type ClosingGoals = {
  /** Today in Brasília, as the database says it. */
  today: string;
  /** Whether the closings are counted (the rule of what a closing is exists). */
  counting: boolean;
  /** The closings are of the firm's test cases, while it has no real case (migration 0146). */
  testsCounted: boolean;
  mayManage: boolean;
  goals: ClosingGoal[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The answer of `firm_closing_goals`, read; null when it is not one (a read that failed is never an empty list). */
export function closingGoalsOf(raw: unknown): ClosingGoals | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.goals) || typeof value.today !== "string" || !DAY.test(value.today)) return null;
  return {
    today: value.today,
    counting: value.rule !== null && value.rule !== undefined,
    testsCounted: value.tests_counted === true,
    mayManage: value.may_manage === true,
    goals: value.goals.flatMap((entry): ClosingGoal[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const goal = entry as Record<string, unknown>;
      const startsOn = text(goal.starts_on);
      const endsOn = text(goal.ends_on);
      if (typeof goal.id !== "string" || !startsOn || !endsOn || !DAY.test(startsOn) || !DAY.test(endsOn)) return [];
      return [
        {
          id: goal.id,
          startsOn,
          endsOn,
          module: text(goal.module),
          incident: text(goal.incident),
          origin: isGoalOrigin(goal.origin) ? goal.origin : null,
          partnership: text(goal.partnership),
          partner: text(goal.partner),
          target: typeof goal.target === "number" && goal.target > 0 ? Math.floor(goal.target) : 1,
          closings:
            typeof goal.closings === "number" && Number.isFinite(goal.closings) && goal.closings >= 0
              ? Math.floor(goal.closings)
              : null,
          archivedAt: text(goal.archived_at),
          archiveReason: text(goal.archive_reason),
        },
      ];
    }),
  };
}

/** Where a goal stands against today: in force, still to come, ended, or archived. */
export type GoalPhase = "now" | "next" | "past" | "archived";

export function goalPhase(goal: ClosingGoal, today: string): GoalPhase {
  if (goal.archivedAt) return "archived";
  if (goal.startsOn > today) return "next";
  if (goal.endsOn < today) return "past";
  return "now";
}

/** The views of the list, in the order they are offered, each by the phase it holds. */
export const GOAL_VIEWS = ["em-vigor", "proximas", "encerradas", "arquivadas"] as const;
export type GoalView = (typeof GOAL_VIEWS)[number];
export const isGoalView = (value: unknown): value is GoalView => (GOAL_VIEWS as readonly unknown[]).includes(value);
export const VIEW_PHASE: Record<GoalView, GoalPhase> = {
  "em-vigor": "now",
  proximas: "next",
  encerradas: "past",
  arquivadas: "archived",
};

/** How many goals each view holds. */
export function goalCounts(goals: ClosingGoal[], today: string): Record<GoalView, number> {
  const counts = { "em-vigor": 0, proximas: 0, encerradas: 0, arquivadas: 0 } as Record<GoalView, number>;
  for (const goal of goals) {
    const phase = goalPhase(goal, today);
    const view = GOAL_VIEWS.find((key) => VIEW_PHASE[key] === phase);
    if (view) counts[view] += 1;
  }
  return counts;
}

/** The goals of a view: in force and to come the soonest to end first, the ended and archived the latest first. */
export function goalsOfView(goals: ClosingGoal[], view: GoalView, today: string): ClosingGoal[] {
  const phase = VIEW_PHASE[view];
  const chosen = goals.filter((goal) => goalPhase(goal, today) === phase);
  const soonest = phase === "now" || phase === "next";
  return [...chosen].sort((a, b) =>
    soonest
      ? a.endsOn.localeCompare(b.endsOn) || a.startsOn.localeCompare(b.startsOn)
      : b.endsOn.localeCompare(a.endsOn) || b.startsOn.localeCompare(a.startsOn),
  );
}

/** The view a list opens on: the goals in force when there are any, else the next ones, else the ended ones. */
export function firstView(counts: Record<GoalView, number>): GoalView {
  if (counts["em-vigor"] > 0) return "em-vigor";
  if (counts.proximas > 0) return "proximas";
  if (counts.encerradas > 0) return "encerradas";
  return "em-vigor";
}

/** How far a goal went, or null while the closings are not counted. */
export function goalProgress(goal: ClosingGoal): { done: number; target: number; percent: number } | null {
  if (goal.closings === null) return null;
  return {
    done: goal.closings,
    target: goal.target,
    percent: Math.min(100, Math.round((goal.closings / Math.max(1, goal.target)) * 100)),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The periods the panel offers from today: this month, the next one, this quarter. */
export function periodPresets(
  today: string,
): Record<"month" | "next" | "quarter", { startsOn: string; endsOn: string }> {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  return {
    month: { startsOn: iso(year, month, 1), endsOn: iso(year, month, lastDay(year, month)) },
    next: { startsOn: iso(nextYear, nextMonth, 1), endsOn: iso(nextYear, nextMonth, lastDay(nextYear, nextMonth)) },
    quarter: {
      startsOn: iso(year, quarterStart, 1),
      endsOn: iso(year, quarterStart + 2, lastDay(year, quarterStart + 2)),
    },
  };
}

/** Whether a period is one whole calendar month, which the screens name by its month. */
export function wholeMonth(startsOn: string, endsOn: string): boolean {
  const [year, month, day] = startsOn.split("-").map(Number) as [number, number, number];
  return day === 1 && endsOn === iso(year, month, lastDay(year, month));
}

/** The longest period a goal takes, in days between its first and its last day. */
export const MOST_PERIOD_DAYS = 366;
/** The most closings a goal asks. */
export const MOST_TARGET = 1_000_000;

/** What a save sends, checked before it goes: a server action is a public endpoint. */
export type GoalInput = {
  id: string | null;
  startsOn: string;
  endsOn: string;
  module: string | null;
  incident: string | null;
  origin: GoalOrigin | null;
  partnership: string | null;
  target: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The input of a save from whatever was handed, or what is wrong with it (the field's code). */
export function goalInputOf(input: unknown): { ok: true; goal: GoalInput } | { ok: false; field: string } {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const id = typeof value.id === "string" && UUID.test(value.id) ? value.id : null;
  const startsOn = typeof value.startsOn === "string" && DAY.test(value.startsOn) ? value.startsOn : null;
  const endsOn = typeof value.endsOn === "string" && DAY.test(value.endsOn) ? value.endsOn : null;
  if (!startsOn || !endsOn || Number.isNaN(Date.parse(startsOn)) || Number.isNaN(Date.parse(endsOn)))
    return { ok: false, field: "period" };
  const span = (Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000;
  if (span < 0 || span > MOST_PERIOD_DAYS) return { ok: false, field: "period" };
  const target = typeof value.target === "number" && Number.isInteger(value.target) ? value.target : 0;
  if (target < 1 || target > MOST_TARGET) return { ok: false, field: "target" };
  const module = typeof value.module === "string" && /^[a-z][a-z0-9-]{2,60}$/.test(value.module) ? value.module : null;
  const incident =
    typeof value.incident === "string" && /^[a-z][a-z0-9_-]{1,40}$/.test(value.incident) ? value.incident : null;
  const partnership = typeof value.partnership === "string" && UUID.test(value.partnership) ? value.partnership : null;
  const origin = partnership ? "agency" : isGoalOrigin(value.origin) ? value.origin : null;
  return { ok: true, goal: { id, startsOn, endsOn, module, incident, origin, partnership, target } };
}

/** The words of what went wrong with a save or an archive, by the code the database or the check gave. */
export function goalErrorKey(code: string): string {
  switch (code) {
    case "support_visit":
      return "goals-error-support-visit";
    case "not_allowed":
      return "goals-error-not-allowed";
    case "archived":
      return "goals-error-archived";
    case "module":
      return "goals-error-module";
    case "partnership":
      return "goals-error-partnership";
    case "period":
      return "goals-error-period";
    case "target":
      return "goals-error-target";
    case "reason":
      return "goals-error-reason";
    default:
      return "goals-error-failed";
  }
}

/** A whole month by its name, as a title says it ("Novembro de 2026") or inside a sentence ("novembro de 2026"). */
export function monthLabel(startsOn: string, inSentence = false): string {
  const [year, month] = startsOn.split("-").map(Number) as [number, number];
  const words = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return inSentence ? words : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The view a goal of this period is in (one just saved: the list goes where it landed). */
export function viewOfPeriod(startsOn: string, endsOn: string, today: string): GoalView {
  if (startsOn > today) return "proximas";
  if (endsOn < today) return "encerradas";
  return "em-vigor";
}
