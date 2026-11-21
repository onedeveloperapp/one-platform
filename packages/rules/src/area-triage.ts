/**
 * The triage of a contact of a firm's own area (the plan "o escritório preparado antes do primeiro atendimento",
 * phase 4, the owner, 2026-11-20): the area's script, which the firm built with ONE, asks the kind of case and a few
 * questions, each with numbered options, and marks every option "segue", "não atendemos" or "uma pessoa decide". The
 * firm's table decides, never the AI (engineering rule 1): the AI only reads the client's answer into one of the
 * options, and these rules say what is still asked and where the contact goes.
 *
 *   - The kind of case is asked first when the area has more than one; one that is none of them ("outro") goes to a
 *     person. An area of one kind takes it without asking.
 *   - The questions of the kind are asked in the script's order: a question that names no kind is of every kind.
 *   - An answer marked "não atendemos" ends the triage at once: the firm does not take the case.
 *   - An answer marked "uma pessoa decide" lets the triage go on, so the person reads every answer, and then the
 *     contact goes to a person.
 *   - Every question answered with "segue": the case goes on, to the firm's offer.
 *
 * Pure.
 */

export const AREA_TRIAGE_RULE = "area-triage-v1";

export const CRITERIA = ["segue", "nao_atendemos", "pessoa"] as const;
export type Criterion = (typeof CRITERIA)[number];

export type TriageOption = { key: string; text: string; criterion: Criterion };
/** A question of the triage: of the kinds it names, or of every kind when it names none. */
export type TriageQuestion = { key: string; text: string; options: TriageOption[]; types: string[] };
export type TriageType = { key: string; name: string };
export type TriageScript = { types: TriageType[]; questions: TriageQuestion[] };

/** The kind a person said is none of the area's. */
export const OTHER_TYPE = "outro";

/** What the client answered so far: the kind of case, and the option of each question. */
export type TriageAnswers = { type: string | null; answers: Record<string, string> };

export type TriageAsk = { ask: "type" } | { ask: "question"; question: TriageQuestion };

export type TriageVerdict =
  | { outcome: "pending"; next: TriageAsk }
  /** Every answer says "segue": the case goes on, of this kind. */
  | { outcome: "goes"; type: string }
  /** The firm does not take the case: the answer that said so. */
  | { outcome: "declined"; question: string; option: string }
  /** A person of the firm decides: the answers that asked for it, or the kind none of the area's. */
  | { outcome: "person"; type: string | null; because: { question: string; option: string }[] };

/** The kind of case the triage goes by: the one said, or the area's only kind. */
export function triageType(script: TriageScript, said: TriageAnswers): string | null {
  if (said.type === OTHER_TYPE) return OTHER_TYPE;
  if (said.type && script.types.some((type) => type.key === said.type)) return said.type;
  return script.types.length === 1 ? script.types[0]!.key : null;
}

/** The questions of a kind of case, in the script's order. */
export function triageQuestions(script: TriageScript, type: string): TriageQuestion[] {
  return script.questions.filter((question) => question.types.length === 0 || question.types.includes(type));
}

/** Where the triage stands: what it asks next, or where the contact goes. */
export function triageVerdict(script: TriageScript, said: TriageAnswers): TriageVerdict {
  const type = triageType(script, said);
  if (type === OTHER_TYPE) return { outcome: "person", type: null, because: [] };
  if (!type) return { outcome: "pending", next: { ask: "type" } };

  const because: { question: string; option: string }[] = [];
  for (const question of triageQuestions(script, type)) {
    const chosen = said.answers[question.key];
    const option = chosen ? question.options.find((candidate) => candidate.key === chosen) : undefined;
    if (!option) return { outcome: "pending", next: { ask: "question", question } };
    if (option.criterion === "nao_atendemos") {
      return { outcome: "declined", question: question.key, option: option.key };
    }
    if (option.criterion === "pessoa") because.push({ question: question.key, option: option.key });
  }
  return because.length > 0 ? { outcome: "person", type, because } : { outcome: "goes", type };
}

/**
 * The option a short reply chooses on its own: its number ("2", "2.", "opção 2") or the option's very words, with no
 * accent and no case. Anything else is the AI's to read into an option, or none.
 */
export function optionOfReply<T extends { key: string; text: string }>(options: readonly T[], reply: string): T | null {
  const said = plainText(reply);
  if (!said) return null;
  const number = /^(?:opcao\s*)?(\d{1,2})\s*[.)]?$/.exec(said);
  if (number) return options[Number(number[1]) - 1] ?? null;
  return options.find((option) => plainText(option.text) === said) ?? null;
}

function plainText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
