import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailButton, EmailText } from "./shell";

export type KitReceiptEmailProps = {
  locale: EmailLocale;
  name: string | null;
  /** The plan as it is named in the data (`plans.name`). */
  planName: string;
  /** What was paid, already formatted for the reader ("R$ 97"). */
  amountLabel: string;
  /** When the access ends, already formatted; null when it has no end date. */
  untilLabel: string | null;
  /** BRL purchases get their tax invoice from Asaas; the message says where it comes from. */
  fiscalNote: boolean;
  /** The dashboard address the button opens. */
  appUrl: string;
};

/**
 * The receipt of a one-time access, sent by the webhook when the paid invoice
 * grants it. Transactional (it confirms a purchase), so it carries no
 * unsubscribe. What it says about the duration comes from the grant itself,
 * never from a sentence written here.
 */
export default function KitReceiptEmail({
  locale,
  name,
  planName,
  amountLabel,
  untilLabel,
  fiscalNote,
  appUrl,
}: KitReceiptEmailProps) {
  const copy = emailCopyFor(locale).accessReceipt;
  return (
    <EmailShell
      locale={locale}
      preview={copy.preview}
      heading={copy.heading}
      notes={[...(fiscalNote ? [copy.fiscal] : []), copy.keep]}
    >
      <EmailText>
        {copy.greeting(name)} {copy.body(amountLabel, planName)}
      </EmailText>
      <EmailText>{copy.unlocked(untilLabel)}</EmailText>
      <EmailButton href={appUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
