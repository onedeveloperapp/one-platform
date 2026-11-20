/**
 * The areas of law a firm works in, as ONE proposes them in the setup's step "A operação" (the owner, 2026-11-20):
 * from the lawsuits the DJEN published for the firm's registrations at the bar (the x-ray by the OAB, M6), each read
 * by its court, its class and whether its texts name an airline or the INSS. ONE proposes; the person confirms, takes
 * out or adds. A lawsuit whose court and class say no area is left out of the proposal, never guessed.
 *
 * The keys are the ones of `law_areas` (0256). Pure.
 */

export const AREAS_RULE = "areas-v1";

export const LAW_AREAS = [
  "passageiro",
  "consumidor",
  "civel",
  "familia",
  "trabalhista",
  "previdenciario",
  "saude",
  "imobiliario",
  "criminal",
  "tributario",
  "empresarial",
  "administrativo",
] as const;
export type LawArea = (typeof LAW_AREAS)[number];

export const isLawArea = (value: unknown): value is LawArea => (LAW_AREAS as readonly unknown[]).includes(value);

/** What the area of a lawsuit is read from. */
export type LawsuitSign = {
  /** The court as the DJEN writes it: "TJGO", "TRT18", "TRF1", "TST". */
  court: string;
  /** The lawsuit's class, as the court names it ("Divórcio Litigioso", "Procedimento do Juizado Especial Cível"). */
  className: string | null;
  /** The kind of proceeding, where the class or the unit says it. */
  kind: "juizado" | "comum" | null;
  /** The lawsuit's texts name an airline (one alone). */
  airline: boolean;
  /** The lawsuit's texts name the INSS. */
  inss: boolean;
};

const plain = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/** The classes that are of one area wherever they run, by words of their names. */
const CLASS_AREAS: readonly [LawArea, readonly string[]][] = [
  [
    "criminal",
    [
      "ACAO PENAL",
      "INQUERITO POLICIAL",
      "HABEAS CORPUS",
      "EXECUCAO DA PENA",
      "EXECUCAO PENAL",
      "TERMO CIRCUNSTANCIADO",
      "MEDIDAS PROTETIVAS",
      "AUTO DE PRISAO",
      "LIBERDADE PROVISORIA",
      "PEDIDO DE PRISAO",
      "ATO INFRACIONAL",
      "CRIMES",
    ],
  ],
  [
    "familia",
    [
      "DIVORCIO",
      "ALIMENTOS",
      "GUARDA",
      "SEPARACAO",
      "UNIAO ESTAVEL",
      "PATERNIDADE",
      "REGULAMENTACAO DE VISITAS",
      "INVENTARIO",
      "ARROLAMENTO",
      "INTERDICAO",
      "CURATELA",
      "ADOCAO",
      "TESTAMENTO",
    ],
  ],
  ["tributario", ["EXECUCAO FISCAL", "ACAO ANULATORIA DE DEBITO FISCAL"]],
  [
    "imobiliario",
    [
      "DESPEJO",
      "USUCAPIAO",
      "REINTEGRACAO DE POSSE",
      "MANUTENCAO DE POSSE",
      "IMISSAO NA POSSE",
      "INTERDITO PROIBITORIO",
      "ADJUDICACAO COMPULSORIA",
    ],
  ],
  ["empresarial", ["RECUPERACAO JUDICIAL", "RECUPERACAO EXTRAJUDICIAL", "FALENCIA", "DISSOLUCAO PARCIAL DE SOCIEDADE"]],
];

const classArea = (className: string | null): LawArea | null => {
  if (!className) return null;
  const name = plain(className);
  for (const [area, words] of CLASS_AREAS) if (words.some((word) => name.includes(word))) return area;
  return null;
};

/** The area of one lawsuit, or null when its court and class say none. */
export function areaOfLawsuit(sign: LawsuitSign): LawArea | null {
  const court = plain(sign.court).replace(/\s+/g, "");
  // The labour courts hear the labour cases alone.
  if (/^TRT\d{1,2}$/.test(court) || court === "TST") return "trabalhista";
  const byClass = classArea(sign.className);
  if (byClass === "criminal") return byClass;
  // The federal courts: a benefit of the INSS, a federal tax; the rest is no area the court alone tells.
  if (/^TRF\d$/.test(court)) {
    if (byClass === "tributario") return byClass;
    return sign.inss ? "previdenciario" : null;
  }
  if (byClass) return byClass;
  if (sign.airline) return "passageiro";
  // In a state court, the small-claims courts carry the consumers' claims, and the common procedure the civil ones.
  if (/^TJ[A-Z]{2}$/.test(court)) {
    if (sign.kind === "juizado") return "consumidor";
    if (sign.kind === "comum") return "civel";
  }
  return null;
}

export type AreaProposal = {
  area: LawArea;
  lawsuits: number;
  /** The share of the lawsuits read whose area was told, in whole percent. */
  share: number;
  /** Proposed as one of the firm's: at least 3 lawsuits, or a tenth of the ones told. */
  proposed: boolean;
};

/** The areas of a firm's lawsuits, the most frequent first, and how many lawsuits told none. */
export function proposeAreas(signs: readonly LawsuitSign[]): { areas: AreaProposal[]; untold: number } {
  const counts = new Map<LawArea, number>();
  let untold = 0;
  for (const sign of signs) {
    const area = areaOfLawsuit(sign);
    if (!area) untold += 1;
    else counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const told = signs.length - untold;
  const areas = [...counts.entries()]
    .map(([area, lawsuits]) => {
      const share = told > 0 ? Math.round((100 * lawsuits) / told) : 0;
      return { area, lawsuits, share, proposed: lawsuits >= 3 || share >= 10 };
    })
    .sort((a, b) => b.lawsuits - a.lawsuits || LAW_AREAS.indexOf(a.area) - LAW_AREAS.indexOf(b.area));
  return { areas, untold };
}
