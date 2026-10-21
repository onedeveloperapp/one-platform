import UnsubscribePanel from "./unsubscribe-panel";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { readUnsubscribeTarget } from "@/lib/unsubscribe";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  // Reached only from a link in an e-mail: nothing here for a search engine (out of the sitemap too).
  return { title: t("unsubscribe-meta-title"), robots: { index: false, follow: false } };
}

/**
 * What the page asks, by whose preference the link changes: a member's news,
 * a contact of the list, or nothing (the link expired, or the page was opened
 * directly). Keys listed literally so the message pruner sees them in use.
 */
const HEADING = {
  member: { title: "unsubscribe-member-title", subtitle: "unsubscribe-member-subtitle" },
  lead: { title: "unsubscribe-lead-title", subtitle: "unsubscribe-lead-subtitle" },
  none: { title: "unsubscribe-expired-title", subtitle: "unsubscribe-expired-subtitle" },
} as const;

/**
 * Where an unsubscribe link lands. The link is
 * `/api/public/email/unsubscribe?k=…&t=…`; its route moves the request into an
 * httpOnly cookie and sends the browser here, so this page only knows whose
 * preference is about to change and never sees the token (lib/unsubscribe.ts).
 */
export default async function UnsubscribePage() {
  const [t, target] = await Promise.all([getTranslations("marketing"), readUnsubscribeTarget()]);
  const kind = target?.kind ?? null;
  const heading = HEADING[kind ?? "none"];

  return (
    <Section decor="glow">
      <SectionHeader
        as="h1"
        eyebrow={t("unsubscribe-eyebrow")}
        title={t(heading.title)}
        subtitle={t(heading.subtitle)}
      />
      <UnsubscribePanel kind={kind} />
    </Section>
  );
}
