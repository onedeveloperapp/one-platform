import { headers } from "next/headers";

import { REQUEST_PATH_HEADER } from "@/constants";

/**
 * True for a page that arrives complete from the server: a page of the public
 * site (app/[locale]) or a client's link (app/c). The middleware runs
 * next-intl only for the public site's addresses, and next-intl marks the
 * request it routed with this header (the same one that gives the request
 * config its `requestLocale`); a client's link is known by its path, which the
 * middleware always writes.
 */
export async function isPublicPageRequest(): Promise<boolean> {
  const list = await headers();
  return list.has("x-next-intl-locale") || (list.get(REQUEST_PATH_HEADER) ?? "").startsWith("/c/");
}
