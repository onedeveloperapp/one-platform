import type { ReactElement } from "react";
import { Resend } from "resend";

/** True when transactional email is configured (server-only env var). */
export const isEmailConfigured = Boolean(process.env.RESEND_API_KEY);

/**
 * A defined-but-empty variable (`EMAIL_FROM=` on its own line — what
 * `vercel env pull` writes for a variable with no value) is not null, so `??`
 * would keep the empty string and every send would be rejected for an empty
 * From. Treat unset and empty as the same thing.
 */
export const emailEnv = (name: string): string | undefined => process.env[name]?.trim() || undefined;

const DEFAULT_FROM = emailEnv("EMAIL_FROM") ?? "onboarding@resend.dev";

export type SendResult = { sent: boolean; error?: string };

export type Message = {
  to: string;
  subject: string;
  react: ReactElement;
  replyTo?: string;
  /**
   * The address that stops this kind of message for this reader. It goes out
   * as List-Unsubscribe with the one-click marker (RFC 8058), so the button of
   * the mail client does what the link in the body does, and the provider of a
   * large mailbox does not treat a summary or a newsletter as unsolicited.
   */
  unsubscribeUrl?: string;
};

function payload(message: Message) {
  return {
    from: DEFAULT_FROM,
    to: message.to,
    subject: message.subject,
    react: message.react,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    ...(message.unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  };
}

/**
 * Sends one message. Returns { sent: false } without failing when
 * RESEND_API_KEY is absent: every caller has to work without e-mail (the bell
 * still rings, the link is still on the page).
 */
export async function send(message: Message): Promise<SendResult> {
  if (!isEmailConfigured) return { sent: false };
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send(payload(message));
  return error ? { sent: false, error: error.message } : { sent: true };
}

/** The most messages one batch request carries (the provider's limit). */
export const BATCH_LIMIT = 100;

/**
 * Sends up to BATCH_LIMIT messages in one request, each to its own reader. The
 * request is all or nothing: on an error none is counted as sent, and the
 * caller's own bookkeeping decides who is tried again.
 */
export async function sendBatch(messages: Message[]): Promise<SendResult & { count: number }> {
  if (!isEmailConfigured) return { sent: false, count: 0 };
  if (messages.length === 0) return { sent: true, count: 0 };
  if (messages.length > BATCH_LIMIT) return { sent: false, count: 0, error: "batch_too_large" };
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.batch.send(messages.map(payload));
  return error ? { sent: false, count: 0, error: error.message } : { sent: true, count: messages.length };
}
