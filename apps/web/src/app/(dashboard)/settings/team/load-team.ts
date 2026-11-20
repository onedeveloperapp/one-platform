import type {
  CertificateEntry,
  CloudSignature,
  CloudSignatureData,
  SignatureUse,
  TeamInvitation,
  TeamPerson,
  TeamState,
} from "./team-types";
import { cookies } from "next/headers";

import { momentLabel, type SecondFactorState } from "@/lib/ai/approvals";
import { isCertificateKind, isCourtSystemName } from "@/lib/cases/statements";
import { loadFilingWays } from "@/lib/filing-ways/read";
import { momentWords, ownSignatureNeed, readFilingAttention } from "@/lib/firm/filing-attention";
import { EMPTY_OFFICE, OFFICE_COLUMNS, officeOf } from "@/lib/firm/office";
import {
  isFirmFunction,
  isInvitableRole,
  isManager,
  isOrgRole,
  OAB_STATES,
  type OabRegistration,
} from "@/lib/firm/roles";
import { getMemberContext, type MemberContext } from "@/lib/member/context";
import { pscAvailable } from "@/lib/psc/provider";
import { authorizationState, cpfMiddleLabel, isSignatureOutcome } from "@/lib/psc/signature";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";
import { limitOf } from "@flyee/billing/entitlements";

type TeamRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  role: string;
  firm_function: string;
  joined_at: string;
  oab: unknown;
  has_second_factor: boolean | null;
};

type InvitationRow = { id: string; email: string; role: string; firm_function: string; expires_at: string };

type OabRow = { id: string; uf: string; number: string; kind: string };
type CertificateRow = {
  system: string;
  kind: string;
  issuer: string | null;
  valid_until: string | null;
  station_checked_at: string | null;
};

type PscOfferRow = { slug: string; name: string };
type SignatureRow = {
  id: string;
  person_id: string;
  provider: string;
  label: string;
  status: string;
  expires_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  disconnected_by: string | null;
  disconnected_at: string | null;
  updated_at: string;
};
type UseRow = {
  id: string;
  person_id: string | null;
  purpose: string;
  document_hashes: string[];
  status: string;
  error_code: string | null;
  opened_at: string;
  case_id: string | null;
};

/** How long an authorization that ended stays on its lawyer's card, with when and why it ended. */
const ENDED_SHOWN_DAYS = 30;

/** A day on the reader's clock, as the screens write one. */
const dayLabel = (value: string, timeZone: string | null | undefined): string => {
  const write = (zone: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: zone }).format(new Date(value));
  try {
    return write(timeZone || "America/Sao_Paulo");
  } catch {
    return write("America/Sao_Paulo");
  }
};

/**
 * The signatures in the cloud the person may see (migration 0041): the PSCs
 * offered here, their own authorizations and CPF, the team's authorizations
 * in force for a partner or who manages the firm, and the latest uses each
 * may read. Read under the person's own session, the database deciding who
 * reads what. A read that fails leaves the card alone to say so (null), never
 * the whole screen.
 */
async function loadCloudSignatures(
  context: MemberContext,
  firmId: string,
  nameOf: Map<string, string>,
  outcome: string | null,
  backToCase: string | null,
): Promise<CloudSignatureData | null> {
  const timezone = context.profile.timezone;
  const [pscRows, signatureRows, useRows, declared, assurance, cookieStore, attention] = await Promise.all([
    context.supabase.from("psc_providers").select("slug, name").eq("active", true).order("name"),
    context.supabase
      .from("connections")
      .select(
        "id, person_id, provider, label, status, expires_at, last_error, metadata, disconnected_by, disconnected_at, updated_at",
      )
      .eq("org_id", firmId)
      .like("provider", "psc.%")
      .order("updated_at", { ascending: false }),
    context.supabase
      .from("lawyer_signature_uses")
      .select("id, person_id, purpose, document_hashes, status, error_code, opened_at, case_id")
      .eq("org_id", firmId)
      .order("opened_at", { ascending: false })
      .limit(10),
    context.supabase.from("lawyer_cpfs").select("cpf").eq("user_id", context.userId).maybeSingle(),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
    // What ONE's filing waits on the person for (0102), the same reading the center of what waits says. Unread, the
    // card says the rest as before.
    context.supabase
      .rpc("firm_filing_attention", { target_org: firmId })
      .then(({ data, error }) => (error ? null : readFilingAttention(data))),
  ]);
  if (pscRows.error || signatureRows.error || useRows.error || declared.error) return null;
  const need = ownSignatureNeed(attention, context.userId);

  const uses = (useRows.data ?? []) as UseRow[];
  const caseIds = [...new Set(uses.map((row) => row.case_id).filter((id): id is string => !!id))];
  const cases = caseIds.length
    ? await context.supabase.from("cases").select("id, seq").in("id", caseIds)
    : { data: [] as { id: string; seq: number }[], error: null };
  const seqOf = new Map(((cases.data ?? []) as { id: string; seq: number }[]).map((row) => [row.id, row.seq]));

  const now = Date.now();
  const signatures: CloudSignature[] = ((signatureRows.data ?? []) as SignatureRow[]).map((row) => {
    const metadata = row.metadata ?? {};
    const validUntil = typeof metadata.valid_until === "string" ? metadata.valid_until : null;
    const state = authorizationState(row.status, row.expires_at, now);
    const endedAt =
      state !== "ended"
        ? null
        : row.status === "disconnected"
          ? row.disconnected_at
          : (row.expires_at ?? row.updated_at);
    return {
      connectionId: row.id,
      personId: row.person_id,
      personName: nameOf.get(row.person_id) ?? "",
      pscSlug: row.provider.slice(4),
      pscName: row.label,
      state,
      untilLabel: row.expires_at ? momentLabel(row.expires_at, timezone) : null,
      holder: typeof metadata.holder === "string" ? metadata.holder : null,
      holderCpf: cpfMiddleLabel(metadata.holder_cpf_middle),
      certificateUntilLabel:
        validUntil && !Number.isNaN(Date.parse(validUntil)) ? dayLabel(validUntil, timezone) : null,
      lastError: row.last_error,
      endedLabel: endedAt ? momentLabel(endedAt, timezone) : null,
      endedBy:
        row.status === "disconnected" && row.disconnected_by
          ? row.disconnected_by === row.person_id
            ? "self"
            : "person"
          : "none",
      endedByName: (row.disconnected_by && nameOf.get(row.disconnected_by)) || "",
    };
  });
  const recentlyEnded = (row: SignatureRow) => {
    const at = row.status === "disconnected" ? row.disconnected_at : (row.expires_at ?? row.updated_at);
    return !!at && now - Date.parse(at) < ENDED_SHOWN_DAYS * 24 * 60 * 60 * 1000;
  };
  const rows = (signatureRows.data ?? []) as SignatureRow[];

  return {
    offers: ((pscRows.data ?? []) as PscOfferRow[])
      .filter((row) => pscAvailable(row.slug))
      .map((row) => ({ slug: row.slug, name: row.name })),
    // A start that never came back is no authorization: the upkeep removes it.
    mine: signatures.filter(
      (item, index) =>
        item.personId === context.userId &&
        item.state !== "pending" &&
        (item.state !== "ended" || recentlyEnded(rows[index])),
    ),
    team: signatures.filter(
      (item) => item.personId !== context.userId && (item.state === "active" || item.state === "failing"),
    ),
    uses: uses.map(
      (row): SignatureUse => ({
        id: row.id,
        purpose: row.purpose,
        documents: Array.isArray(row.document_hashes) ? row.document_hashes.length : 0,
        status: row.status === "signed" || row.status === "failed" ? row.status : "opened",
        errorCode: row.error_code,
        whenLabel: momentLabel(row.opened_at, timezone),
        personName: (row.person_id && nameOf.get(row.person_id)) || "",
        caseId: row.case_id,
        caseSeq: row.case_id ? (seqOf.get(row.case_id) ?? null) : null,
      }),
    ),
    outcome: isSignatureOutcome(outcome) ? outcome : null,
    backToCase,
    declaredCpf: typeof declared.data?.cpf === "string" ? cpfMiddleLabel(declared.data.cpf.slice(3, 9)) : null,
    waiting: need
      ? { state: need.state, lawsuits: need.lawsuits, endsWords: momentWords(need.expiresAt, new Date(), timezone) }
      : null,
    secondFactor: (assurance.data?.currentLevel === "aal2"
      ? "ok"
      : assurance.data?.nextLevel === "aal2"
        ? "challenge"
        : "missing") as SecondFactorState,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
  };
}

const toOab = (rows: unknown): OabRegistration[] =>
  (Array.isArray(rows) ? (rows as OabRow[]) : [])
    .filter((row) => (OAB_STATES as readonly string[]).includes(row.uf))
    .map((row) => ({
      id: row.id,
      uf: row.uf as OabRegistration["uf"],
      number: row.number,
      kind: row.kind === "suplementar" ? "suplementar" : "principal",
    }));

/**
 * What the team's pages read (`/settings/team`, `/settings/atuacao`, `/settings/escritorio`): who is in the firm
 * and what each one does, the invitations waiting for an answer, the person's own registrations at the bar and
 * certificates, and the signatures in the cloud (the person's own authorization, and the team's for a partner or who
 * manages the firm). Read under the person's own session: `firm_team()` is how colleagues read each other, the
 * invitations come back only to who manages the firm, and an authorization and its uses only to their lawyer, a
 * partner and who manages the firm (0041).
 */
export async function loadTeam(signatureOutcome: string | null, backToCase: string | null): Promise<TeamState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const manager = isManager(firm.role);

  const [team, invitations, registrations, certificates, office] = await Promise.all([
    context.supabase.rpc("firm_team", { target_org: firm.id }),
    manager
      ? context.supabase
          .from("firm_invitations")
          .select("id, email, role, firm_function, expires_at")
          .eq("org_id", firm.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as InvitationRow[], error: null }),
    context.supabase
      .from("oab_registrations")
      .select("id, uf, number, kind")
      .eq("user_id", context.userId)
      .order("kind")
      .order("uf"),
    context.supabase
      .from("certificate_inventory")
      .select("system, kind, issuer, valid_until, station_checked_at")
      .eq("org_id", firm.id)
      .eq("user_id", context.userId)
      .order("system"),
    // Where the firm is, as the power of attorney says it (0217): a read that fails leaves the fields empty.
    context.supabase.from("organizations").select(OFFICE_COLUMNS).eq("id", firm.id).maybeSingle(),
  ]);
  if (team.error || invitations.error || registrations.error || certificates.error) return { kind: "error" };

  const people: TeamPerson[] = ((team.data ?? []) as TeamRow[])
    .filter((row) => isOrgRole(row.role) && isFirmFunction(row.firm_function))
    .map((row) => ({
      userId: row.user_id,
      name: row.display_name?.trim() || row.email?.split("@")[0] || "",
      email: row.email ?? "",
      avatarUrl: row.avatar_url,
      role: row.role as TeamPerson["role"],
      firmFunction: row.firm_function as TeamPerson["firmFunction"],
      joinedAt: row.joined_at,
      oab: toOab(row.oab),
      hasSecondFactor: row.has_second_factor,
    }));

  const open: TeamInvitation[] = ((invitations.data ?? []) as InvitationRow[])
    .filter((row) => isInvitableRole(row.role) && isFirmFunction(row.firm_function))
    .map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role as TeamInvitation["role"],
      firmFunction: row.firm_function as TeamInvitation["firmFunction"],
      expiresAt: row.expires_at,
    }));

  const ceiling = limitOf(context.entitlements.limits, "assentos_max");

  // The card of the signatures in the cloud is a partner's, a lawyer's or that of who manages the firm.
  const lawyer = firm.firmFunction === "socio" || firm.firmFunction === "advogado";
  const cloudSignature =
    lawyer || manager
      ? await loadCloudSignatures(
          context,
          firm.id,
          new Map(people.map((person) => [person.userId, person.name])),
          signatureOutcome,
          backToCase,
        )
      : null;

  // How the person files on the courts' screens (0263): a partner's or a lawyer's own card.
  const filingWays = lawyer ? await loadFilingWays(context) : null;

  return {
    kind: "ready",
    firm: { id: firm.id, name: firm.name },
    office: office.error ? EMPTY_OFFICE : officeOf(office.data),
    me: { userId: context.userId, role: firm.role, firmFunction: firm.firmFunction },
    people,
    invitations: open,
    myOab: toOab(registrations.data),
    myCertificates: ((certificates.data ?? []) as CertificateRow[])
      .filter((row) => isCourtSystemName(row.system) && isCertificateKind(row.kind))
      .map((row) => ({
        system: row.system as CertificateEntry["system"],
        kind: row.kind as CertificateEntry["kind"],
        issuer: row.issuer,
        validUntil: row.valid_until,
        stationCheckedLabel: row.station_checked_at
          ? momentLabel(row.station_checked_at, context.profile.timezone)
          : null,
      })),
    cloudSignature,
    filingWays,
    today: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()),
    seatCeiling: ceiling > 0 ? ceiling : null,
  };
}

const CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * What a team page's address carries: the PSC's answer to an authorization (`assinatura`), and the case a lawyer came
 * from to authorize the signature of its files (`voltar`, only a case's id, never an address).
 */
export function teamQuery(query: Record<string, string | string[] | undefined>) {
  return {
    outcome: typeof query.assinatura === "string" ? query.assinatura.slice(0, 40) : null,
    backToCase: typeof query.voltar === "string" && CASE_ID.test(query.voltar) ? query.voltar : null,
  };
}
