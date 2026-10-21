import { defineRouting } from "next-intl/routing";

import { DEFAULTS } from "@/config";
import { type LocaleOption, LOCALES } from "@/constants";

/** A page's address: the same in every language, or one per language. */
type PathnameValue = string | Record<LocaleOption, string>;

/**
 * The pages of the PUBLIC site. ONE is written in Portuguese only, so every
 * address lives at the root (`/contato`) and `/pt-BR/contato` redirects to it.
 * The logged area, the admin, sign-in and checkout are NOT routed here: they
 * are not indexed and have no language in the URL.
 *
 * The keys are the internal paths, which match the folders under
 * app/[locale]/(marketing). Declaring a page here is also what makes the
 * middleware treat it as public. A second language would give a page a
 * per-language address (`{ "pt-BR": "/contato", en: "/contact" }`): the helpers
 * below already read both shapes.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULTS.locale as LocaleOption,
  localePrefix: "as-needed",
  // The URL is the language: no redirect from Accept-Language or a cookie.
  localeDetection: false,
  localeCookie: false,
  // Each page states its own canonical address in its metadata (lib/seo.ts).
  alternateLinks: false,
  pathnames: {
    "/": "/",
    "/contato": "/contato",
    "/ajuda": "/ajuda",
    "/ajuda/[slug]": "/ajuda/[slug]",
    "/blog": "/blog",
    "/blog/[slug]": "/blog/[slug]",
    "/legal/termos": "/legal/termos",
    "/legal/privacidade": "/legal/privacidade",
    "/legal/cookies": "/legal/cookies",
    "/espera": "/espera",
    "/espera/confirmar": "/espera/confirmar",
    "/descadastro": "/descadastro",
  },
});

export type PublicLocale = (typeof routing.locales)[number];
export type PublicPathname = keyof typeof routing.pathnames;

export const isPublicLocale = (value: unknown): value is PublicLocale =>
  typeof value === "string" && (routing.locales as readonly string[]).includes(value);

type Template = { source: string; pattern: RegExp; names: string[] };

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `/blog/[slug]` → a matcher capturing `slug`. */
function compile(source: string): Template {
  const names: string[] = [];
  const pattern = source
    .split(/(\[[^\]]+\])/)
    .map((part) => {
      const param = /^\[([^\]]+)\]$/.exec(part);
      if (!param) return escapeForRegExp(part);
      names.push(param[1]);
      return "([^/]+)";
    })
    .join("");
  return { source, pattern: new RegExp(`^${pattern}$`), names };
}

function capture(template: Template, path: string): Record<string, string> | null {
  const match = template.pattern.exec(path);
  if (!match) return null;
  return Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
}

const fill = (source: string, params: Record<string, string>) =>
  source.replace(/\[([^\]]+)\]/g, (_, name: string) => params[name] ?? "");

const ENTRIES = Object.entries(routing.pathnames as Record<string, PathnameValue>).map(([internal, value]) => ({
  internal: compile(internal),
  external: Object.fromEntries(
    routing.locales.map((locale) => [locale, compile(typeof value === "string" ? value : value[locale])]),
  ) as Record<PublicLocale, Template>,
}));

/** Splits `/contato?x=1#y` into the path and the rest. */
function splitHref(href: string): [string, string] {
  const cut = href.search(/[?#]/);
  return cut === -1 ? [href, ""] : [href.slice(0, cut), href.slice(cut)];
}

/** `/pt-BR/contato` → ["pt-BR", "/contato"]; `/contato` → [null, "/contato"]. */
function splitLocalePrefix(pathname: string): [PublicLocale | null, string] {
  for (const locale of routing.locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return [locale, pathname.slice(prefix.length) || "/"];
    }
  }
  return [null, pathname];
}

export type PublicPathMatch = {
  /** The language the address asks for. */
  locale: PublicLocale;
  /** The internal path with its parameters filled: `/blog/x`. */
  internal: string;
  /** Whether the address carries a locale prefix (`/pt-BR/...`). */
  prefixed: boolean;
};

/**
 * Whether a request path is a page of the public site, with or without a
 * locale prefix, and which language it asks for.
 */
export function matchPublicPath(pathname: string): PublicPathMatch | null {
  const [prefixLocale, rest] = splitLocalePrefix(pathname);
  const order = prefixLocale
    ? [prefixLocale, ...routing.locales.filter((locale) => locale !== prefixLocale)]
    : [routing.defaultLocale, ...routing.locales.filter((locale) => locale !== routing.defaultLocale)];

  for (const locale of order) {
    for (const entry of ENTRIES) {
      const params = capture(entry.external[locale], rest);
      if (params) {
        return {
          locale: prefixLocale ?? locale,
          internal: fill(entry.internal.source, params),
          prefixed: prefixLocale !== null,
        };
      }
    }
  }
  return null;
}

/**
 * The address of a public page in a language. The input is the internal path;
 * in the default language the address is the path itself. Anything that is not
 * a public page (`/auth/sign-up`, an absolute URL, an address that already
 * carries a prefix) comes back unchanged, so every link on the site can go
 * through this.
 */
export function localizeHref(href: string, locale: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const target: PublicLocale = isPublicLocale(locale) ? locale : routing.defaultLocale;
  const [path, suffix] = splitHref(href);
  if (splitLocalePrefix(path)[0] !== null) return href;

  for (const entry of ENTRIES) {
    const params = capture(entry.internal, path);
    if (!params) continue;
    const external = fill(entry.external[target].source, params);
    if (target === routing.defaultLocale) return `${external}${suffix}`;
    return `/${target}${external === "/" ? "" : external}${suffix}`;
  }
  return href;
}
