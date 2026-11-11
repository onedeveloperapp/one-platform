/**
 * What who went to a hearing reports on the firm's WhatsApp (migration 0187, item 4.4 of the case journey plan): the
 * words ONE says back and what the model is told. Pure.
 */

export const HEARING_REPORT_TASK = "audiencia.resultado";

export type ReportHearing = { hearingId: string; caseSeq: number; startsAt: string; timeZone: string };

export function reportHearingsOf(raw: unknown): ReportHearing[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ReportHearing[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    if (typeof row.hearing_id !== "string" || typeof row.starts_at !== "string") return [];
    return [
      {
        hearingId: row.hearing_id,
        caseSeq: Number(row.case_seq) || 0,
        startsAt: row.starts_at,
        timeZone: typeof row.time_zone === "string" ? row.time_zone : "America/Sao_Paulo",
      },
    ];
  });
}

const when = (hearing: ReportHearing) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: hearing.timeZone,
  }).format(new Date(hearing.startsAt));

const day = (hearing: ReportHearing) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: hearing.timeZone,
  }).format(new Date(hearing.startsAt));

/** The hearing a reply names by its case's number, when there is more than one. */
export function pickHearing(hearings: ReportHearing[], words: string[]): ReportHearing | null {
  const numbers = new Set((words.join(" ").match(/\d+/g) ?? []).map(Number));
  const named = hearings.filter((hearing) => numbers.has(hearing.caseSeq));
  return named.length === 1 ? named[0] : null;
}

/** ONE asks which hearing, when the person has more than one with nothing said of it. */
export function whichHearingMessage(hearings: ReportHearing[]): string {
  return [
    "Você tem mais de uma audiência sem resultado. De qual caso é este resultado? Responda com o número do caso:",
    ...hearings.map((hearing) => `Caso ${hearing.caseSeq}, audiência de ${when(hearing)}`),
  ].join("\n");
}

/** What the model is told: the hearing's day and the message, fenced as content to read. */
export function reportBriefing(hearing: ReportHearing, text: string): string {
  const fenced = text.replace(/<{3,}|>{3,}/g, (signs) => signs.split("").join(" ")).slice(0, 6000);
  return [`Dia da audiência: ${day(hearing)}`, "Mensagem de quem foi, entre <<< e >>>:", "<<<", fenced, ">>>"].join(
    "\n",
  );
}

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

/** What ONE says back once it recorded the result. */
export function reportRecordedMessage(input: {
  caseSeq: number;
  result: string;
  cents: number | null;
  payDays: number | null;
}): string {
  const head = `Registrei no caso ${input.caseSeq}:`;
  const body =
    input.result === "acordo"
      ? `acordo${input.cents ? ` de ${brl(input.cents)}` : ""}${input.payDays ? `, a companhia paga em ${input.payDays} dias, e o prazo está na agenda para acompanhar` : ""}.`
      : input.result === "sem_acordo"
        ? "a audiência aconteceu, sem acordo."
        : input.result === "instrucao"
          ? "sem acordo, com audiência de instrução marcada. Registre a nova audiência no caso."
          : input.result === "sentenca"
            ? "a sentença foi dada na audiência. Registre o resultado no caso."
            : "a audiência não aconteceu, e nada mudou no processo. Diga no caso o que houve.";
  return `${head} ${body} O ONE pode errar: o escritório confere no caso.`;
}

/** What ONE says when it could not tell the result from the message. */
export const reportUnreadMessage =
  "Recebi, mas não consegui entender o resultado da audiência. Conte em uma frase o que aconteceu: houve acordo, de quanto e em quantos dias a companhia paga?";
