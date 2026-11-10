/**
 * What a lawsuit came to, read by rule (phase 6 of the plan of the controladoria and the finance, `resultado-v1`): from
 * the title of a court's movement, whether it says the judgment became final (trânsito em julgado), an appeal, a
 * judicial deposit, a release of money (alvará, a transfer, an RPV, a precatório), a settlement or the definitive
 * archiving; and from the words of a judgment, whether it granted the claim, in part, or denied it, and the value it
 * set (per claimant when it says so). Only what the words say clearly: a provisional archiving or a suspension never
 * ends a lawsuit, an order to pay costs is never a release, and a value is read only beside the condemnation. Pure.
 */

export const OUTCOME_RULE = "resultado-v1";

export type FactKind = "sentenca" | "acordo" | "transito" | "recurso" | "deposito" | "alvara" | "arquivamento";
export type JudgmentResult = "procedente" | "parcial" | "improcedente";
export type ReleaseKind = "alvara" | "transferencia" | "rpv" | "precatorio";

export type MovementFact =
  | { kind: "transito" }
  | { kind: "arquivamento" }
  | { kind: "deposito" }
  | { kind: "alvara"; release: ReleaseKind }
  | { kind: "recurso"; by: "autor" | "re" | null }
  | { kind: "acordo" }
  | { kind: "sentenca"; result: JudgmentResult };

/** A text as the rule compares it: no accent, lower case, single spaces. */
const plain = (text: string) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * The fact a movement's title (and detail) says, or null. A provisional archiving, a suspension, a sending to another
 * court and a lawsuit sent back are no end; an order to pay costs or a deposit of costs is no release.
 */
export function movementFact(title: string, detail: string | null = null): MovementFact | null {
  const words = plain(`${title} ${detail ?? ""}`);
  if (!words) return null;
  if (/transit\w* em julgado/.test(words)) return { kind: "transito" };
  if (/arquiv\w*/.test(words)) {
    if (/provisori|sobrestad|suspens|temporari/.test(words)) return null;
    if (/definitiv|baixa|arquivad[oa]s? os autos|arquivamento/.test(words)) return { kind: "arquivamento" };
    return null;
  }
  if (/custas|preparo|honorarios periciais/.test(words) && !/alvara/.test(words)) return null;
  if (/precatorio/.test(words) && /expedi|requisi/.test(words)) return { kind: "alvara", release: "precatorio" };
  if (/\brpv\b|requisicao de pequeno valor/.test(words) && /expedi|pag|requisi/.test(words)) {
    return { kind: "alvara", release: "rpv" };
  }
  if (/alvara/.test(words) && /expedi|levantamento|liberad/.test(words)) return { kind: "alvara", release: "alvara" };
  if (/transferencia eletronica|ted judicial/.test(words) && /expedi|deferid|realizad/.test(words)) {
    return { kind: "alvara", release: "transferencia" };
  }
  if (/deposito judicial|comprovante de deposito|deposito do valor|guia de deposito/.test(words)) {
    return { kind: "deposito" };
  }
  if (/acordo/.test(words) && /homolog/.test(words)) return { kind: "acordo" };
  if (/recurso inominado|apelacao|recurso de apelacao|interp\w* recurso|recurso interposto/.test(words)) {
    const by = /\b(da|pela) (parte )?re\b|\bdo reu\b|\bda requerida\b|\bda demandada\b/.test(words)
      ? "re"
      : /\b(da|pela) parte autora\b|\bdo autor\b|\bda autora\b|\bdo requerente\b/.test(words)
        ? "autor"
        : null;
    return { kind: "recurso", by };
  }
  if (/procedente/.test(words) || /improcedente/.test(words)) {
    const result = judgmentResultOf(words);
    return result ? { kind: "sentenca", result } : null;
  }
  return null;
}

/** The result a judgment's words say: denied, granted in part, or granted. */
function judgmentResultOf(words: string): JudgmentResult | null {
  if (/\bimprocedente/.test(words)) return "improcedente";
  if (/parcialmente procedente|procedente em parte|parcial procedencia/.test(words)) return "parcial";
  if (/\bprocedente/.test(words)) return "procedente";
  return null;
}

export type JudgmentReading = {
  result: JudgmentResult | "acordo";
  /** The value set, in cents, when the words set one beside the condemnation (or the settlement). */
  cents: number | null;
  /** The value is each claimant's ("por autor", "para cada autor"). */
  perClaimant: boolean;
  /** The words of the court the reading comes from, at most 400 characters. */
  words: string;
};

/** A value written "R$ 5.000,00" as cents. */
function centsOf(text: string): number | null {
  const match = /r\$\s*([0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),([0-9]{2})/i.exec(text);
  if (!match) return null;
  const cents = Number(match[1].replace(/\./g, "")) * 100 + Number(match[2]);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/**
 * What a judgment's words say, from its operative part ("Ante o exposto", "Isto posto", "Diante do exposto", or the
 * verb itself): the result, the value beside the condemnation and whether it is each claimant's; a settlement the court
 * approved with its value. Null when the words say nothing clear.
 */
export function readJudgment(text: string): JudgmentReading | null {
  const raw = String(text ?? "").replace(/\s+/g, " ");
  const lowered = plain(raw);
  if (!lowered) return null;
  // The operative part: from the last "ante o exposto" (or its kin), else the whole text.
  const marks = [...lowered.matchAll(/ante o exposto|isto posto|diante do exposto|pelo exposto|posto isso|em face do exposto/g)];
  const from = marks.length ? marks[marks.length - 1].index ?? 0 : 0;
  const operative = lowered.slice(from);
  const operativeRaw = raw.slice(from);
  if (/homolog\w* (o |por sentenca o |por sentenca )?acordo/.test(operative)) {
    const cents = centsOf(operativeRaw);
    return { result: "acordo", cents, perClaimant: false, words: operativeRaw.slice(0, 400).trim() };
  }
  const verb = /julgo (parcialmente )?(im)?procedente|julgo procedente em parte/.exec(operative);
  if (!verb) return null;
  const result = judgmentResultOf(verb[0]);
  if (!result) return null;
  let cents: number | null = null;
  let perClaimant = false;
  if (result !== "improcedente") {
    const condemnation = operative.search(/conden(o|ar)/);
    if (condemnation >= 0) {
      const after = operativeRaw.slice(condemnation, condemnation + 400);
      cents = centsOf(after);
      perClaimant = cents !== null && /(por|para cada|a cada) (autor|autora|parte autora|requerente)/i.test(plain(after));
    }
  }
  const start = Math.max((verb.index ?? 0) - 40, 0);
  return { result, cents, perClaimant, words: operativeRaw.slice(start, start + 400).trim() };
}

/**
 * The value of a release a court ordered ("Expeça-se alvará ... no valor de R$ 5.000,00"), in cents, with its kind; null
 * when the words order no release (an order to pay costs never is one) or say no value.
 */
export function readRelease(text: string): { release: ReleaseKind; cents: number } | null {
  const raw = String(text ?? "").replace(/\s+/g, " ");
  const lowered = plain(raw);
  if (/custas|preparo/.test(lowered) && !/alvara|levantamento/.test(lowered)) return null;
  const release: ReleaseKind | null = /precatorio/.test(lowered)
    ? "precatorio"
    : /\brpv\b|requisicao de pequeno valor/.test(lowered)
      ? "rpv"
      : /alvara|levantamento/.test(lowered)
        ? "alvara"
        : /transferencia eletronica/.test(lowered)
          ? "transferencia"
          : null;
  if (!release) return null;
  const order = lowered.search(/expeca|expeca-se|expedi|defiro o levantamento|libere-se|transfira-se/);
  if (order < 0) return null;
  const cents = centsOf(raw.slice(order, order + 400));
  return cents ? { release, cents } : null;
}

/** Whether a lawsuit's facts end it: archived definitively. A provisional archiving was never read as one. */
export const endsLawsuit = (facts: readonly { kind: FactKind }[]): boolean =>
  facts.some((fact) => fact.kind === "arquivamento");

/** Whether a result is against the client: the claim denied. */
export const againstClient = (result: JudgmentResult | "acordo" | null): boolean => result === "improcedente";
