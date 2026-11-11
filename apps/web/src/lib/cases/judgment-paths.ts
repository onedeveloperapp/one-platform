import { type PathOption, pathsAfter } from "@flyee/rules/paths";

/**
 * The judgment: its options, the appeal and its costs (migration 0185, item 4.5 of the case journey plan). Pure: what
 * the database answers, read into what the screens show, and ONE's recommendation by comparing what was asked with
 * what was granted. A recommendation decides nothing: the lawyer decides with it.
 */

export type JudgmentDecision = "aceitar" | "embargos_declaracao" | "recurso_inominado" | "apelacao";
const DECISIONS: readonly JudgmentDecision[] = ["aceitar", "embargos_declaracao", "recurso_inominado", "apelacao"];

export type JudgmentPath = {
  id: string;
  proceedingId: string;
  factId: string;
  clientAgrees: boolean | null;
  clientVia: string | null;
  decision: JudgmentDecision | null;
  decisionReason: string | null;
  decidedAt: string | null;
};

export function judgmentPathsOf(raw: unknown): JudgmentPath[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): JudgmentPath[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.proceeding_id !== "string" || typeof row.fact_id !== "string")
      return [];
    const decision = DECISIONS.find((value) => value === row.decision) ?? null;
    return [
      {
        id: row.id,
        proceedingId: row.proceeding_id,
        factId: row.fact_id,
        clientAgrees: typeof row.client_agrees === "boolean" ? row.client_agrees : null,
        clientVia: typeof row.client_via === "string" ? row.client_via : null,
        decision,
        decisionReason: typeof row.decision_reason === "string" ? row.decision_reason : null,
        decidedAt: typeof row.decided_at === "string" ? row.decided_at : null,
      },
    ];
  });
}

/** The appeal of a kind of lawsuit. */
export const appealOf = (kind: "juizado" | "comum"): JudgmentDecision =>
  kind === "juizado" ? "recurso_inominado" : "apelacao";

/**
 * ONE's recommendation after a judgment: accept one that granted what was asked (or most of it, the share a setting
 * of the rule), appeal one that granted nothing or much less. Never the embargos, which ask a reading of the judgment
 * for an omission, a contradiction or an obscurity that this rule does not make.
 */
export function recommendPath(input: {
  kind: "juizado" | "comum";
  result: string | null;
  requestedCents: number | null;
  grantedCents: number | null;
}): JudgmentDecision {
  if (input.result === "improcedente") return appealOf(input.kind);
  if (input.result === "procedente") return "aceitar";
  if (!input.requestedCents || !input.grantedCents) return "aceitar";
  return input.grantedCents < input.requestedCents / 2 ? appealOf(input.kind) : "aceitar";
}

/** What the options after a judgment are, with their costs, by `caminhos-v1`. */
export function optionsAfter(kind: "juizado" | "comum", freeJustice: boolean, condemnation: boolean) {
  return pathsAfter({ kind, stage: "sentenca", freeJustice, condemnation }).filter((path) =>
    (DECISIONS as readonly PathOption[]).includes(path.option),
  );
}

export const DECISION_KEY: Record<JudgmentDecision, string> = {
  aceitar: "judgment-path-accept",
  embargos_declaracao: "judgment-path-embargos",
  recurso_inominado: "judgment-path-recurso-inominado",
  apelacao: "judgment-path-apelacao",
};

/** What the client's link shows of a judgment. */
export type ClientJudgment = {
  id: string;
  kind: "juizado" | "comum";
  result: string | null;
  cents: number | null;
  freeJustice: boolean;
  agrees: boolean | null;
  decision: JudgmentDecision | null;
};

export function clientJudgmentsOf(raw: unknown): ClientJudgment[] {
  const row = (raw ?? null) as { ok?: unknown; items?: unknown } | null;
  if (!row || row.ok !== true || !Array.isArray(row.items)) return [];
  return row.items.flatMap((item): ClientJudgment[] => {
    const value = (item ?? {}) as Record<string, unknown>;
    if (typeof value.id !== "string") return [];
    return [
      {
        id: value.id,
        kind: value.kind === "comum" ? "comum" : "juizado",
        result: typeof value.result === "string" ? value.result : null,
        cents: Number.isFinite(Number(value.cents)) && value.cents !== null ? Number(value.cents) : null,
        freeJustice: value.free_justice === true,
        agrees: typeof value.agrees === "boolean" ? value.agrees : null,
        decision: DECISIONS.find((decision) => decision === value.decision) ?? null,
      },
    ];
  });
}
