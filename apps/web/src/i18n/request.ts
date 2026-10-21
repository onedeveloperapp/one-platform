import { getRequestConfig } from "next-intl/server";

import { DEFAULTS } from "@/config";
import { LocaleOption } from "@/constants";
import { isPublicLocale } from "@/i18n/routing";

// Message catalogs live in @flyee/content. Static map instead of a
// template-string import so the bundler can resolve each catalog.
const MESSAGES: Record<LocaleOption, () => Promise<{ default: Record<string, unknown> }>> = {
  "pt-BR": () => import("@flyee/content/messages/pt-BR.json"),
};

/**
 * A public page carries its language in the address: next-intl hands it over
 * as `requestLocale` (the `[locale]` segment, or the header the middleware
 * sets for it). Everything else (sign-in, the logged area, checkout) has no
 * locale in the URL and renders in the default language.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: LocaleOption = isPublicLocale(requested) ? requested : (DEFAULTS.locale as LocaleOption);

  return {
    locale,
    messages: (await MESSAGES[locale]()).default,
    timeZone: "UTC",
  };
});
