import { Link, Section, Text } from "@react-email/components";

import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import { type WeeklyDigestFacts, type WeeklyDigestLinks, weeklyDigestSections } from "../weekly";
import EmailShell, { COLOR, EmailButton, EmailText } from "./shell";

export type WeeklyDigestEmailProps = {
  locale: EmailLocale;
  firmName: string;
  /** The week, already formatted for the reader ("2 a 8 de novembro"). */
  weekLabel: string;
  facts: WeeklyDigestFacts;
  links: WeeklyDigestLinks;
  homeUrl: string;
  unsubscribeUrl: string;
};

/**
 * The partner's weekly digest (migration 0200): every Monday morning, the firm's week before in numbers beside the
 * week before it, what this week holds, what waits for the firm and what ONE did. Numbers only: nothing of a client,
 * a lawsuit's number or a case's value; the person reads the rest in ONE. Stopped in one click.
 */
export default function WeeklyDigestEmail({
  locale,
  firmName,
  weekLabel,
  facts,
  links,
  homeUrl,
  unsubscribeUrl,
}: WeeklyDigestEmailProps) {
  const copy = emailCopyFor(locale).weeklyDigest;
  const sections = weeklyDigestSections(locale, facts, links);
  return (
    <EmailShell
      locale={locale}
      preview={copy.preview(facts.cases.opened, facts.cases.closings, facts.cases.filed)}
      heading={copy.heading(weekLabel)}
      notes={[copy.reason(firmName)]}
      unsubscribe={{ label: copy.unsubscribe, url: unsubscribeUrl }}
    >
      {facts.testsCounted ? <EmailText>{copy.tests}</EmailText> : null}
      {sections.map((section) => (
        <Section key={section.key} style={{ margin: "0 0 16px" }}>
          <Text style={{ color: COLOR.text, fontSize: 15, fontWeight: 700, lineHeight: "22px", margin: "0 0 6px" }}>
            {section.title}
            {" · "}
            <Link href={section.url} style={{ color: COLOR.muted, fontSize: 13, fontWeight: 400, textDecoration: "underline" }}>
              {copy.open}
            </Link>
          </Text>
          {section.lines.map((line) => (
            <Text key={line} style={{ color: COLOR.text, fontSize: 14, lineHeight: "22px", margin: "0 0 4px" }}>
              {`• ${line}`}
            </Text>
          ))}
        </Section>
      ))}
      <EmailButton href={homeUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
