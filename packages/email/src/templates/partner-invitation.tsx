import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailButton, EmailText } from "./shell";

export type PartnerInvitationEmailProps = {
  locale: EmailLocale;
  /** The agency, as the firm named it or as it is named. */
  partnerName: string;
  /** The firm that invites the agency to be its partner; null for a colleague of the agency. */
  firmName: string | null;
  /** Who invited, when the name is known. */
  inviterName: string | null;
  /** The invitation page: it shows the invitation before anybody signs in. */
  acceptUrl: string;
  /** The last day the invitation can be accepted, already formatted for the reader. */
  expiresLabel: string;
};

/**
 * An invitation to a partner of a firm (migration 0069): a firm inviting a travel agency to be its partner, or the
 * agency inviting a colleague. As a firm's invitation, the link only SHOWS it: what accepts it is an account whose
 * confirmed e-mail is this address. Transactional, so it carries no unsubscribe.
 */
export default function PartnerInvitationEmail({
  locale,
  partnerName,
  firmName,
  inviterName,
  acceptUrl,
  expiresLabel,
}: PartnerInvitationEmailProps) {
  const copy = emailCopyFor(locale).partnerInvitation;
  return (
    <EmailShell
      locale={locale}
      preview={copy.preview(partnerName, firmName)}
      heading={copy.heading}
      notes={[copy.expiry(expiresLabel), copy.ignore]}
    >
      <EmailText>{copy.body(inviterName, partnerName, firmName)}</EmailText>
      <EmailText>{copy.account}</EmailText>
      <EmailButton href={acceptUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
