/**
 * What each lawsuit of a case came to (phase 6 of the plan of the controladoria and the finance, migration 0130), as
 * the case screen and the center of what waits read it: the facts of each lawsuit (a judgment and its result, a
 * settlement, the judgment become final, an appeal, a deposit, a release and what it paid, the archiving), each said
 * as ONE's or a person's, with the court's words beside it; and what the results ask of the firm's people. Pure.
 */
import type { PendingItem } from "@/lib/firm/pending";
import { formatCents } from "@flyee/rules/finance";

export const FACT_KINDS = ["sentenca", "acordo", "transito", "recurso", "deposito", "alvara", "arquivamento"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export type FactResult = "procedente" | "parcial" | "improcedente";

export type LawsuitFact = {
  id: string;
  proceedingId: string;
  kind: FactKind;
  result: FactResult | null;
  appealBy: "autor" | "re" | null;
  releaseKind: "alvara" | "transferencia" | "rpv" | "precatorio" | null;
  cents: number | null;
  perClaimant: boolean;
  happenedOn: string;
  words: string | null;
  byOne: boolean;
  confirmed: boolean;
  ackOwed: boolean;
  ackedAt: string | null;
  receivedCents: number | null;
  receivedOn: string | null;
  /** ONE read the release's money in the bank's statement (0155). */
  receivedByOne?: boolean;
  corrected: boolean;
  correctedReason: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const integer = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

/** The rows of `lawsuit_facts`, read; a row this code does not know is left out. */
export function lawsuitFactsOf(raw: unknown): LawsuitFact[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): LawsuitFact[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const kind = FACT_KINDS.find((known) => known === row.kind);
    const id = text(row.id);
    const proceedingId = text(row.proceeding_id);
    if (!kind || !id || !proceedingId) return [];
    const result = ["procedente", "parcial", "improcedente"].includes(String(row.result))
      ? (row.result as FactResult)
      : null;
    return [
      {
        id,
        proceedingId,
        kind,
        result,
        appealBy: row.appeal_by === "autor" || row.appeal_by === "re" ? row.appeal_by : null,
        releaseKind: ["alvara", "transferencia", "rpv", "precatorio"].includes(String(row.release_kind))
          ? (row.release_kind as LawsuitFact["releaseKind"])
          : null,
        cents: integer(row.cents),
        perClaimant: row.per_claimant === true,
        happenedOn: String(row.happened_on ?? ""),
        words: text(row.words),
        byOne: row.by_one === true,
        confirmed: row.confirmed !== false,
        ackOwed: row.ack_owed === true,
        ackedAt: text(row.acked_at),
        receivedCents: integer(row.received_cents),
        receivedOn: text(row.received_on),
        receivedByOne: row.received_by_one === true,
        corrected: row.corrected_at !== null && row.corrected_at !== undefined,
        correctedReason: text(row.corrected_reason),
      },
    ];
  });
}

/** The words of each kind of fact, and of a judgment's result. */
export const FACT_KEY: Record<FactKind, string> = {
  sentenca: "outcome-fact-sentenca",
  acordo: "outcome-fact-acordo",
  transito: "outcome-fact-transito",
  recurso: "outcome-fact-recurso",
  deposito: "outcome-fact-deposito",
  alvara: "outcome-fact-alvara",
  arquivamento: "outcome-fact-arquivamento",
};
export const RESULT_KEY: Record<FactResult, string> = {
  procedente: "outcome-result-procedente",
  parcial: "outcome-result-parcial",
  improcedente: "outcome-result-improcedente",
};

/** Where a lawsuit stands by its facts in force: ended, final, judged, settled, or still in course. */
export type LawsuitOutcome = "archived" | "final" | "judged" | "settled" | "open";

export function lawsuitOutcome(facts: readonly LawsuitFact[]): LawsuitOutcome {
  const live = facts.filter((fact) => !fact.corrected && fact.confirmed);
  if (live.some((fact) => fact.kind === "arquivamento")) return "archived";
  if (live.some((fact) => fact.kind === "transito")) return "final";
  if (live.some((fact) => fact.kind === "acordo")) return "settled";
  if (live.some((fact) => fact.kind === "sentenca")) return "judged";
  return "open";
}

/** A fact's value as a person reads it: "R$ 5.000,00 por autor". */
export function factValue(fact: Pick<LawsuitFact, "cents" | "perClaimant">): string | null {
  if (!fact.cents) return null;
  return fact.perClaimant ? `${formatCents(fact.cents)} por autor` : formatCents(fact.cents);
}

/** What the results ask of the firm's people (`firm_outcome_attention`). */
export type OutcomeAttention = {
  acks: { factId: string; caseId: string; seq: number | null; kind: FactKind; result: FactResult | null }[];
  unconfirmed: { factId: string; caseId: string; seq: number | null; kind: FactKind }[];
  releases: { factId: string; caseId: string; seq: number | null; cents: number | null }[];
  readyToClose: { caseId: string; seq: number | null }[];
  closedByOne: { caseId: string; seq: number | null }[];
};

export function outcomeAttentionOf(raw: unknown): OutcomeAttention | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  const rows = (value: unknown) =>
    (Array.isArray(value) ? value : []).map((item) => (item ?? {}) as Record<string, unknown>);
  const kindOf = (value: unknown) => FACT_KINDS.find((known) => known === value) ?? null;
  return {
    acks: rows(answer.acks).flatMap((row) => {
      const kind = kindOf(row.kind);
      const factId = text(row.fact_id);
      const caseId = text(row.case_id);
      return kind && factId && caseId
        ? [
            {
              factId,
              caseId,
              seq: integer(row.seq),
              kind,
              result: ["procedente", "parcial", "improcedente"].includes(String(row.result))
                ? (row.result as FactResult)
                : null,
            },
          ]
        : [];
    }),
    unconfirmed: rows(answer.unconfirmed).flatMap((row) => {
      const kind = kindOf(row.kind);
      const factId = text(row.fact_id);
      const caseId = text(row.case_id);
      return kind && factId && caseId ? [{ factId, caseId, seq: integer(row.seq), kind }] : [];
    }),
    releases: rows(answer.releases).flatMap((row) => {
      const factId = text(row.fact_id);
      const caseId = text(row.case_id);
      return factId && caseId ? [{ factId, caseId, seq: integer(row.seq), cents: integer(row.cents) }] : [];
    }),
    readyToClose: rows(answer.ready_to_close).flatMap((row) => {
      const caseId = text(row.case_id);
      return caseId ? [{ caseId, seq: integer(row.seq) }] : [];
    }),
    closedByOne: rows(answer.closed_by_one).flatMap((row) => {
      const caseId = text(row.case_id);
      return caseId ? [{ caseId, seq: integer(row.seq) }] : [];
    }),
  };
}

const caseHref = (caseId: string) => `/casos/${caseId}#resultado`;
const ACK_KEY = {
  against: "pending-outcome-against",
  archived: "pending-outcome-archived",
  final: "pending-outcome-final",
} as const;

/** The lines of the center of what waits for the results, each one click from its case. */
export function outcomeAttentionItems(attention: OutcomeAttention): PendingItem[] {
  const items: PendingItem[] = [];
  for (const ack of attention.acks.slice(0, 10)) {
    const against = ack.kind === "sentenca" && ack.result === "improcedente";
    items.push({
      id: `outcome:ack:${ack.factId}`,
      href: caseHref(ack.caseId),
      tag: { key: "pending-tag-outcome" },
      label: {
        key: ACK_KEY[against ? "against" : ack.kind === "arquivamento" ? "archived" : "final"],
        values: { seq: ack.seq ?? 0 },
      },
      detail: against ? { key: "pending-outcome-against-detail" } : { key: "pending-outcome-ack-detail" },
      count: 1,
    });
  }
  for (const release of attention.releases.slice(0, 10)) {
    items.push({
      id: `outcome:release:${release.factId}`,
      href: caseHref(release.caseId),
      tag: { key: "pending-tag-outcome" },
      label: { key: "pending-outcome-release", values: { seq: release.seq ?? 0 } },
      detail: release.cents
        ? { key: "pending-outcome-release-value", values: { value: formatCents(release.cents) } }
        : { key: "pending-outcome-release-detail" },
      count: 1,
    });
  }
  if (attention.unconfirmed.length > 0) {
    items.push({
      id: "outcome:unconfirmed",
      href: caseHref(attention.unconfirmed[0].caseId),
      tag: { key: "pending-tag-outcome" },
      label: { key: "pending-outcome-unconfirmed", values: { count: attention.unconfirmed.length } },
      count: attention.unconfirmed.length,
    });
  }
  for (const ready of attention.readyToClose.slice(0, 10)) {
    items.push({
      id: `outcome:close:${ready.caseId}`,
      href: caseHref(ready.caseId),
      tag: { key: "pending-tag-outcome" },
      label: { key: "pending-outcome-ready", values: { seq: ready.seq ?? 0 } },
      count: 1,
    });
  }
  for (const closed of attention.closedByOne.slice(0, 10)) {
    items.push({
      id: `outcome:closed:${closed.caseId}`,
      href: caseHref(closed.caseId),
      tag: { key: "pending-tag-outcome" },
      label: { key: "pending-outcome-closed", values: { seq: closed.seq ?? 0 } },
      detail: { key: "pending-outcome-closed-detail" },
      count: 1,
    });
  }
  return items;
}
