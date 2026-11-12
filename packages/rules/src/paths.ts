/**
 * What a party may do after a decision of its lawsuit (`caminhos-v1`, item 4.5 of the case journey plan), and what an
 * appeal costs the client. Pure: the kind of lawsuit, the decision, whether the court has a panel to settle diverging
 * panels, and whether the client has free justice are given.
 *
 * - In the small-claims court a judgment is appealed by the recurso inominado to the turma recursal (Lei 9.099/1995,
 *   art. 41); its acórdão by the recurso extraordinário (CF, art. 102, III; Súmula 640 do STF), never by the recurso
 *   especial (Súmula 203 do STJ); and, when it goes against the jurisprudence of the STJ consolidated in a súmula, a
 *   repetitive appeal or an incident of assumption of competence or of repetitive demands, by the reclamação to the
 *   court of justice of its state (Resolução STJ nº 3/2016, art. 1º; in the TJGO, its Seções Cíveis: Regimento
 *   Interno, art. 16, V), until the acórdão becomes final (CPC, art. 988, § 5º, I), which has no term of its own
 *   (`caminhos-v2`: `reclamacao` in place of `caminhos-v1`'s request to settle diverging panels).
 * - In the civil court a judgment is appealed by the apelação (CPC, art. 1.009); its acórdão by the recurso especial
 *   (CF, art. 105, III) and the recurso extraordinário.
 * - Every decision takes the embargos de declaração, for an omission, a contradiction, an obscurity or a material
 *   error (CPC, art. 1.022; Lei 9.099/1995, art. 48).
 * - The recurso inominado asks the preparo (Lei 9.099/1995, art. 42, § 1º, and art. 54, sole paragraph), and the
 *   appellant that loses pays the costs and the other side's fees, between 10 and 20 percent of the value of the
 *   condemnation or, with none, of the cause (art. 55); free justice exempts the preparo and suspends what the loss
 *   costs (CPC, art. 98, §§ 1º and 3º).
 */

export const PATHS_RULE = "caminhos-v2";

export type LawsuitKind = "juizado" | "comum";
export type DecisionStage = "sentenca" | "acordao";
export type PathOption =
  | "aceitar"
  | "embargos_declaracao"
  | "recurso_inominado"
  | "apelacao"
  | "recurso_extraordinario"
  | "recurso_especial"
  | "reclamacao";

export type PathCosts = {
  /** The appeal asks a preparo the court's table sets (none with free justice). */
  preparo: boolean;
  /** Losing the appeal costs the appellant the other side's fees, a share between these of the base. */
  fees: { min: number; max: number; base: "condenacao" | "causa" } | null;
  /** Free justice suspends what the loss costs (it is charged only if the person can pay within five years). */
  suspended: boolean;
};

export type PathsInput = {
  kind: LawsuitKind;
  stage: DecisionStage;
  /** The client has free justice in this lawsuit. */
  freeJustice?: boolean;
  /** The decision condemned the defendant to pay something (the base of the fees of a lost appeal). */
  condemnation?: boolean;
};

export type Path = { option: PathOption; grounds: string[]; costs: PathCosts | null };

const EMBARGOS: Path = {
  option: "embargos_declaracao",
  grounds: ["CPC, art. 1.022", "Lei 9.099/1995, art. 48"],
  costs: null,
};

/** The options after a decision, in the order a lawyer weighs them; accepting it is always one of them. */
export function pathsAfter(input: PathsInput): Path[] {
  const accept: Path = { option: "aceitar", grounds: [], costs: null };
  if (input.kind === "juizado") {
    if (input.stage === "sentenca") {
      return [
        accept,
        EMBARGOS,
        {
          option: "recurso_inominado",
          grounds: ["Lei 9.099/1995, art. 41", "Lei 9.099/1995, art. 42, § 1º", "Lei 9.099/1995, art. 55"],
          costs: {
            preparo: !input.freeJustice,
            fees: { min: 10, max: 20, base: input.condemnation ? "condenacao" : "causa" },
            suspended: input.freeJustice === true,
          },
        },
      ];
    }
    return [
      accept,
      EMBARGOS,
      { option: "recurso_extraordinario", grounds: ["CF, art. 102, III", "Súmula 640 do STF"], costs: null },
      {
        option: "reclamacao",
        grounds: ["Resolução STJ nº 3/2016, art. 1º", "CPC, arts. 988 a 993", "CPC, art. 988, § 5º, I"],
        costs: null,
      },
    ];
  }
  if (input.stage === "sentenca") {
    return [
      accept,
      EMBARGOS,
      {
        option: "apelacao",
        grounds: ["CPC, art. 1.009", "CPC, art. 1.007", "CPC, art. 85, § 11"],
        costs: { preparo: !input.freeJustice, fees: null, suspended: input.freeJustice === true },
      },
    ];
  }
  return [
    accept,
    EMBARGOS,
    { option: "recurso_especial", grounds: ["CF, art. 105, III"], costs: null },
    { option: "recurso_extraordinario", grounds: ["CF, art. 102, III"], costs: null },
  ];
}

/** Whether an option is open after a decision: the recurso especial never is in the small-claims court. */
export function pathOpen(input: PathsInput, option: PathOption): boolean {
  return pathsAfter(input).some((path) => path.option === option);
}
