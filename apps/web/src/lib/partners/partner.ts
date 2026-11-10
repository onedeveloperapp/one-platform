/**
 * A partner of a firm (migration 0069): an account that is no firm's, the travel agency a firm partners with in a
 * module. Pure: the reader of the database's answers and the words of the screens (`product` namespace). The
 * module's own work of a partner (its passengers) is the module's; this is the core's half.
 */

export const PARTNER_ROLES = ["owner", "admin", "member"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export const isPartnerRole = (value: unknown): value is PartnerRole =>
  (PARTNER_ROLES as readonly unknown[]).includes(value);

/** Who manages the partner's account: brings colleagues in, renames it, ends a partnership. */
export const isPartnerManager = (role: PartnerRole | null | undefined): boolean => role === "owner" || role === "admin";

/** Where somebody of a partner works in ONE. */
export const PARTNER_AREA = "/parceiro";

/** One active partnership of the partner: a firm, in a module. */
export type PartnerLink = { id: string; orgId: string; firm: string; module: string; startedAt: string };

/** The partner of the person looking, as `my_partner` answers it. */
export type MemberPartner = {
  id: string;
  name: string;
  /** What kind of partner it is (`partners.kind`): a travel agency, the passenger module's partner. */
  kind: string;
  role: PartnerRole;
  /** Who manages the partner finished its setup or set it aside (0080). */
  setupAnswered: boolean;
  links: PartnerLink[];
};

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** The answer of `my_partner`, read; null for somebody in no partner, or an answer that is not one. */
export function memberPartnerOf(raw: unknown): MemberPartner | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name || !isPartnerRole(row.role)) return null;
  const links = (Array.isArray(row.links) ? row.links : []).flatMap((item): PartnerLink[] => {
    const link = (item ?? {}) as Record<string, unknown>;
    const linkId = text(link.id);
    const orgId = text(link.org_id);
    const module = text(link.module);
    if (!linkId || !orgId || !module) return [];
    return [{ id: linkId, orgId, firm: text(link.firm) ?? "", module, startedAt: text(link.started_at) ?? "" }];
  });
  return {
    id,
    name,
    kind: text(row.kind) ?? "agency",
    role: row.role,
    setupAnswered: row.setup_answered === true,
    links,
  };
}

/**
 * Who manages the partner never answered its setup (0080): the partner's home opens on the setup for them. False
 * for somebody else of the partner, who has nothing of it to answer.
 */
export const partnerSetupPending = (partner: MemberPartner | null): boolean =>
  partner !== null && isPartnerManager(partner.role) && !partner.setupAnswered;

/** The modules a partner works in now: those of its active partnerships. */
export const partnerModules = (partner: MemberPartner | null): string[] =>
  partner ? [...new Set(partner.links.map((link) => link.module))] : [];

/**
 * What the firm has of one partnership (migration 0075): its own cases from it, and, to who manages the firm, what
 * it costs the firm today. Nothing of a passenger who did not say yes.
 */
export type PartnershipFacts = {
  /** The cases the partnership brought that still go on. */
  casesGoing: number;
  casesTotal: number;
  /** The cases where ONE waits for the client to confirm what the agency sent. */
  awaitingClient: number;
  /** The documents the AI read for the partnership today; null to who does not manage the firm. */
  readingsToday: number | null;
  /** The reads of the partnership's flights today; null to who does not manage the firm. */
  flightReadsToday: number | null;
  /** What the firm foresees of the partnership, in numbers (0084); null when the answer has none. */
  forecast: PartnershipForecast | null;
  /** The agency's passengers by the firm's numbers (0171); null when the answer has none. */
  passengers: PartnershipPassengers | null;
};

/**
 * The agency's passengers by the firm's numbers (migration 0171, the owner's decision of 2026-11-07): the ones it
 * registered, the ones that never agreed or no longer do, the leads (a yes that passed their data to the firm, no
 * case yet) and the ones whose trip became a case.
 */
export type PartnershipPassengers = { registered: number; unagreed: number; leads: number; converted: number };

/** The passengers' numbers of a partnership as the database answers them; null for an answer that is not one. */
export function partnershipPassengersOf(raw: unknown): PartnershipPassengers | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const registered = whole(row.registered);
  if (registered === null) return null;
  return {
    registered,
    unagreed: whole(row.unagreed) ?? 0,
    leads: whole(row.leads) ?? 0,
    converted: whole(row.converted) ?? 0,
  };
}

/**
 * What a firm foresees of a partnership, to foresee the cases that may come (the owner, 2026-11-03), in numbers and
 * nobody named: a passenger's data reach the firm only with the passenger's yes to its help (0071).
 */
export type PartnershipForecast = {
  /** The partnership's passengers whose answer in force is a yes, and the first day of such an answer. */
  agreed: number;
  agreedSince: string | null;
  /** The agreements in force given in each of the last weeks, the current one last ("YYYY-MM-DD", its Monday). */
  agreedWeeks: { week: string; agreed: number }[];
  /** The trips ONE follows now, and how many of them were told of a problem and wait for the passenger's answer. */
  followed: number;
  alerted: number;
  /** How many of those trips fly on each of the next days, today first. */
  days: { day: string; trips: number }[];
  /** The legs in the air now, and the legs that arrived today. */
  inAir: number;
  arrivedToday: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The forecast of a partnership as the database answers it; null for one that is not. */
export function partnershipForecastOf(raw: unknown): PartnershipForecast | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const agreed = whole(row.agreed);
  const followed = whole(row.followed);
  if (agreed === null || followed === null) return null;
  const list = (value: unknown) =>
    (Array.isArray(value) ? value : []).map((item) => (item ?? {}) as Record<string, unknown>);
  return {
    agreed,
    agreedSince: typeof row.agreed_since === "string" && DAY.test(row.agreed_since) ? row.agreed_since : null,
    agreedWeeks: list(row.agreed_weeks).flatMap((week) =>
      typeof week.week === "string" && DAY.test(week.week)
        ? [{ week: week.week, agreed: whole(week.agreed) ?? 0 }]
        : [],
    ),
    followed,
    alerted: whole(row.alerted) ?? 0,
    days: list(row.days).flatMap((day) =>
      typeof day.day === "string" && DAY.test(day.day) ? [{ day: day.day, trips: whole(day.trips) ?? 0 }] : [],
    ),
    inAir: whole(row.in_air) ?? 0,
    arrivedToday: whole(row.arrived_today) ?? 0,
  };
}

/** What the partnerships cost the firm today, to who manages it. */
export type PartnershipCosts = {
  /** The documents the AI reads for one partnership in a day, at most. */
  readingsDaily: number;
  /** The firm's reads of every flight it follows today, and its share of the day. */
  flightReadsToday: number;
  flightReadsShare: number;
};

export type FirmPartnershipFacts = {
  byLink: Map<string, PartnershipFacts>;
  costs: PartnershipCosts | null;
  /** How many days ahead each forecast counts the flights (the setting `flight_progress_days`). */
  forecastDays: number;
};

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** The answer of `firm_partnership_facts`, read; null for one that is not. */
export function partnershipFactsOf(raw: unknown): FirmPartnershipFacts | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  if (!Array.isArray(answer.partnerships)) return null;
  const byLink = new Map<string, PartnershipFacts>();
  for (const item of answer.partnerships) {
    const row = (item ?? {}) as Record<string, unknown>;
    const linkId = text(row.link_id);
    if (!linkId) continue;
    byLink.set(linkId, {
      casesGoing: whole(row.cases_going) ?? 0,
      casesTotal: whole(row.cases_total) ?? 0,
      awaitingClient: whole(row.awaiting_client) ?? 0,
      readingsToday: whole(row.readings_today),
      flightReadsToday: whole(row.flight_reads_today),
      forecast: partnershipForecastOf(row.forecast),
      passengers: partnershipPassengersOf(row.passengers),
    });
  }
  const readingsDaily = whole(answer.readings_daily);
  const flightReadsToday = whole(answer.flight_reads_today);
  const flightReadsShare = whole(answer.flight_reads_share);
  return {
    byLink,
    forecastDays: whole(answer.forecast_days) || 7,
    costs:
      answer.manager === true && readingsDaily !== null && flightReadsToday !== null && flightReadsShare !== null
        ? { readingsDaily, flightReadsToday, flightReadsShare }
        : null,
  };
}

// The `product` message key of each role, spelled out so the catalog check sees each one.
export const PARTNER_ROLE_KEY: Record<PartnerRole, string> = {
  owner: "partner-role-owner",
  admin: "partner-role-admin",
  member: "partner-role-member",
};

/** The words of a refusal of a partner's function. */
export function partnerErrorKey(code: string): string {
  switch (code) {
    case "second_factor_required":
      return "partner-error-second-factor";
    case "not_allowed_in_support_session":
      return "partner-error-support";
    case "not_authorized":
    case "not_allowed":
      return "partner-error-not-allowed";
    case "invalid_email":
      return "partner-error-email";
    case "invalid_partner_name":
      return "partner-error-name";
    case "already_member":
      return "partner-error-already-member";
    case "invite_rate_limited":
      return "partner-error-rate";
    case "module_not_enabled":
      return "partner-error-module";
    case "no_partnership":
      return "partner-error-no-partnership";
    case "only_owner_invites_admin":
      return "partner-error-only-owner";
    case "reason_required":
      return "partner-error-reason";
    case "owner_stays":
      return "partner-error-owner-stays";
    case "already_in_a_firm":
      return "partner-error-in-firm";
    case "already_in_a_partner":
      return "partner-error-in-partner";
    case "already_partnered":
      return "partner-error-partnered";
    case "expired":
      return "partner-error-expired";
    case "revoked":
      return "partner-error-revoked";
    case "already_accepted":
      return "partner-error-accepted";
    case "email_not_confirmed":
      return "partner-error-email-not-confirmed";
    case "not_found":
      return "partner-error-not-found";
    default:
      return "partner-error-failed";
  }
}
