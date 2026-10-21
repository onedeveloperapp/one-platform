"use client";

import NextLink from "next/link";
import { useLocale } from "next-intl";
import { type ComponentProps, forwardRef } from "react";

import { localizeHref } from "@/i18n/routing";

/**
 * next/link for the public site. `href` is the internal path and the link
 * points at the public address of the language being read
 * (src/i18n/routing.ts). Anything that is not a public page (`/auth/sign-up`,
 * an external URL, an address that already carries a language) passes through
 * unchanged, so every link of a public surface goes through it, including as
 * MUI's `LinkComponent`.
 */
const LocaleLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function LocaleLink(
  { href, ...props },
  ref,
) {
  const locale = useLocale();
  return <NextLink ref={ref} href={typeof href === "string" ? localizeHref(href, locale) : href} {...props} />;
});

export default LocaleLink;
