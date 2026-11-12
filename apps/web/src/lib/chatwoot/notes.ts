import type { MessageFinding } from "@flyee/whatsapp/rules";

/**
 * What ONE says in the firm's panel (migration 0223): why a message a person wrote there did not go, the notes
 * only the firm's people read, and the words that stand for a message with no text of its own. Pure, and under
 * the copy rules of every text people read (no dash, no exclamation, no emoji; `notes.test.ts`).
 */

/** Why what a person wrote in the panel did not go to the client, by the code ONE's database or rules gave. */
export function refusalOf(code: string): string {
  switch (code) {
    case "window_closed":
      return "A janela de 24 horas fechou. Só um modelo aprovado pode ir agora, pelo Atendimento do ONE.";
    case "number_disconnected":
      return "O número do escritório está desconectado. Conecte de novo em Conexões, no ONE.";
    case "person_unknown":
      return "Esta pessoa não está mais na equipe do escritório no ONE.";
    case "not_found":
      return "O ONE não achou esta conversa.";
    case "empty":
      return "A mensagem está vazia.";
    case "too_long":
      return "A mensagem passa de 4.096 caracteres.";
    case "attachment":
      return "Por enquanto, arquivos saem só pelo Atendimento do ONE. O texto não foi enviado.";
    default:
      return "O ONE não conseguiu enviar. Tente de novo em instantes.";
  }
}

const FINDINGS: Record<MessageFinding, string> = {
  promises_result: "o texto promete um resultado",
  speaks_of_price: "o texto fala de preço, honorários, gratuidade ou desconto",
  presses: "o texto pede pressa para decidir",
};

/** The reason a flagged message did not go, as the message's failure in the panel. */
export function flaggedRefusal(findings: MessageFinding[]): string {
  return `Não enviada: ${findings.map((finding) => FINDINGS[finding]).join("; ")}. Para enviar mesmo assim, mande o mesmo texto de novo em até 10 minutos.`;
}

/** The note beside it, for the team: what the rules weigh and how to send it all the same. */
export function flaggedNote(findings: MessageFinding[]): string {
  return [
    "As regras de publicidade da OAB pesam um ponto desta mensagem, e ela não foi enviada:",
    ...findings.map((finding) => `· ${FINDINGS[finding]}.`),
    "Se a mensagem está certa assim, mande o mesmo texto de novo em até 10 minutos e ela vai.",
  ].join("\n");
}

/** ONE could not go on alone and called a person (0048). */
export function calledNote(reason: string | null): string {
  const why = (reason ?? "").trim();
  return why ? `O ONE chamou uma pessoa do escritório: ${why}` : "O ONE chamou uma pessoa do escritório.";
}

/** Why a message of the firm did not reach the client, as its failure in the panel. */
export function failureOf(errorCode: string | null): string {
  if (errorCode === "window_closed") return "A janela de 24 horas fechou antes do envio.";
  if (errorCode === "opted_out") return "O cliente pediu para não receber mensagens.";
  return errorCode ? `Não saiu pelo WhatsApp (${errorCode}).` : "Não saiu pelo WhatsApp.";
}

/** What stands for a message in the panel when it has no text of its own. */
export function contentOf(message: { kind: string; body: string | null; media_filename: string | null }): string {
  const body = (message.body ?? "").trim();
  switch (message.kind) {
    case "text":
    case "template":
    case "button":
    case "interactive":
      return body || "Mensagem sem texto";
    case "image":
      return body || "Foto";
    case "document":
      return body || message.media_filename || "Documento";
    case "audio":
      return "Áudio";
    case "video":
      return body || "Vídeo";
    case "sticker":
      return "Figurinha";
    case "location":
      return body || "Localização";
    case "contacts":
      return body || "Contato";
    case "reaction":
      return body ? `Reagiu com ${body}` : "Reação";
    default:
      return body || "Mensagem que o painel não mostra. Ela está no Atendimento do ONE.";
  }
}

/** A file too big for the panel stays in ONE, and the panel says where. */
export const FILE_IN_ONE = "O arquivo está no Atendimento do ONE.";
