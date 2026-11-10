import type { TextBlock } from "@flyee/documents/text-pdf";
import { formatCnj } from "@flyee/rules/cnj";

/**
 * The test court (migration 0061), as its page reads it: the steps a court
 * takes on a lawsuit of the small-claims court, in their order and with what
 * each needs done before it (the database checks the same), the words of
 * each answer, the readers of what the database answers, and the receipt it
 * hands for a filing. Pure: the reads and the writes are
 * `lib/test-court/actions.ts`.
 */

export const COURT_STEPS = [
  "distribuicao",
  "audiencia",
  "audiencia_realizada",
  "manifestacao",
  "sentenca",
  "sentenca_parcial",
  "sentenca_improcedente",
  "acordo",
  "recurso_re",
  "transito",
  "alvara",
  "arquivamento",
] as const;
export type CourtStep = (typeof COURT_STEPS)[number];
export const isCourtStep = (value: unknown): value is CourtStep => (COURT_STEPS as readonly unknown[]).includes(value);

/** What each step needs done before it. */
const NEEDS: Record<CourtStep, readonly CourtStep[]> = {
  distribuicao: [],
  audiencia: ["distribuicao"],
  audiencia_realizada: ["audiencia"],
  manifestacao: ["distribuicao"],
  sentenca: ["distribuicao"],
  sentenca_parcial: ["distribuicao"],
  sentenca_improcedente: ["distribuicao"],
  acordo: ["distribuicao"],
  recurso_re: [],
  transito: [],
  alvara: [],
  arquivamento: [],
};

/** The ways a lawsuit is judged (0130): one per lawsuit, a settlement among them. */
const JUDGMENTS: readonly CourtStep[] = ["sentenca", "sentenca_parcial", "sentenca_improcedente", "acordo"];
const judged = (done: readonly string[]) => done.some((step) => (JUDGMENTS as readonly string[]).includes(step));

/** Whether a step may be taken now: not done yet, the lawsuit not archived, and what it needs done. */
export function stepOpen(step: CourtStep, done: readonly string[]): boolean {
  if (done.includes(step) || done.includes("arquivamento")) return false;
  if (JUDGMENTS.includes(step) && judged(done)) return false;
  // What follows a judgment needs one, whatever its way; a release needs the judgment final or a settlement, and a
  // judgment that denied the claim releases nothing (the database checks the same).
  if (step === "transito" || step === "arquivamento" || step === "recurso_re") return judged(done);
  if (step === "alvara") {
    return (done.includes("transito") || done.includes("acordo")) && !done.includes("sentenca_improcedente");
  }
  return NEEDS[step].every((needed) => done.includes(needed));
}

/** Whether a step waits for its time: a hearing is held from its moment, never before it (the database checks the same). */
export function stepWaits(step: CourtStep, hearingAt: number | null, now: number): boolean {
  return step === "audiencia_realizada" && hearingAt !== null && now < hearingAt;
}

/** The words of each step, in the `product` namespace: what the court does, and what the firm then sees in ONE. */
export const STEP_KEY: Record<CourtStep, { title: string; body: string }> = {
  distribuicao: { title: "test-court-step-distribuicao", body: "test-court-step-distribuicao-body" },
  audiencia: { title: "test-court-step-audiencia", body: "test-court-step-audiencia-body" },
  audiencia_realizada: {
    title: "test-court-step-audiencia-realizada",
    body: "test-court-step-audiencia-realizada-body",
  },
  manifestacao: { title: "test-court-step-manifestacao", body: "test-court-step-manifestacao-body" },
  sentenca: { title: "test-court-step-sentenca", body: "test-court-step-sentenca-body" },
  sentenca_parcial: { title: "test-court-step-sentenca-parcial", body: "test-court-step-sentenca-parcial-body" },
  sentenca_improcedente: {
    title: "test-court-step-sentenca-improcedente",
    body: "test-court-step-sentenca-improcedente-body",
  },
  acordo: { title: "test-court-step-acordo", body: "test-court-step-acordo-body" },
  recurso_re: { title: "test-court-step-recurso-re", body: "test-court-step-recurso-re-body" },
  transito: { title: "test-court-step-transito", body: "test-court-step-transito-body" },
  alvara: { title: "test-court-step-alvara", body: "test-court-step-alvara-body" },
  arquivamento: { title: "test-court-step-arquivamento", body: "test-court-step-arquivamento-body" },
};

/** What the court answered a step, in words. */
const ANSWER_KEY: Record<string, string> = {
  already: "test-court-error-already",
  archived: "test-court-error-archived",
  hearing_later: "test-court-error-hearing-later",
  not_distributed: "test-court-error-not-distributed",
  no_hearing: "test-court-error-no-hearing",
  no_judgment: "test-court-error-no-judgment",
  not_final: "test-court-error-not-final",
  not_filed: "test-court-error-not-filed",
  nothing_to_release: "test-court-error-nothing-to-release",
};
export const answerKey = (code: string): string => ANSWER_KEY[code] ?? "test-court-error-failed";

/** How many days the test court leaves a lawsuit quiet (0114): each one past a mark of the controladoria (30, 45, 90). */
export const QUIET_DAYS = [31, 46, 91] as const;
export type QuietDays = (typeof QUIET_DAYS)[number];
export const isQuietDays = (value: unknown): value is QuietDays => (QUIET_DAYS as readonly unknown[]).includes(value);

export type TestCourtPackage = {
  id: string;
  proceedingId: string;
  caseSeq: number | null;
  client: string | null;
  court: string | null;
  kind: string | null;
  comarca: string | null;
  files: number;
  /** The number the test court gives the lawsuit, 20 digits. */
  number: string | null;
};

export type TestCourtLawsuit = {
  id: string;
  caseSeq: number | null;
  client: string | null;
  cnj: string;
  court: string | null;
  kind: string | null;
  comarca: string | null;
  /** The lawsuit in ONE: filed, or closed by the firm. */
  status: string;
  done: CourtStep[];
  /** When the hearing the court set is, as its movement says it. */
  hearing: string | null;
  /** The instant of that hearing, in milliseconds: the court holds it from then. */
  hearingAt: number | null;
};

export type TestCourtView = { firm: string; packages: TestCourtPackage[]; lawsuits: TestCourtLawsuit[] };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value)
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : null;
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
/** An instant the database writes in UTC (2026-10-27T13:15:00Z), in milliseconds. */
const instant = (value: unknown): number | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ? Date.parse(value) : null;

/** The page's view from what `test_court_view` answers; null for a link that opens nothing. */
export function testCourtViewOf(raw: unknown): TestCourtView | null {
  const answer = (raw ?? {}) as Record<string, unknown>;
  if (answer.found !== true) return null;
  return {
    firm: text(answer.firm) ?? "",
    packages: rows(answer.packages).flatMap((row): TestCourtPackage[] => {
      const id = text(row.id);
      const proceedingId = text(row.proceeding_id);
      if (!id || !proceedingId) return [];
      const number = text(row.number);
      return [
        {
          id,
          proceedingId,
          caseSeq: whole(row.case_seq),
          client: text(row.client),
          court: text(row.court),
          kind: text(row.kind),
          comarca: text(row.comarca),
          files: whole(row.files) ?? 0,
          number: number && /^\d{20}$/.test(number) ? number : null,
        },
      ];
    }),
    lawsuits: rows(answer.lawsuits).flatMap((row): TestCourtLawsuit[] => {
      const id = text(row.id);
      const cnj = text(row.cnj);
      if (!id || !cnj) return [];
      return [
        {
          id,
          caseSeq: whole(row.case_seq),
          client: text(row.client),
          cnj,
          court: text(row.court),
          kind: text(row.kind),
          comarca: text(row.comarca),
          status: text(row.status) ?? "filed",
          done: (Array.isArray(row.done) ? row.done : []).filter(isCourtStep),
          hearing: text(row.hearing),
          hearingAt: instant(row.hearing_at),
        },
      ];
    }),
  };
}

/** A case number as people write it; one that is not a case number stays as it came. */
export const numberLabel = (cnj: string): string => formatCnj(cnj) ?? cnj;

/** The day a filing is received, as the receipt writes it: the court's day in Brasília. */
export function receiptDay(instant: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(instant));
}

/**
 * The receipt the test court hands for a filing: what the lawyer attaches in ONE, with the number the
 * lawsuit got. It says on its face that no court received the lawsuit.
 */
export function receiptBlocks(input: {
  firm: string;
  number: string;
  day: string;
  court: string | null;
  unit: string;
  files: number;
}): TextBlock[] {
  return [
    { kind: "title", text: "Tribunal de teste do ONE" },
    { kind: "heading", text: "Recibo de protocolo" },
    {
      kind: "fields",
      rows: [
        { label: "Processo", value: numberLabel(input.number) },
        { label: "Protocolado em", value: input.day },
        ...(input.court ? [{ label: "Tribunal", value: input.court }] : []),
        { label: "Juízo", value: input.unit },
        { label: "Escritório", value: input.firm },
        { label: "Arquivos recebidos", value: String(input.files) },
      ],
    },
    { kind: "space" },
    {
      kind: "paragraph",
      text:
        "Documento de teste, sem validade. Este recibo foi emitido pelo tribunal de teste do ONE para o teste de " +
        "ponta a ponta: nenhum tribunal recebeu este processo.",
    },
  ];
}

/** The unit a lawsuit is distributed to, as the test court names it (the database writes the same). */
export function unitOf(kind: string | null, comarca: string | null): string {
  const unit = kind === "juizado" ? "1º Juizado Especial Cível" : "1ª Vara Cível";
  return comarca ? `${unit} da Comarca de ${comarca}` : unit;
}
