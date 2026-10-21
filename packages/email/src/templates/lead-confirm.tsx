import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailButton, EmailText } from "./shell";

export type LeadConfirmEmailProps = {
  locale: EmailLocale;
  /** The one-time confirmation link (valid for 7 days). */
  confirmUrl: string;
};

/**
 * Double opt-in for the waitlist (migration 0013): the address only joins the
 * list once its owner clicks the link. Transactional by nature (it answers a
 * request made on the site), so it carries no unsubscribe: an unconfirmed
 * address receives nothing else and is erased after 7 days.
 */
export default function LeadConfirmEmail({ locale, confirmUrl }: LeadConfirmEmailProps) {
  const copy = emailCopyFor(locale).leadConfirm;
  return (
    <EmailShell locale={locale} preview={copy.preview} heading={copy.heading} notes={[copy.expiry, copy.ignore]}>
      <EmailText>{copy.body}</EmailText>
      <EmailButton href={confirmUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
