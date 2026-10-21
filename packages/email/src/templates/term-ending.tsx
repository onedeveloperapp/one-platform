import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailButton, EmailText } from "./shell";

export type TermEndingEmailProps = {
  locale: EmailLocale;
  /** The plan as it is named in the data. */
  planName: string;
  /** The last day of the paid period, already formatted for the reader. */
  endsLabel: string;
  /** The billing page the button opens. */
  billingUrl: string;
};

/**
 * "The paid period is ending": a subscription bought as ONE payment does not
 * renew (today, the yearly plan paid in installments, docs/BILLING.md), so
 * nothing would tell the member before the day it stops. Sent once, about two
 * weeks ahead. The wording says "one-time purchase", which is true of any
 * single payment, split or not. Transactional, so it carries no unsubscribe.
 */
export default function TermEndingEmail({ locale, planName, endsLabel, billingUrl }: TermEndingEmailProps) {
  const copy = emailCopyFor(locale).termEnding;
  return (
    <EmailShell locale={locale} preview={copy.preview} heading={copy.heading}>
      <EmailText>{copy.body(planName, endsLabel)}</EmailText>
      <EmailText>{copy.next}</EmailText>
      <EmailButton href={billingUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
