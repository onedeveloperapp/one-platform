import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailButton, EmailText } from "./shell";

export type MemberWelcomeEmailProps = {
  locale: EmailLocale;
  name: string | null;
  /** The dashboard address the button opens. */
  appUrl: string;
};

/**
 * "Your account is ready": sent once, when a new account is confirmed. A
 * message about the account the person just created, so it carries no
 * unsubscribe and promotes nothing.
 */
export default function MemberWelcomeEmail({ locale, name, appUrl }: MemberWelcomeEmailProps) {
  const copy = emailCopyFor(locale).memberWelcome;
  return (
    <EmailShell locale={locale} preview={copy.preview} heading={copy.heading} notes={[copy.reason]}>
      <EmailText>{copy.greeting(name)}</EmailText>
      <EmailText>{copy.body}</EmailText>
      <EmailButton href={appUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
