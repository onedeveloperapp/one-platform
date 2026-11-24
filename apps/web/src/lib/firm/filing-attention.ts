import { systemWords } from "@/lib/cases/filing-waits";
import type { PendingItem } from "@/lib/firm/pending";

/**
 * What ONE's filing waits on a person for (migration 0102), as the center of
 * what waits and the home say it. Pure: no I/O.
 *
 * A lawsuit whose court takes the files signed waits on its lawyers from the
 * moment ONE creates it, never only once its package is built: a CPF never
 * declared, no authorization in the cloud, or one that runs out within the
 * hours ahead (an authorization lasts seven days at most, the provider's own
 * limit). Each lawyer reads their own, and who runs the firm reads the
 * team's; nothing is said where the platform has no provider of the cloud
 * signature (the files are then signed with the court's signer, by hand).
 * A filing ONE sent that came back (refused, failed, sent with no answer,
 * or taken with no number) waits for a partner or a lawyer.
 */

export type SignatureNeed = {
  userId: string;
  name: string;
  /** How many planned lawsuits wait on this lawyer's authorization, and in how many cases. */
  lawsuits: number;
  cases: number;
  /** The first of those cases. */
  seq: number | null;
  caseId: string | null;
  state: "cpf_missing" | "none" | "expiring";
  /** When the authorization in force ends, for `expiring`. */
  expiresAt: string | null;
};

export type FilingNeed = {
  submissionId: string;
  caseId: string;
  seq: number | null;
  status: "refused" | "failed" | "unknown" | "filed";
  since: string | null;
};

/**
 * A package ready to file that nobody files, the setting's days after it was built (0269): of a lawsuit whose
 * lawyers are named, since when, and at which court's system.
 */
export type WaitingFiling = {
  packageId: string;
  caseId: string;
  seq: number | null;
  court: string;
  system: string;
  systemName: string | null;
  since: string;
  lawyers: string[];
};

export type FilingAttention = {
  signatures: SignatureNeed[];
  filings: FilingNeed[];
  filingsTotal: number;
  /** The packages that wait for somebody to file them (0269), the oldest first, and how many in all. */
  waiting: WaitingFiling[];
  waitingTotal: number;
};

/** Who reads it: their own id, their function, whether they run the firm, and whether the platform signs in the cloud. */
export type FilingViewer = {
  userId: string;
  firmFunction: string | null;
  managesFirm: boolean;
  cloudSigning: boolean;
  /** The person's own clock; the platform's (Brasília) when unset. */
  timeZone?: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const whole = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").map((item) => item as Record<string, unknown>)
    : [];
const SIGNATURE_STATES = ["cpf_missing", "none", "expiring"] as const;
const FILING_STATUSES = ["refused", "failed", "unknown", "filed"] as const;

/** The database's answer (`firm_filing_attention`), read; null when it is not one. */
export function readFilingAttention(raw: unknown): FilingAttention | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  if (!Array.isArray(answer.signatures) || !Array.isArray(answer.filings)) return null;
  return {
    signatures: rows(answer.signatures).flatMap((row) => {
      const userId = text(row.user_id);
      const state = (SIGNATURE_STATES as readonly unknown[]).includes(row.state)
        ? (row.state as SignatureNeed["state"])
        : null;
      if (!userId || !state) return [];
      const lawsuits = Math.max(whole(row.lawsuits, 1), 1);
      return [
        {
          userId,
          name: text(row.name) ?? "",
          lawsuits,
          cases: Math.min(Math.max(whole(row.cases, 1), 1), lawsuits),
          seq: typeof row.seq === "number" ? row.seq : null,
          caseId: text(row.case_id),
          state,
          expiresAt: text(row.expires_at),
        },
      ];
    }),
    filings: rows(answer.filings).flatMap((row) => {
      const submissionId = text(row.submission_id);
      const caseId = text(row.case_id);
      const status = (FILING_STATUSES as readonly unknown[]).includes(row.status)
        ? (row.status as FilingNeed["status"])
        : null;
      if (!submissionId || !caseId || !status) return [];
      return [
        { submissionId, caseId, seq: typeof row.seq === "number" ? row.seq : null, status, since: text(row.since) },
      ];
    }),
    filingsTotal: whole(answer.filings_total, 0),
    // Read where the database gives it (0269); an older answer has none.
    waiting: rows(answer.waiting).flatMap((row) => {
      const packageId = text(row.package_id);
      const caseId = text(row.case_id);
      const since = text(row.since);
      if (!packageId || !caseId || !since) return [];
      return [
        {
          packageId,
          caseId,
          seq: typeof row.seq === "number" ? row.seq : null,
          court: text(row.court) ?? "",
          system: text(row.system) ?? "",
          systemName: text(row.system_name),
          since,
          lawyers: Array.isArray(row.lawyers)
            ? row.lawyers.filter((id): id is string => typeof id === "string" && id !== "")
            : [],
        },
      ];
    }),
    waitingTotal: whole(answer.waiting_total, 0),
  };
}

const PLATFORM_ZONE = "America/Sao_Paulo";

/** A zone the clock knows: the person's, or the platform's when theirs is unset or unknown. */
function zoneOf(timeZone: string | null | undefined): string {
  if (!timeZone) return PLATFORM_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(0);
    return timeZone;
  } catch {
    return PLATFORM_ZONE;
  }
}

/**
 * A moment as a person reads it on their clock, with what goes before it in a sentence: "hoje às 14:30",
 * "amanhã às 09:00", or "em 08/11 às 14:30" on another day. Empty when there is no moment.
 */
export function momentWords(iso: string | null, now: Date, timeZone: string | null = null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const zone = zoneOf(timeZone);
  const dayOf = (moment: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(moment);
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(at);
  if (dayOf(at) === dayOf(now)) return `hoje às ${time}`;
  if (dayOf(at) === dayOf(new Date(now.getTime() + 86_400_000))) return `amanhã às ${time}`;
  const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: zone }).format(at);
  return `em ${date} às ${time}`;
}

const FILING_KEY: Record<FilingNeed["status"], string> = {
  refused: "pending-filing-refused",
  failed: "pending-filing-failed",
  unknown: "pending-filing-unknown",
  filed: "pending-filing-unnumbered",
};

/** What to do with each filing that came back, said under it with its case. */
const FILING_DETAIL_KEY: Record<FilingNeed["status"], string> = {
  refused: "pending-filing-refused-detail",
  failed: "pending-filing-failed-detail",
  unknown: "pending-filing-unknown-detail",
  filed: "pending-filing-unnumbered-detail",
};

/** The words of a lawyer's own need, and of a colleague's, by its state. */
const OWN_KEY: Record<SignatureNeed["state"], string> = {
  cpf_missing: "pending-cloud-signature-cpf",
  none: "pending-cloud-signature-none",
  expiring: "pending-cloud-signature-expiring",
};
const OTHER_KEY: Record<SignatureNeed["state"], string> = {
  cpf_missing: "pending-cloud-signature-other",
  none: "pending-cloud-signature-other",
  expiring: "pending-cloud-signature-other-expiring",
};

/**
 * The lines of the center and of the home, all under "O ONE precisa de você": each keeps ONE from going on with a
 * lawsuit, an authorization running out within the hours ahead included. A lawyer reads their own need; a partner, or
 * who manages the firm, also reads the team's. A filing that came back is read by who files (a partner or a lawyer).
 */
export function filingAttentionItems(
  attention: FilingAttention,
  viewer: FilingViewer,
  now: Date = new Date(),
): PendingItem[] {
  const one: PendingItem[] = [];
  const signs = viewer.firmFunction === "socio" || viewer.firmFunction === "advogado";

  if (viewer.cloudSigning) {
    const seesTeam = viewer.firmFunction === "socio" || viewer.managesFirm;
    for (const need of attention.signatures) {
      const own = need.userId === viewer.userId;
      if (own ? !signs : !seesTeam) continue;
      one.push({
        id: `cloud-signature:${need.userId}:${need.state}`,
        // The person's own authorization is in their practice; a colleague's, in the team.
        href: own ? "/settings/atuacao#team-cloud-signature" : "/settings/team#team-cloud-signature",
        tag: { key: "pending-tag-cloud-signature" },
        label: {
          key: own ? OWN_KEY[need.state] : OTHER_KEY[need.state],
          values: {
            count: need.lawsuits,
            // A colleague with no name on record is still named as who they are to the firm.
            name: need.name || { message: "pending-cloud-signature-someone" },
            when: momentWords(need.expiresAt, now, viewer.timeZone ?? null),
          },
        },
        ...(need.seq !== null
          ? { detail: { key: "pending-cloud-signature-detail", values: { seq: need.seq, others: need.cases - 1 } } }
          : {}),
        count: need.lawsuits,
      });
    }
  }

  if (signs) {
    for (const need of attention.filings) {
      one.push({
        id: `filing:${need.submissionId}:${need.status}`,
        href: `/casos/${need.caseId}#case-filing`,
        tag: { key: "pending-tag-filing" },
        label: { key: FILING_KEY[need.status] },
        ...(need.seq !== null ? { detail: { key: FILING_DETAIL_KEY[need.status], values: { seq: need.seq } } } : {}),
        count: 1,
      });
    }
    const unlisted = attention.filingsTotal - attention.filings.length;
    if (unlisted > 0) {
      one.push({
        id: "filings:more",
        href: "/protocolo",
        tag: { key: "pending-tag-filing" },
        label: { key: "pending-filings-more", values: { count: unlisted } },
        count: unlisted,
      });
    }
  }
  one.push(...waitingFilingItems(attention, viewer));
  return one;
}

/** A day as the center says it, on the person's clock: "20/11". */
function dayWords(iso: string, timeZone: string | null | undefined): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: zoneOf(timeZone) }).format(at);
}

/**
 * The packages that wait for somebody to file them (0269): each lawyer of the lawsuit reads it as theirs, and a partner,
 * or who manages the firm, reads the team's too; the line leads to the case's filing card, which says what to do
 * there (the guide by hand, a choice of a way, a batch to approve). Past the list, one line counts the rest.
 */
export function waitingFilingItems(attention: FilingAttention, viewer: FilingViewer): PendingItem[] {
  const seesTeam = viewer.firmFunction === "socio" || viewer.managesFirm;
  const items: PendingItem[] = [];
  for (const need of attention.waiting) {
    const own = need.lawyers.includes(viewer.userId);
    // A lawyer who signs none of it reads nothing of it: it is not theirs to file.
    if (!own && !seesTeam) continue;
    items.push({
      id: `filing-waits:${need.packageId}`,
      href: `/casos/${need.caseId}#case-filing`,
      tag: { key: "pending-tag-filing" },
      label: {
        key: own ? "pending-filing-waits-mine" : "pending-filing-waits",
        values: { since: dayWords(need.since, viewer.timeZone ?? null) },
      },
      detail: {
        key: need.seq !== null ? "pending-filing-waits-detail" : "pending-filing-waits-detail-plain",
        values: {
          seq: need.seq ?? 0,
          system: systemWords(need),
        },
      },
      count: 1,
    });
  }
  const unlisted = attention.waitingTotal - attention.waiting.length;
  if (seesTeam && unlisted > 0) {
    items.push({
      id: "filing-waits:more",
      href: "/protocolo",
      tag: { key: "pending-tag-filing" },
      label: { key: "pending-filing-waits-more", values: { count: unlisted } },
      count: unlisted,
    });
  }
  return items;
}

/** The person's own need, for the team's card of the signature in the cloud; null when nothing waits on them. */
export function ownSignatureNeed(attention: FilingAttention | null, userId: string): SignatureNeed | null {
  return attention?.signatures.find((need) => need.userId === userId) ?? null;
}
