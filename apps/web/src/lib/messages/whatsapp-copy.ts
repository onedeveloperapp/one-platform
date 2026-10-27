/**
 * What the platform writes to a client over WhatsApp in the firm's name.
 *
 * The rules are the e-mails' and the bell's (lib/messages/bell-copy.ts): one
 * copy object per language, plain Portuguese, no dash, no exclamation mark,
 * no emoji, and the firm named as it calls itself. The free text goes only
 * inside the 24 hours after the client's last message; outside them, the
 * firm writes with one of its approved templates.
 */

export type WhatsAppLocale = "pt-BR";

const ptBR = {
  /** The link of the client's folder, sent from the case. */
  clientLink: (input: { firstName: string; firm: string; url: string }): string =>
    [
      input.firstName ? `Olá, ${input.firstName}.` : "Olá.",
      `Este é o link para enviar ao ${input.firm} os seus dados, os do seu voo e os seus documentos: ${input.url}`,
      "O link é só seu. Se tiver qualquer dúvida, responda esta mensagem.",
    ].join("\n\n"),
  /**
   * ONE's word once the client said, on their link, that they sent everything (0055), or once their case has all
   * it needs and moved on before they said it (0057): it arrived, and what comes next, the power of attorney first
   * when one ONE sent waits for their signature. A case that moved on takes no more papers on the link.
   */
  caseReceived: (input: { firstName: string; paperWaiting: boolean; finished: boolean }): string => {
    const prepares = input.finished
      ? "O escritório confere os documentos e prepara a ação."
      : "O escritório prepara a ação.";
    return [
      input.finished
        ? input.firstName
          ? `Recebi o seu aviso de que terminou, ${input.firstName}. Obrigado.`
          : "Recebi o seu aviso de que terminou. Obrigado."
        : input.firstName
          ? `Recebi tudo o que o seu caso precisa, ${input.firstName}. Obrigado.`
          : "Recebi tudo o que o seu caso precisa. Obrigado.",
      "Os próximos passos:",
      ...(input.paperWaiting
        ? [
            "1. Assine a procuração que está no seu link. Ela autoriza o escritório a entrar com a ação em seu nome.",
            `2. ${prepares}`,
            "3. Quando a ação for protocolada, o escritório avisa você por aqui.",
          ]
        : [`1. ${prepares}`, "2. Quando a ação for protocolada, o escritório avisa você por aqui."]),
      input.finished
        ? "Se lembrar de mais alguma coisa, ainda pode enviar pelo mesmo link."
        : "Se precisar mudar alguma coisa, me diga por aqui.",
    ].join("\n");
  },
};

export type WhatsAppCopy = typeof ptBR;

export const WHATSAPP_COPY: Record<WhatsAppLocale, WhatsAppCopy> = { "pt-BR": ptBR };
