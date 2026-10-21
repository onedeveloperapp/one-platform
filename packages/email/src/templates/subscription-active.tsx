import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { EmailButton, EmailText } from "./shell";

export type SubscriptionActiveEmailProps = {
  locale: EmailLocale;
  name: string | null;
  /** The plan as it is named in the data (`plans.name`). */
  planName: string;
  /** The dashboard address the button opens. */
  appUrl: string;
};

/**
 * "Payment confirmed": a subscription is live. With Pix the confirmation lands
 * minutes or hours after the person closed the tab, so without this they only
 * find out by coming back. Transactional (it confirms a purchase), so it
 * carries no unsubscribe.
 *
 * It names the plan and nothing else: what a plan includes is data
 * (`plans.limits`), and the sentences for ONE's limits are written with the
 * subscription tiers (docs/ONE-PLANO-DESENVOLVIMENTO.md, M3).
 */
export default function SubscriptionActiveEmail({ locale, name, planName, appUrl }: SubscriptionActiveEmailProps) {
  const copy = emailCopyFor(locale).subscriptionActive;
  return (
    <EmailShell locale={locale} preview={copy.preview(planName)} heading={copy.heading} notes={[copy.manage]}>
      <EmailText>{copy.greeting(name, planName)}</EmailText>
      <EmailButton href={appUrl}>{copy.button}</EmailButton>
    </EmailShell>
  );
}
