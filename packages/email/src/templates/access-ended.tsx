import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailButton, EmailText } from "./shell";

export type AccessEndedEmailProps = {
  locale: EmailLocale;
  /** The access that ended, as it is named in the data. */
  planName: string;
  /** The day it ended, already formatted for the reader. */
  endedLabel: string;
  /** The billing page the button opens: where the access is bought again. */
  billingUrl: string;
};

/**
 * "Your access has ended": the term of a one-time access ran out and nothing
 * else keeps the account active (a renewal or a subscription would, and then
 * this is not sent). Transactional, so it carries no unsubscribe.
 */
export default function AccessEndedEmail({ locale, planName, endedLabel, billingUrl }: AccessEndedEmailProps) {
  const copy = emailCopyFor(locale).accessEnded;
  return (
    <EmailShell locale={locale} preview={copy.preview} heading={copy.heading} notes={[copy.back]}>
      <EmailText>{copy.body(planName, endedLabel)}</EmailText>
      <EmailButton href={billingUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
