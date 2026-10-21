/**
 * The languages the platform writes e-mail in. ONE writes in Portuguese only;
 * the type stays a union of one so a second language is added here and the
 * compiler names every copy table that has to learn it.
 */
export type EmailLocale = "pt-BR";

const EMAIL_LOCALES: readonly EmailLocale[] = ["pt-BR"];

/** The language a profile or a list contact carries when e-mail is written in it, else Portuguese. */
export const toEmailLocale = (value: string | null | undefined): EmailLocale =>
  EMAIL_LOCALES.find((locale) => locale === value) ?? "pt-BR";
