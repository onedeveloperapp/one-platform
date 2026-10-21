import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailButton, EmailText } from "./shell";

export type FirmInvitationEmailProps = {
  locale: EmailLocale;
  /** The firm, as it is named in the data. */
  firmName: string;
  /** Who invited, when the name is known. */
  inviterName: string | null;
  /** What the person will do in the firm, already in the reader's words. */
  functionLabel: string;
  /** The invitation page: it shows the invitation before anybody signs in. */
  acceptUrl: string;
  /** The last day the invitation can be accepted, already formatted for the reader. */
  expiresLabel: string;
};

/**
 * An invitation to join a firm (migration 0003). The link only SHOWS the
 * invitation: what accepts it is an account whose confirmed e-mail is this
 * address, which is why the message says to sign in with it. Transactional,
 * so it carries no unsubscribe: an invitation nobody accepts expires and
 * nothing else is sent.
 */
export default function FirmInvitationEmail({
  locale,
  firmName,
  inviterName,
  functionLabel,
  acceptUrl,
  expiresLabel,
}: FirmInvitationEmailProps) {
  const copy = emailCopyFor(locale).firmInvitation;
  return (
    <EmailShell
      locale={locale}
      preview={copy.preview(firmName)}
      heading={copy.heading}
      notes={[copy.expiry(expiresLabel), copy.ignore]}
    >
      <EmailText>{copy.body(inviterName, firmName)}</EmailText>
      <EmailText>{copy.role(functionLabel)}</EmailText>
      <EmailText>{copy.account}</EmailText>
      <EmailButton href={acceptUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
