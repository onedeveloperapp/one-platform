/**
 * What the header bell says.
 *
 * A notification is stored as text (`notifications.title` / `body`), so the
 * language is chosen when it is written: `notifyLocalized`
 * (lib/notifications.ts) picks the copy here for each recipient. ONE writes in
 * Portuguese only; `BellCopy` is the type a second language would have to
 * match.
 *
 * The rules are the e-mails' (packages/email/src/copy/pt-BR.ts): a plan called
 * by the name it has in the data and never by a word written here, no sentence
 * that depends on the gender of that name, and dates that arrive already
 * formatted for the reader.
 */

export type BellLocale = "pt-BR";

const BELL_LOCALES: readonly BellLocale[] = ["pt-BR"];

/** The language a profile carries when the bell is written in it, else Portuguese. */
export const toBellLocale = (value: string | null | undefined): BellLocale =>
  BELL_LOCALES.find((locale) => locale === value) ?? "pt-BR";

export type BellText = { title: string; body: string };

const ptBR = {
  /** A new account is confirmed. */
  welcome: (): BellText => ({
    title: "Sua conta está criada",
    body: "A sua conta no ONE está pronta para uso.",
  }),

  /** A subscription went live. */
  planActive: (plan: string): BellText => ({
    title: "Pagamento confirmado",
    body: `${plan} já vale na sua conta.`,
  }),

  /** A one-time access was granted. `until` is the end of its term, already formatted; null when it has none. */
  accessGranted: (plan: string, until: string | null): BellText => ({
    title: "Acesso liberado",
    body: until
      ? `Pagamento confirmado: ${plan}. O acesso está liberado na sua conta até ${until}.`
      : `Pagamento confirmado: ${plan}. O acesso está liberado na sua conta.`,
  }),

  /** The term of a one-time access ran out and nothing else keeps the account active. */
  accessEnded: (plan: string, date: string): BellText => ({
    title: "Seu acesso terminou",
    body: `${plan} terminou em ${date}. Para renovar, faça uma nova compra em Cobrança.`,
  }),

  /** A late payment went through. */
  paymentRecovered: (): BellText => ({
    title: "Pagamento confirmado",
    body: "Sua assinatura está em dia e seu acesso segue liberado.",
  }),

  /** A charge failed. `days` is the grace period, 0 when there is none. */
  paymentFailed: (days: number): BellText => ({
    title: "Não conseguimos processar seu pagamento",
    body:
      days > 0
        ? `Atualize sua forma de pagamento em até ${days === 1 ? "1 dia" : `${days} dias`} para não interromper seu acesso.`
        : "Atualize sua forma de pagamento para manter seu acesso.",
  }),

  /** A subscription ended. `keepsAccess` is true when another purchase still keeps the account active. */
  subscriptionEnded: (plan: string, keepsAccess: boolean): BellText => ({
    title: "Sua assinatura foi encerrada",
    body: keepsAccess ? `${plan} terminou. O acesso continua por outra compra ativa.` : `${plan} terminou.`,
  }),

  /** A paid period that does not renew is about to end. */
  termEnding: (plan: string, date: string): BellText => ({
    title: "O período pago está terminando",
    body: `O período pago de ${plan} vai até ${date}. Para continuar depois dessa data, faça uma nova compra em Cobrança.`,
  }),

  /** Support opened the account. `operator` is the name of who did, when known. */
  supportAccess: (operator: string | null, reason: string, minutes: number): BellText => ({
    title: "Acesso de suporte à sua conta",
    body: `${operator ?? "A equipe de suporte"} acessou sua conta para investigar: "${reason}". O acesso é somente leitura e expira em ${minutes} minutos.`,
  }),
};

export type BellCopy = typeof ptBR;

const COPY: Record<BellLocale, BellCopy> = { "pt-BR": ptBR };

/** The bell's copy in one language. */
export const bellCopyFor = (locale: BellLocale): BellCopy => COPY[locale];
