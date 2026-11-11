import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailText } from "./shell";

export type AccountantPackageEmailProps = {
  locale: EmailLocale;
  /** The firm whose package it is. */
  firmName: string;
  /** The month, already written for the reader ("outubro de 2026"). */
  monthLabel: string;
  /** Who of the firm sent it, when the name is known. */
  senderName: string | null;
};

/**
 * The accountant's package of a month, sent by the firm to the accountant it registered (migration 0166): the
 * workbook goes attached, and the words say it is the firm's managerial reports, never the accounting. Transactional,
 * so it carries no unsubscribe; a reply goes to who sent it.
 */
export default function AccountantPackageEmail({
  locale,
  firmName,
  monthLabel,
  senderName,
}: AccountantPackageEmailProps) {
  const copy = emailCopyFor(locale).accountantPackage;
  return (
    <EmailShell
      locale={locale}
      preview={copy.preview(firmName, monthLabel)}
      heading={copy.heading}
      notes={[copy.managerial, copy.reply]}
    >
      <EmailText>{copy.body(senderName, firmName, monthLabel)}</EmailText>
    </EmailShell>
  );
}
