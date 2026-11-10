import { Link, Section, Text } from "@react-email/components";

import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { COLOR, EmailButton, EmailText } from "./shell";

/** One item of the agenda, already in the reader's words: the act or the hearing, the case's number, the day. */
export type AgendaDigestLine = {
  text: string;
  /** The case in ONE, when the item has one. */
  url: string | null;
  /** Changed since the e-mail before. */
  changed: boolean;
};

export type AgendaDigestEmailProps = {
  locale: EmailLocale;
  firmName: string;
  /** The day, already formatted for the reader ("terça-feira, 10 de novembro"). */
  dayLabel: string;
  /** Whether the e-mail is of the whole firm (a partner, the controladoria) or of what the person answers for. */
  wholeFirm: boolean;
  today: AgendaDigestLine[];
  next: AgendaDigestLine[];
  agendaUrl: string;
  unsubscribeUrl: string;
};

function Lines({ lines, changedLabel }: { lines: AgendaDigestLine[]; changedLabel: string }) {
  return (
    <Section style={{ margin: "0 0 16px" }}>
      {lines.map((line, index) => (
        <Text key={`${index}:${line.text}`} style={{ color: COLOR.text, fontSize: 14, lineHeight: "22px", margin: "0 0 6px" }}>
          {"• "}
          {line.url ? (
            <Link href={line.url} style={{ color: COLOR.text, textDecoration: "underline" }}>
              {line.text}
            </Link>
          ) : (
            line.text
          )}
          {line.changed ? <span style={{ color: COLOR.muted }}>{` · ${changedLabel}`}</span> : null}
        </Text>
      ))}
    </Section>
  );
}

/**
 * The e-mail of the morning (migration 0132): a person's fatal and internal deadlines and hearings of the day, and
 * those of the next 48 hours with what changed. Sent only when there is something, on business mornings; the person
 * stops it in one click (the link in the body and the mail client's own button). An item is named by its act, or
 * "Prazo", and the case's number: never a typed title, which may hold the client's name.
 */
export default function AgendaDigestEmail({
  locale,
  firmName,
  dayLabel,
  wholeFirm,
  today,
  next,
  agendaUrl,
  unsubscribeUrl,
}: AgendaDigestEmailProps) {
  const copy = emailCopyFor(locale).agendaDigest;
  return (
    <EmailShell
      locale={locale}
      preview={copy.preview(today.length, next.length)}
      heading={copy.heading(dayLabel)}
      notes={[copy.reason(firmName, wholeFirm), copy.calendar]}
      unsubscribe={{ label: copy.unsubscribe, url: unsubscribeUrl }}
    >
      <Text style={{ color: COLOR.text, fontSize: 15, fontWeight: 700, lineHeight: "22px", margin: "0 0 8px" }}>
        {copy.todayTitle}
      </Text>
      {today.length > 0 ? <Lines lines={today} changedLabel={copy.changed} /> : <EmailText>{copy.todayNone}</EmailText>}
      {next.length > 0 ? (
        <>
          <Text style={{ color: COLOR.text, fontSize: 15, fontWeight: 700, lineHeight: "22px", margin: "0 0 8px" }}>
            {copy.nextTitle}
          </Text>
          <Lines lines={next} changedLabel={copy.changed} />
        </>
      ) : null}
      <EmailButton href={agendaUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
