import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailText } from "./shell";

export type HearingBriefEmailProps = {
  locale: EmailLocale;
  firmName: string;
  /** The case's number in the firm. */
  caseSeq: number;
  /** When the hearing is, already written for the reader ("quinta-feira, 12 de novembro, às 14:30"). */
  whenLabel: string;
  /** The brief's lines, as ONE wrote them: plain text, one thing per line. */
  lines: string[];
};

/**
 * The brief ONE prepared for who goes to a hearing (migration 0187): the facts, the documents, what each claimant asks
 * and the value the firm settles for at least, two business days before. Transactional: it carries no unsubscribe.
 */
export default function HearingBriefEmail({ locale, firmName, caseSeq, whenLabel, lines }: HearingBriefEmailProps) {
  const copy = emailCopyFor(locale).hearingBrief;
  return (
    <EmailShell
      locale={locale}
      preview={copy.preview(caseSeq, whenLabel)}
      heading={copy.heading(caseSeq)}
      notes={[copy.mayErr, copy.reason(firmName)]}
    >
      <EmailText>{copy.intro(whenLabel)}</EmailText>
      {lines.map((line, index) => (
        <EmailText key={index}>{line}</EmailText>
      ))}
    </EmailShell>
  );
}
