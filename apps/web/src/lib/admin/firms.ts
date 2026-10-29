import { daysSince, formatDate, formatMoney } from "@/lib/admin/format";
import { labelOf, PERIOD_LABEL } from "@/lib/admin/labels";
import type { RpcEntitlements } from "@/lib/entitlements";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The shapes of `admin_firms_overview()`, `admin_firm_dossier()` and
 * `admin_people_without_firm()` (migration 0012), and what the firms console
 * derives from them.
 *
 * The tiles and the rows come out of ONE query in the database, and the flags a
 * tile counts are the flags a row carries. The predicates here only select on
 * those flags; none of them recomputes a rule, so a tile and the list it
 * filters cannot disagree.
 *
 * The console sees the ACCOUNT of a firm: who belongs to it, what it pays,
 * whether it signs in. Nothing here reads what a firm keeps in the product.
 */

export type FirmPlan = {
  slug: string;
  name: string;
  status: string;
  period: string | null;
  priceCents: number | null;
  currency: string | null;
  /** Set while the plan renews; null once a cancellation is scheduled or it never renews. */
  renewsAt: string | null;
  /** When access through this plan ends: a scheduled cancellation, or a term that does not renew. */
  endsAt: string | null;
  provider: string | null;
  /** A paid plan with no provider behind it: given by the team, charged to nobody. */
  comped: boolean;
};

export type FirmGrant = {
  id: string;
  kind: string;
  plan: string | null;
  source: string;
  createdAt: string;
  expiresAt: string | null;
};

export type FirmFlags = {
  /** Something beyond the floor: a paid or comped plan, or a live grant. */
  hasPlan: boolean;
  pastDue: boolean;
  suspended: boolean;
  cancelScheduled: boolean;
  /** Nobody of the team signed in for a month. */
  idle: boolean;
  /** Somebody who manages the firm has no second factor. */
  noSecondFactor: boolean;
  noOwner: boolean;
  comped: boolean;
};

export type FirmOwner = {
  userId: string;
  name: string | null;
  email: string | null;
  confirmed: boolean;
  bannedUntil: string | null;
};

export type FirmRow = {
  orgId: string;
  name: string;
  createdAt: string;
  owner: FirmOwner | null;
  people: number;
  /** People of the firm who declared a registration at the bar. */
  lawyers: number;
  openInvitations: number;
  /** The most recent sign-in of anybody in the team. */
  lastSignInAt: string | null;
  tier: string | null;
  plan: FirmPlan | null;
  grants: FirmGrant[];
  revenue: { BRL: number; USD: number };
  attribution: { origem?: string; onda?: string; utmSource?: string; utmCampaign?: string };
  flags: FirmFlags;
};

export type FirmTotals = {
  firms: number;
  withPlan: number;
  noPlan: number;
  pastDue: number;
  suspended: number;
  cancelScheduled: number;
  idle: number;
  noSecondFactor: number;
  noOwner: number;
};

export type FirmsOverview = { generatedAt: string; totals: FirmTotals; firms: FirmRow[] };

export type PersonWithoutFirm = {
  userId: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  confirmed: boolean;
  bannedUntil: string | null;
  isSuperadmin: boolean;
  authProvider: string | null;
  /** Invitations addressed to this person's e-mail that are still open. */
  openInvitations: number;
};

export type PeopleWithoutFirm = {
  generatedAt: string;
  totals: { people: number; neverSignedIn: number; invited: number };
  people: PersonWithoutFirm[];
};

/** One filter: the tile that counts it and the rows it selects. */
export type FirmFilter = {
  key: keyof FirmTotals;
  label: string;
  hint: string;
  matches: (row: FirmRow) => boolean;
};

/** Every firm is in exactly one of the last two. */
export const PLAN_FILTERS: FirmFilter[] = [
  { key: "firms", label: "Todos", hint: "Todos os escritórios da plataforma", matches: () => true },
  {
    key: "withPlan",
    label: "Com plano",
    hint: "Têm assinatura, acesso comprado ou cortesia em vigor",
    matches: (row) => row.flags.hasPlan,
  },
  {
    key: "noPlan",
    label: "Sem plano",
    hint: "Foram fundados e não têm assinatura nem cortesia",
    matches: (row) => !row.flags.hasPlan,
  },
];

/** The filters that name something to act on. */
export const ATTENTION_FILTERS: FirmFilter[] = [
  {
    key: "pastDue",
    label: "Inadimplentes",
    hint: "O provedor não conseguiu cobrar a assinatura",
    matches: (row) => row.flags.pastDue,
  },
  {
    key: "idle",
    label: "Parados há 30 dias",
    hint: "Ninguém da equipe entra há um mês ou mais",
    matches: (row) => row.flags.idle,
  },
  {
    key: "noSecondFactor",
    label: "Gestão sem 2FA",
    hint: "Quem gerencia a conta ainda não tem segundo fator e não consegue alterar a equipe",
    matches: (row) => row.flags.noSecondFactor,
  },
  {
    key: "cancelScheduled",
    label: "Cancelamento marcado",
    hint: "Pediram para encerrar no fim do período já pago",
    matches: (row) => row.flags.cancelScheduled,
  },
  {
    key: "suspended",
    label: "Suspensos",
    hint: "Acesso desligado pela equipe da plataforma",
    matches: (row) => row.flags.suspended,
  },
];

export const FIRM_FILTERS: FirmFilter[] = [...PLAN_FILTERS, ...ATTENTION_FILTERS];

export const filterFirms = (rows: FirmRow[], key: keyof FirmTotals): FirmRow[] => {
  const filter = FIRM_FILTERS.find((entry) => entry.key === key);
  return filter ? rows.filter(filter.matches) : rows;
};

/** What the plan column says: the plan sold and its price, a courtesy, or nothing yet. */
export function planLabel(row: FirmRow): string {
  const plan = row.plan;
  if (plan && plan.status !== "canceled") {
    if (plan.comped) return `${plan.name} · cortesia`;
    if (plan.priceCents && plan.priceCents > 0) {
      const period = plan.period ? ` ${labelOf(PERIOD_LABEL, plan.period, "")}` : "";
      return `${plan.name} · ${formatMoney(plan.priceCents, plan.currency)}${period}`;
    }
  }
  if (row.grants.length > 0) {
    return row.grants.some((grant) => grant.source === "admin") ? "Cortesia da equipe" : "Acesso comprado";
  }
  return "Sem plano";
}

/**
 * The ONE time fact that matters for this firm right now, by precedence:
 * money that failed, access that is about to end, then the next renewal.
 */
export function firmClock(row: FirmRow, now: number = Date.now()): string {
  const plan = row.plan;
  if (row.flags.suspended) return "acesso suspenso";
  if (row.flags.pastDue) return "inadimplente";
  if (plan?.endsAt) {
    const days = daysSince(plan.endsAt, now);
    if (days !== null && days > 0) return `encerrou em ${formatDate(plan.endsAt)}`;
    return `${row.flags.cancelScheduled ? "cancela" : "termina"} em ${formatDate(plan.endsAt)}`;
  }
  if (plan?.renewsAt) return `renova em ${formatDate(plan.renewsAt)}`;
  if (plan?.comped) return "cortesia, sem cobrança";
  return "sem cobrança";
}

/** Everything a search box should find a firm by, lower-cased once. */
export function firmSearchText(row: FirmRow): string {
  return [
    row.name,
    row.owner?.name,
    row.owner?.email,
    row.plan?.name,
    row.flags.hasPlan ? "com plano" : "sem plano",
    row.attribution.origem,
    row.attribution.utmCampaign,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** A ban has no end date in this product: the auth API is given a century. */
export const isBanned = (bannedUntil: string | null, now: number = Date.now()): boolean =>
  Boolean(bannedUntil) && new Date(bannedUntil as string).getTime() > now;

// ---------- The dossier ----------

export type DossierPerson = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  firmFunction: string;
  joinedAt: string;
  authProvider: string | null;
  confirmed: boolean;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  timezone: string | null;
  marketingOptOut: boolean | null;
  isSuperadmin: boolean;
  twoFactor: boolean;
  oab: { uf: string; number: string; kind: string }[];
};

export type DossierInvitation = {
  id: string;
  email: string;
  role: string;
  firmFunction: string;
  createdAt: string;
  expiresAt: string;
  status: "open" | "accepted" | "revoked" | "expired";
};

export type DossierSubscription = {
  id: string;
  plan: string;
  status: string;
  period: string | null;
  priceCents: number | null;
  currency: string | null;
  coupon: string | null;
  provider: string | null;
  renews: boolean | null;
  paymentMethod: string | null;
  createdAt: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  cancelReason: string | null;
  cancelNote: string | null;
  canceledAt: string | null;
  pastDueSince: string | null;
  suspended: boolean | null;
};

export type DossierGrant = FirmGrant & {
  priceCents: number | null;
  currency: string | null;
  note: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

export type DossierInvoice = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  provider: string | null;
  hasFiscalDocument: boolean;
};

export type FirmDossier = {
  ok: true;
  generatedAt: string;
  firm: {
    orgId: string;
    name: string;
    slug: string;
    createdAt: string;
    billingDocument: { kind: "cpf" | "cnpj"; lastDigits: string } | null;
  };
  team: DossierPerson[];
  invitations: DossierInvitation[];
  /** `org_entitlements(org)` as the database answers it: the same object every gate reads. */
  entitlements: RpcEntitlements | null;
  money: {
    paid: Record<string, number>;
    refunded: Record<string, number>;
    subscriptions: DossierSubscription[];
    grants: DossierGrant[];
    invoices: DossierInvoice[];
  };
  consent: {
    userId: string;
    slug: string;
    locale: string;
    version: number;
    acceptedAt: string;
    revokedAt: string | null;
  }[];
  access: { signIns30d: number; supportVisits: number };
  attribution: Record<string, string | null> | null;
};

export type DossierResult = FirmDossier | { ok: false; code: string };

// ---------- Reads (the operator's session; RLS and the functions check the role) ----------

export async function loadFirmsOverview(supabase: SupabaseClient): Promise<FirmsOverview> {
  const { data, error } = await supabase.rpc("admin_firms_overview");
  if (error || !data) throw new Error("firms_overview_failed");
  return data as FirmsOverview;
}

export async function loadPeopleWithoutFirm(supabase: SupabaseClient): Promise<PeopleWithoutFirm> {
  const { data, error } = await supabase.rpc("admin_people_without_firm");
  if (error || !data) throw new Error("people_without_firm_failed");
  return data as PeopleWithoutFirm;
}

/**
 * Each partnership of a travel agency with a firm (migrations 0069 to 0072), as the operator reads it: whose, since
 * when, and counts only, never a passenger.
 */
export type PartnerOverviewRow = {
  linkId: string;
  agency: string;
  firm: string;
  status: "active" | "ended";
  startedAt: string | null;
  endedAt: string | null;
  members: number;
  travelers: number;
  handedOver: number;
  watched: number;
  documents: number;
};

/** `admin_partner_overview`, read. Throws when it could not be read. */
export async function loadPartnerOverview(supabase: SupabaseClient): Promise<PartnerOverviewRow[]> {
  const { data, error } = await supabase.rpc("admin_partner_overview");
  if (error || !Array.isArray(data)) throw new Error("partner_overview_failed");
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return (data as Record<string, unknown>[]).flatMap((row) => {
    const linkId = text(row.link_id);
    if (!linkId) return [];
    return [
      {
        linkId,
        agency: text(row.agency) ?? "",
        firm: text(row.firm) ?? "",
        status: row.status === "ended" ? "ended" : "active",
        startedAt: text(row.started_at),
        endedAt: text(row.ended_at),
        members: count(row.members),
        travelers: count(row.travelers),
        handedOver: count(row.handed_over),
        watched: count(row.watched),
        documents: count(row.documents),
      },
    ];
  });
}
