import { type LocaleOption, LOCALES } from "@/constants";

/** A text the operator writes once per language the platform is written in. */
export type Localized = Partial<Record<LocaleOption, string>>;

/** The text in the first language that has one, in the order of `LOCALES`, then the fallback. */
export const textOf = (value: Localized | null | undefined, fallback = ""): string => {
  for (const locale of LOCALES) {
    const text = value?.[locale]?.trim();
    if (text) return text;
  }
  return fallback;
};
