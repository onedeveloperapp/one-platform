import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";

import { isPublicLocale } from "@/i18n/routing";

/**
 * The language segment of the public site. The middleware rewrites `/contato`
 * to `/pt-BR/contato`, so every public page renders here with its language in
 * the internal URL. The logged area, sign-in and checkout are not under it.
 *
 * The provider is repeated on purpose. The root layout is shared by every
 * route and is not re-rendered by a client-side navigation, so its messages
 * stay those of the first page loaded; this segment does re-render when the
 * language in the URL changes, so the client components of a public page
 * always speak the language of its address.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // `[locale]` also catches any unknown one-segment address; only the
  // languages of the site are pages.
  if (!isPublicLocale(locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
