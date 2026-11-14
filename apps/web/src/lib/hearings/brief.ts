/**
 * The brief of a hearing for who goes to it (migration 0187, item 4.4 of the case journey plan), written by ONE two
 * business days before: the hearing, the facts the client confirmed, the documents of the case, what each claimant
 * asks and the value the firm settles for at least. Pure: what the database answers is given, and the lines are plain
 * text, the same on the case and in the e-mail.
 */

export type BriefFacts = {
  hearingId: string;
  orgId: string;
  caseId: string;
  startsAt: string;
  timeZone: string;
  kind: string;
  mode: string;
  place: string | null;
  link: string | null;
  attendeeEmail: string | null;
  attendeeName: string | null;
  caseSeq: number;
  incident: string | null;
  airline: string | null;
  cnj: string | null;
  court: string | null;
  unit: string | null;
  claimants: { name: string; cents: number | null }[];
  facts: string | null;
  documents: string[];
  floorCents: number | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const cents = (value: unknown): number | null =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);

export function briefFactsOf(raw: unknown): BriefFacts[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): BriefFacts[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    if (typeof row.hearing_id !== "string" || typeof row.starts_at !== "string") return [];
    return [
      {
        hearingId: row.hearing_id,
        orgId: String(row.org_id ?? ""),
        caseId: String(row.case_id ?? ""),
        startsAt: row.starts_at,
        timeZone: text(row.time_zone) ?? "America/Sao_Paulo",
        kind: text(row.kind) ?? "conciliacao",
        mode: text(row.mode) ?? "presencial",
        place: text(row.place),
        link: text(row.link),
        attendeeEmail: text(row.attendee_email),
        attendeeName: text(row.attendee_name),
        caseSeq: Number(row.case_seq) || 0,
        incident: text(row.incident),
        airline: text(row.airline),
        cnj: text(row.cnj),
        court: text(row.court),
        unit: text(row.unit),
        claimants: Array.isArray(row.claimants)
          ? (row.claimants as Record<string, unknown>[]).flatMap((claimant) =>
              typeof claimant.name === "string" ? [{ name: claimant.name, cents: cents(claimant.cents) }] : [],
            )
          : [],
        facts: text(row.facts),
        documents: Array.isArray(row.documents)
          ? row.documents.filter((kind): kind is string => typeof kind === "string")
          : [],
        floorCents: cents(row.floor_cents),
      },
    ];
  });
}

/** The day of a moment in a zone, as YYYY-MM-DD. */
const dayIn = (moment: string, zone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(moment));

/** Business days from a day to another, the end counted, weekends left out (the court's holidays are not read here). */
export function businessDaysUntil(from: string, to: string): number {
  if (to <= from) return 0;
  let count = 0;
  const day = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (day < end) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/** Whether a hearing's brief is due today: it is two business days away, or less. */
export function briefDue(facts: Pick<BriefFacts, "startsAt" | "timeZone">, today: string): boolean {
  return businessDaysUntil(today, dayIn(facts.startsAt, facts.timeZone)) <= 2;
}

const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);

export const KIND_WORDS: Record<string, string> = {
  conciliacao: "conciliação",
  instrucao: "instrução e julgamento",
  una: "una (conciliação, instrução e julgamento)",
  outra: "audiência",
};

const DOCUMENT_WORDS: Record<string, string> = {
  identity: "identidade",
  address_proof: "comprovante de endereço",
  ticket: "bilhete",
  boarding_pass: "cartão de embarque",
  receipt: "comprovantes de gastos",
  evidence: "prints e fotos",
  power_of_attorney: "procuração",
  baggage_report: "registro de irregularidade de bagagem",
  residence_declaration: "declaração de residência",
  free_justice_declaration: "declaração de hipossuficiência",
  contract: "contrato",
  petition: "petição inicial",
};

/** When the hearing is, for the reader. */
export function whenLabel(facts: Pick<BriefFacts, "startsAt" | "timeZone">): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: facts.timeZone,
  }).format(new Date(facts.startsAt));
}

/** The brief's lines, plain text, one thing per line. */
export function briefLines(facts: BriefFacts): string[] {
  const lines: string[] = [];
  lines.push(
    `Audiência de ${KIND_WORDS[facts.kind] ?? "audiência"}, ${facts.mode === "videoconferencia" ? `por vídeo${facts.link ? `: ${facts.link}` : ""}` : facts.place ? `em ${facts.place}` : "presencial"}.`,
  );
  if (facts.cnj) lines.push(`Processo ${facts.cnj}${facts.unit ? `, ${facts.unit}` : ""}.`);
  if (facts.airline) lines.push(`Companhia: ${facts.airline}.`);
  if (facts.claimants.length > 0) {
    lines.push(
      `Quem pede: ${facts.claimants
        .map((claimant) => (claimant.cents ? `${claimant.name}, ${brl(claimant.cents)}` : claimant.name))
        .join("; ")}.`,
    );
  }
  lines.push(
    facts.facts ? `Os fatos, como o cliente confirmou: ${facts.facts}` : "Os fatos: confira a petição inicial no caso.",
  );
  const documents = facts.documents.map((kind) => DOCUMENT_WORDS[kind]).filter(Boolean);
  if (documents.length > 0) lines.push(`Documentos aceitos: ${documents.join(", ")}.`);
  lines.push(
    facts.floorCents
      ? `Acordo: o escritório aceita a partir de ${brl(facts.floorCents)} por pessoa, pela regra do escritório.`
      : "Acordo: o escritório não definiu um valor mínimo para este tipo de problema.",
  );
  // What the airline alleged, the trip and the account, and ONE's reading, follow in the guide (0246).
  return lines;
}

/** The hearing as a message to who goes names it: "audiência de conciliação do caso 12". */
export function staffHearingLabel(kind: string, caseSeq: number): string {
  const words = kind === "outra" ? "audiência" : `audiência de ${KIND_WORDS[kind] ?? "conciliação"}`;
  return `${words} do caso ${caseSeq}`;
}

/** The three values of the firm's templates to who goes (0188): their first name, the hearing and when it is. */
export function staffParams(input: {
  attendeeName: string | null;
  kind: string;
  caseSeq: number;
  startsAt: string;
  timeZone: string;
}): string[] {
  const first = (input.attendeeName ?? "").trim().split(/\s+/)[0] || "equipe";
  return [first, staffHearingLabel(input.kind, input.caseSeq), whenLabel(input)];
}
