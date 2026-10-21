import { useLocale } from "next-intl";

import { BRAND } from "@/brand";
import JsonLd from "@/components/marketing/json-ld";
import { localizeHref } from "@/i18n/routing";

/**
 * BreadcrumbList for an interior page.
 *
 * Without it Google prints the bare URL under the title and, when it does draw
 * a trail, derives the labels from the slug — "como-funciona". With it the
 * trail is ours: real names, in the site's language, and an explicit
 * parent/child signal instead of one inferred from the path.
 *
 * The home is always the first crumb and is added HERE, so no page has to
 * remember it and no two pages can name it differently. Paths are the
 * internal (Portuguese) ones; each crumb points at the address of the language
 * being read, absolute on `BRAND.siteUrl`, the canonical host the whole
 * metadata layer already agrees on.
 *
 * Not for the home itself: a one-item breadcrumb describes nothing.
 */
export default function BreadcrumbJsonLd({
  home,
  trail,
}: {
  /** The home's name, translated — the first crumb. */
  home: string;
  /** Everything after the home, in order, ending at the current page. */
  trail: { name: string; path: string }[];
}) {
  const locale = useLocale();
  const crumbs = [{ name: home, path: "/" }, ...trail];

  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((crumb, index) => {
          const address = localizeHref(crumb.path, locale);
          return {
            "@type": "ListItem",
            position: index + 1,
            name: crumb.name,
            item: `${BRAND.siteUrl}${address === "/" ? "" : address}`,
          };
        }),
      }}
    />
  );
}
