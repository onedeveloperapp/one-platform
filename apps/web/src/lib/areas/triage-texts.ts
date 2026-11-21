import type { AreaScript, ScriptQuestion } from "@/lib/areas/script";
import { triageScriptOf } from "@/lib/areas/script";
import { calledMessage } from "@/lib/conversations/agent";
import { OPTIONS, optionsText } from "@/lib/conversations/intake";
import { OTHER_TYPE, type TriageAnswers, triageQuestions, triageVerdict } from "@flyee/rules/area-triage";

/**
 * What ONE writes to a client of a firm's own area (migration 0273, phase 4 of the plan "o escritório preparado antes
 * do primeiro atendimento"): the questions of the area's script with their numbered options, the firm's words on a
 * refusal and on its fees, and the conversation of example the firm reads before it publishes a script, written from
 * these very texts, so what it reads is what ONE will send. Pure.
 */

/** The options of a question, numbered. */
export function numbered(options: readonly string[]): string {
  return options.map((option, index) => `${index + 1}. ${option}`).join("\n");
}

const OTHER_TYPE_TEXT = "Outro assunto";

/** The question of the kind of case, with the area's kinds and "Outro assunto". */
export function typeQuestionText(script: AreaScript, areaName: string): string {
  return `Para eu entender o seu caso de ${areaName}, qual destes é o mais perto do que você precisa?\n${numbered([
    ...script.tipos.map((type) => type.nome),
    OTHER_TYPE_TEXT,
  ])}\nResponda com o número.`;
}

/** The options of the kind of case, as the reply is read against them. */
export function typeOptions(script: AreaScript): { key: string; text: string }[] {
  return [
    ...script.tipos.map((type) => ({ key: type.chave, text: type.nome })),
    { key: OTHER_TYPE, text: OTHER_TYPE_TEXT },
  ];
}

/** A question of the script, with its options numbered. */
export function scriptQuestionText(question: ScriptQuestion): string {
  return `${question.texto}\n${numbered(question.opcoes.map((option) => option.texto))}\nResponda com o número.`;
}

/** The firm's words when it does not take the case; a kind refusal of ONE's where it wrote none. */
export function refusalText(script: AreaScript, areaName: string): string {
  return (
    script.recusa ||
    `Obrigado por contar. Pelo que você respondeu, o escritório não vai poder cuidar deste caso de ${areaName}. Se tiver outra questão, é só escrever aqui.`
  );
}

/** The offer, with the area's words on fees, and the options of the passenger's offer (read by the same rule). */
export function areaOfferText(script: AreaScript): string {
  const fees = script.honorarios ? `\n\n${script.honorarios}` : "";
  return `Pelo que você contou, o escritório pode cuidar do seu caso.${fees}\n\nQuer que o escritório siga com o seu caso?\n${optionsText(
    OPTIONS.oferta,
  )}`;
}

/** What the team reads in the panel when a person continues the triage of an area. */
export function triageReason(input: {
  areaName: string;
  script: AreaScript;
  said: TriageAnswers;
  because: "type" | "answers" | "unsure" | "doubt" | "declined";
}): string {
  const head =
    input.because === "type"
      ? `Contato de ${input.areaName} com um assunto que não é dos tipos de caso do roteiro.`
      : input.because === "answers"
        ? `Contato de ${input.areaName}: uma resposta pede que uma pessoa decida.`
        : input.because === "doubt"
          ? `Contato de ${input.areaName} com uma dúvida antes de seguir.`
          : input.because === "declined"
            ? `Contato de ${input.areaName} com uma resposta que o escritório não atende: o ONE recusou com as palavras do roteiro.`
            : `Contato de ${input.areaName}: o ONE não entendeu uma resposta.`;
  return [head, ...answeredLines(input.script, input.said)].join(" ").slice(0, 900);
}

/** The kind of case and each answer of the triage, one line each, in the script's words. */
function answeredLines(script: AreaScript, said: TriageAnswers): string[] {
  const type = script.tipos.find((candidate) => candidate.chave === said.type);
  const answered = script.perguntas
    .filter((question) => said.answers[question.chave])
    .map((question) => {
      const option = question.opcoes.find((candidate) => candidate.chave === said.answers[question.chave]);
      return option ? `${question.texto} ${option.texto}.` : null;
    })
    .filter((line): line is string => Boolean(line));
  return [type ? `Tipo de caso: ${type.nome}.` : null, ...answered].filter((line): line is string => Boolean(line));
}

/** The firm's note of a case ONE opened from the triage of an area: what the client answered. */
export function triageNote(script: AreaScript, areaName: string, said: TriageAnswers): string {
  return [`Triagem do ONE pelo roteiro de ${areaName}.`, ...answeredLines(script, said)].join("\n").slice(0, 4000);
}

export type ExampleMessage = { quem: "cliente" | "one"; texto: string };
export type ExampleConversation = { titulo: string; mensagens: ExampleMessage[] };

/**
 * The conversations of example of a script: one that goes on to the offer, answering each question with its first
 * option that says "segue", and, where some option says "não atendemos" or "uma pessoa decide", one that ends there.
 * Each message is the one ONE will send.
 */
export function exampleConversations(script: AreaScript, areaName: string): ExampleConversation[] {
  const triage = triageScriptOf(script);
  const type = script.tipos[0]!;
  const opening: ExampleMessage = { quem: "cliente", texto: `Oi, preciso de ajuda com ${type.nome.toLowerCase()}.` };

  const walk = (pick: (question: ScriptQuestion) => string | null): { mensagens: ExampleMessage[]; ended: string } => {
    const mensagens: ExampleMessage[] = [opening];
    const said: TriageAnswers = { type: null, answers: {} };
    if (script.tipos.length > 1) {
      mensagens.push({ quem: "one", texto: typeQuestionText(script, areaName) }, { quem: "cliente", texto: "1" });
      said.type = type.chave;
    }
    for (let guard = 0; guard < 20; guard += 1) {
      const verdict = triageVerdict(triage, said);
      if (verdict.outcome === "goes") {
        mensagens.push({ quem: "one", texto: areaOfferText(script) });
        return { mensagens, ended: "goes" };
      }
      if (verdict.outcome === "declined") {
        mensagens.push({ quem: "one", texto: refusalText(script, areaName) });
        return { mensagens, ended: "declined" };
      }
      if (verdict.outcome === "person") {
        mensagens.push({ quem: "one", texto: calledMessage });
        return { mensagens, ended: "person" };
      }
      const next = verdict.next;
      if (next.ask !== "question") break;
      const question = script.perguntas.find((candidate) => candidate.chave === next.question.key)!;
      const chosen = pick(question) ?? question.opcoes[0]!.chave;
      const index = question.opcoes.findIndex((option) => option.chave === chosen);
      mensagens.push(
        { quem: "one", texto: scriptQuestionText(question) },
        { quem: "cliente", texto: String(index + 1) },
      );
      said.answers[question.chave] = chosen;
    }
    return { mensagens, ended: "none" };
  };

  const goes = walk((question) => question.opcoes.find((option) => option.criterio === "segue")?.chave ?? null);
  const examples: ExampleConversation[] = [{ titulo: "Um caso que o escritório aceita", mensagens: goes.mensagens }];

  // The first question of the kind with an option that ends the triage, answered with it.
  const questions = triageQuestions(triage, type.chave);
  const stop = questions
    .map((question) => script.perguntas.find((candidate) => candidate.chave === question.key)!)
    .find((question) => question.opcoes.some((option) => option.criterio !== "segue"));
  if (stop) {
    const option =
      stop.opcoes.find((candidate) => candidate.criterio === "nao_atendemos") ??
      stop.opcoes.find((candidate) => candidate.criterio === "pessoa")!;
    const ending = walk((question) =>
      question.chave === stop.chave
        ? option.chave
        : (question.opcoes.find((candidate) => candidate.criterio === "segue")?.chave ?? null),
    );
    examples.push({
      titulo:
        option.criterio === "nao_atendemos" ? "Um caso que o escritório não aceita" : "Um caso que uma pessoa decide",
      mensagens: ending.mensagens,
    });
  }
  return examples;
}
