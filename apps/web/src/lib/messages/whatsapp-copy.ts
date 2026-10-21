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
};

export type WhatsAppCopy = typeof ptBR;

export const WHATSAPP_COPY: Record<WhatsAppLocale, WhatsAppCopy> = { "pt-BR": ptBR };
