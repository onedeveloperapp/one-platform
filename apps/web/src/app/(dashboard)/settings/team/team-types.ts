import type { SecondFactorState } from "@/lib/ai/approvals";
import type { CertificateKind, CourtSystemName } from "@/lib/cases/statements";
import type { FirmOffice } from "@/lib/firm/office";
import type { FirmFunction, InvitableRole, OabRegistration, OrgRole } from "@/lib/firm/roles";
import type { AuthorizationState, SignatureOutcome } from "@/lib/psc/signature";

/**
 * What a lawyer declared they sign with in one court system (migration 0026):
 * the kind, the issuer and two dates. Nothing of the certificate itself.
 */
export type CertificateEntry = {
  system: CourtSystemName;
  kind: CertificateKind;
  issuer: string | null;
  validUntil: string | null;
  /** When they last confirmed that their computer signs there, on their own clock; null when never. */
  stationCheckedLabel: string | null;
};

/** A lawyer's authorization to sign through ONE with their certificate in the cloud (migration 0041). */
export type CloudSignature = {
  connectionId: string;
  personId: string;
  personName: string;
  pscSlug: string;
  pscName: string;
  state: AuthorizationState;
  /** Until when the authorization lasts, on the reader's clock. */
  untilLabel: string | null;
  /** Whose certificate it is, as the certificate writes it. */
  holder: string | null;
  /** The holder's CPF by its middle only: ***.456.789-**. */
  holderCpf: string | null;
  /** The certificate's own validity, a day on the reader's clock. */
  certificateUntilLabel: string | null;
  lastError: string | null;
  /** When an authorization that ended, ended, on the reader's clock. */
  endedLabel: string | null;
  /** Who of the firm ended it, when a person did; empty when the lawyer did, or nobody did. */
  endedBy: "self" | "person" | "none";
  endedByName: string;
};

/** One opening of a lawyer's authorization, and what came of it. */
export type SignatureUse = {
  id: string;
  purpose: string;
  documents: number;
  status: "opened" | "signed" | "failed";
  errorCode: string | null;
  whenLabel: string;
  personName: string;
  caseId: string | null;
  caseSeq: number | null;
};

/** A PSC the lawyer may authorize ONE at here: the platform has its client there. */
export type PscOffer = { slug: string; name: string };

export type CloudSignatureData = {
  offers: PscOffer[];
  /** The person's own authorizations: in force, failing, or ended in the last 30 days. */
  mine: CloudSignature[];
  /** The colleagues' authorizations in force, for a partner or who manages the firm. */
  team: CloudSignature[];
  /** The latest uses the person may read: their own, or the firm's for a partner or who manages it. */
  uses: SignatureUse[];
  /** What the PSC's return said, when the person just came back from it. */
  outcome: SignatureOutcome | null;
  /** The case the person came from to authorize, to go back to once they did. */
  backToCase: string | null;
  /** The CPF the person declared, by its middle only, or null when they declared none. */
  declaredCpf: string | null;
  /**
   * What ONE's filing waits on the person for (0102): their lawsuits whose files ONE will sign in the cloud, with
   * no authorization of theirs to cover them (no CPF, none, or one that ends within the hours ahead, with when it
   * ends in words: "hoje às 14:30"). Null when nothing waits on them, or it could not be read.
   */
  waiting: { state: "cpf_missing" | "none" | "expiring"; lawsuits: number; endsWords: string } | null;
  secondFactor: SecondFactorState;
  supportVisit: boolean;
};

/** One person of the firm, as `firm_team()` (migration 0003) answers it. */
export type TeamPerson = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: OrgRole;
  firmFunction: FirmFunction;
  joinedAt: string;
  oab: OabRegistration[];
  /** Answered to the owner and the admins only; null for everybody else. */
  hasSecondFactor: boolean | null;
};

/** An invitation still waiting for its answer. Managers only. */
export type TeamInvitation = {
  id: string;
  email: string;
  role: InvitableRole;
  firmFunction: FirmFunction;
  expiresAt: string;
};

export type TeamData = {
  firm: { id: string; name: string };
  /** Where the firm is, as the power of attorney says it (0217); empty fields where it has none. */
  office: FirmOffice;
  me: { userId: string; role: OrgRole; firmFunction: FirmFunction };
  people: TeamPerson[];
  invitations: TeamInvitation[];
  myOab: OabRegistration[];
  /** What the person declared they sign with, per court system. Read by lawyers and partners only. */
  myCertificates: CertificateEntry[];
  /** The signatures in the cloud the person may see; null when they could not be read (the card says so). */
  cloudSignature: CloudSignatureData | null;
  /** The day in Brazil's official time. */
  today: string;
  /** The seats of the plan (`assentos_max`), or null when the plan sets no ceiling. */
  seatCeiling: number | null;
};

/**
 * What the screen renders from. `no-firm` is the platform operator, who works
 * in no firm; `unavailable` is a clone without Supabase; `error` is a read
 * that failed. None of them is ever shown as an empty team.
 */
export type TeamState =
  | ({ kind: "ready" } & TeamData)
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/** The message key of each answer the team functions give (`product` namespace). */
const ERROR_KEYS: Record<string, string> = {
  second_factor_required: "team-error-second-factor",
  not_allowed_in_support_session: "team-error-support-session",
  not_authorized: "team-error-not-authorized",
  invalid_email: "team-error-invalid-email",
  invalid_role: "team-error-invalid-role",
  only_owner_invites_admin: "team-error-only-owner-admin",
  already_member: "team-error-already-member",
  seat_limit: "team-error-seat-limit",
  invite_rate_limited: "team-error-invite-rate",
  invalid_firm_name: "team-error-firm-name",
  not_a_member: "team-error-not-a-member",
  only_owner_changes_managers: "team-error-only-owner-managers",
  owner_role_is_transferred: "team-error-owner-transfer",
  owner_cannot_be_removed: "team-error-owner-transfer",
  owner_must_transfer_first: "team-error-owner-transfer",
  invalid_registration: "team-error-oab-invalid",
  state_already_registered: "team-error-oab-state",
  principal_already_registered: "team-error-oab-principal",
  registration_in_use: "team-error-oab-in-use",
  not_a_lawyer: "team-error-certificate-lawyer",
  invalid_system: "team-error-certificate-invalid",
  invalid_kind: "team-error-certificate-invalid",
  invalid_data: "team-error-certificate-invalid",
};

export const teamErrorKey = (code: string): string => ERROR_KEYS[code] ?? "team-error-failed";
