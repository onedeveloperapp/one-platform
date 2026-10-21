import type { MetadataRoute } from "next";

import { localizeHref, routing } from "@/i18n/routing";
import { listBlogForSitemap, listHelpForSitemap, type SitemapContent } from "@/lib/public-content";
import { absoluteUrl, everyLanguage, languageAlternates, sectionTranslations, type Translations } from "@/lib/seo";

/**
 * Indexed public pages, by internal path. Each enters once per language the
 * site is written in, with its hreflang alternates when there is more than
 * one (docs/SEO.md); the authenticated app never enters.
 *
 * Declared in src/i18n/routing.ts but deliberately absent (noindex):
 * /espera/confirmar (a one-time confirmation link) and /descadastro (reached
 * only from the unsubscribe link of an e-mail).
 */
const INDEXED_PAGES = [
  "/",
  "/contato",
  "/ajuda",
  "/blog",
  "/espera",
  "/legal/termos",
  "/legal/privacidade",
  "/legal/cookies",
];

/**
 * Rebuilt at most hourly. Without it the sitemap is prerendered once at build
 * time, and a help article or blog post published afterwards in the admin
 * consoles would never reach it until the next deploy.
 */
export const revalidate = 3600;

/** The `alternates` of a sitemap entry, or nothing when the page has no other language to name. */
function alternatesOf(paths: Translations): Pick<MetadataRoute.Sitemap[number], "alternates"> {
  const languages = Object.fromEntries(
    Object.entries(languageAlternates(paths)).map(([language, address]) => [language, absoluteUrl(address)]),
  );
  return Object.keys(languages).length > 0 ? { alternates: { languages } } : {};
}

function contentEntries(section: string, rows: SitemapContent[]): MetadataRoute.Sitemap {
  return rows.map((row) => ({
    url: absoluteUrl(localizeHref(`${section}/${row.slug}`, row.locale)),
    lastModified: row.updatedAt,
    changeFrequency: "weekly",
    priority: 0.5,
    ...alternatesOf(sectionTranslations(section, row.translations)),
  }));
}

/**
 * Static pages in every language plus the DB-managed help articles and blog
 * posts, each in the languages it was written in (no
 * fallback: an address in a language serves that language). Degrades to the
 * static list without Supabase env.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = INDEXED_PAGES.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: absoluteUrl(localizeHref(path, locale)),
      changeFrequency: "monthly" as const,
      priority: path === "/" ? 1 : 0.7,
      ...alternatesOf(everyLanguage(path)),
    })),
  );

  const [help, blog] = await Promise.all([listHelpForSitemap(), listBlogForSitemap()]);

  return [...staticEntries, ...contentEntries("/ajuda", help), ...contentEntries("/blog", blog)];
}
