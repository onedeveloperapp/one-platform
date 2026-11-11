import { createElement } from "react";

import { emailCopyFor } from "./copy";
import type { EmailLocale } from "./locale";
import { emailEnv, isEmailConfigured, send, sendBatch, type SendResult } from "./send";
import AccessEndedEmail, { type AccessEndedEmailProps } from "./templates/access-ended";
import AccountantPackageEmail, { type AccountantPackageEmailProps } from "./templates/accountant-package";
import HearingBriefEmail, { type HearingBriefEmailProps } from "./templates/hearing-brief";
import AgendaDigestEmail, { type AgendaDigestEmailProps } from "./templates/agenda-digest";
import ContactFormEmail, { type ContactFormEmailProps } from "./templates/contact-form";
import FirmInvitationEmail, { type FirmInvitationEmailProps } from "./templates/firm-invitation";
import KitReceiptEmail, { type KitReceiptEmailProps } from "./templates/kit-receipt";
import LeadConfirmEmail from "./templates/lead-confirm";
import MemberWelcomeEmail, { type MemberWelcomeEmailProps } from "./templates/member-welcome";
import NewsletterEmail from "./templates/newsletter";
import PartnerInvitationEmail, { type PartnerInvitationEmailProps } from "./templates/partner-invitation";
import SubscriptionActiveEmail, { type SubscriptionActiveEmailProps } from "./templates/subscription-active";
import SubscriptionCanceledEmail, {
  type CancelCause,
  type SubscriptionCanceledEmailProps,
} from "./templates/subscription-canceled";
import TermEndingEmail, { type TermEndingEmailProps } from "./templates/term-ending";
import WeeklyDigestEmail, { type WeeklyDigestEmailProps } from "./templates/weekly-digest";

export { toEmailLocale, type EmailLocale } from "./locale";
export type { AgendaDigestLine } from "./templates/agenda-digest";
export {
  type WeeklyDigestFacts,
  type WeeklyDigestLinks,
  type WeeklyDigestSection,
  weeklyDigestItems,
  weeklyDigestSections,
} from "./weekly";
export { BATCH_LIMIT, emailEnv, isEmailConfigured, type SendResult } from "./send";
export type {
  AccessEndedEmailProps,
  AccountantPackageEmailProps,
  AgendaDigestEmailProps,
  CancelCause,
  ContactFormEmailProps,
  FirmInvitationEmailProps,
  KitReceiptEmailProps,
  MemberWelcomeEmailProps,
  PartnerInvitationEmailProps,
  SubscriptionActiveEmailProps,
  SubscriptionCanceledEmailProps,
  TermEndingEmailProps,
  WeeklyDigestEmailProps,
};

/*
 * One sender per message. Each takes the reader's address and the template's
 * props (the language among them), picks the subject from the copy of that
 * language, and returns { sent } without throwing: a missing provider or a
 * rejected send degrades to "it is in the bell" or "the link is on the page",
 * never to a failed purchase, job or sign-up.
 */

/** A new account is confirmed. */
export const sendMemberWelcomeEmail = (to: string, props: MemberWelcomeEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).memberWelcome.subject,
    react: createElement(MemberWelcomeEmail, props),
  });

/** The receipt of the one-time access. Transactional, so no unsubscribe. */
export const sendKitReceiptEmail = (to: string, props: KitReceiptEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).accessReceipt.subject(props.planName),
    react: createElement(KitReceiptEmail, props),
  });

/** A subscription is live. Transactional. */
export const sendSubscriptionActiveEmail = (to: string, props: SubscriptionActiveEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).subscriptionActive.subject(props.planName),
    react: createElement(SubscriptionActiveEmail, props),
  });

/** A subscription has ended: what stays, what stops. Transactional. */
export const sendSubscriptionCanceledEmail = (to: string, props: SubscriptionCanceledEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).subscriptionCanceled.subject(props.planName),
    react: createElement(SubscriptionCanceledEmail, props),
  });

/** The term of a one-time access ran out and nothing else keeps the account active. Transactional. */
export const sendAccessEndedEmail = (to: string, props: AccessEndedEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).accessEnded.subject(props.planName),
    react: createElement(AccessEndedEmail, props),
  });

/** A paid period that does not renew is about to end. Transactional. */
export const sendTermEndingEmail = (to: string, props: TermEndingEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).termEnding.subject(props.planName, props.endsLabel),
    react: createElement(TermEndingEmail, props),
  });

/**
 * An invitation to join a firm. A reply goes to who invited, when their
 * address is given. Transactional.
 */
export const sendFirmInvitationEmail = (
  to: string,
  props: FirmInvitationEmailProps,
  replyTo?: string | null,
): Promise<SendResult> =>
  send({
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: emailCopyFor(props.locale).firmInvitation.subject(props.firmName),
    react: createElement(FirmInvitationEmail, props),
  });

/** An invitation to a partner of a firm (0069): a firm inviting an agency, or the agency a colleague. */
export const sendPartnerInvitationEmail = (
  to: string,
  props: PartnerInvitationEmailProps,
  replyTo?: string | null,
): Promise<SendResult> =>
  send({
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: emailCopyFor(props.locale).partnerInvitation.subject(props.partnerName, props.firmName),
    react: createElement(PartnerInvitationEmail, props),
  });

/**
 * A person's e-mail of the morning (migration 0132): their deadlines and hearings of the day and of the next 48 hours.
 * The reader may stop it, so it carries the one-click exit in its header too.
 */
/**
 * The accountant's package of a month (migration 0166), the workbook attached, to the accountant the firm registered.
 * A reply goes to who of the firm sent it.
 */
export const sendAccountantPackageEmail = (
  to: string,
  props: AccountantPackageEmailProps,
  file: { filename: string; content: Uint8Array },
  replyTo?: string | null,
): Promise<SendResult> =>
  send({
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: emailCopyFor(props.locale).accountantPackage.subject(props.firmName, props.monthLabel),
    react: createElement(AccountantPackageEmail, props),
    attachments: [file],
  });

/** The brief of a hearing for who goes to it (migration 0187), two business days before. */
export const sendHearingBriefEmail = (to: string, props: HearingBriefEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).hearingBrief.subject(props.caseSeq, props.whenLabel),
    react: createElement(HearingBriefEmail, props),
  });

export const sendAgendaDigestEmail = (to: string, props: AgendaDigestEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).agendaDigest.subject(props.dayLabel),
    react: createElement(AgendaDigestEmail, props),
    unsubscribeUrl: props.unsubscribeUrl,
  });

/** The partner's weekly digest (migration 0200), on Monday mornings; stopped in one click. */
export const sendWeeklyDigestEmail = (to: string, props: WeeklyDigestEmailProps): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(props.locale).weeklyDigest.subject(props.firmName, props.weekLabel),
    react: createElement(WeeklyDigestEmail, props),
    unsubscribeUrl: props.unsubscribeUrl,
  });

/** What a person does in a firm, in the words an e-mail uses. */
export const firmFunctionLabel = (locale: EmailLocale, firmFunction: string): string => {
  const labels: Record<string, string> = emailCopyFor(locale).firmInvitation.functions;
  return labels[firmFunction] ?? firmFunction;
};

/**
 * The waitlist's double opt-in link, in the language the person signed up in.
 * The caller decides what the visitor is told when it cannot be sent (the
 * address stays unconfirmed and is erased after 7 days).
 */
export const sendLeadConfirmationEmail = ({
  to,
  locale,
  confirmUrl,
}: {
  to: string;
  locale: EmailLocale;
  confirmUrl: string;
}): Promise<SendResult> =>
  send({
    to,
    subject: emailCopyFor(locale).leadConfirm.subject,
    react: createElement(LeadConfirmEmail, { locale, confirmUrl }),
  });

export type NewsletterMessage = {
  to: string;
  locale: EmailLocale;
  /** Written by the operator, in the reader's language. */
  subject: string;
  bodyMarkdown: string;
  /** This reader's own one-click address off the list. */
  unsubscribeUrl: string;
};

/**
 * One batch of an operator-written message (at most BATCH_LIMIT readers), each
 * with its own unsubscribe address. All or nothing: see `sendBatch`.
 */
export const sendNewsletterBatch = (messages: NewsletterMessage[]): Promise<SendResult & { count: number }> =>
  sendBatch(
    messages.map((message) => ({
      to: message.to,
      subject: message.subject,
      react: createElement(NewsletterEmail, {
        locale: message.locale,
        heading: message.subject,
        bodyMarkdown: message.bodyMarkdown,
        unsubscribeUrl: message.unsubscribeUrl,
      }),
      unsubscribeUrl: message.unsubscribeUrl,
    })),
  );

/**
 * Forwards a public contact-form submission to CONTACT_FORM_TO (falls back to
 * EMAIL_FROM). Returns { sent: false } when there is no provider or no
 * destination: the contact page then tells the visitor to use another channel.
 */
export async function sendContactFormEmail(props: ContactFormEmailProps): Promise<SendResult> {
  const to = emailEnv("CONTACT_FORM_TO") ?? emailEnv("EMAIL_FROM");
  if (!isEmailConfigured || !to) return { sent: false };
  return send({
    to,
    replyTo: props.email,
    subject: `Contato pelo site: ${props.name}`,
    react: createElement(ContactFormEmail, props),
  });
}
