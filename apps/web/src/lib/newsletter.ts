import "server-only";

import { toMessageLocale, unsubscribeUrl } from "@/lib/messages/format";
import { BATCH_LIMIT, isEmailConfigured, sendNewsletterBatch } from "@flyee/email";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Delivery of a message the operator wrote to the confirmed list (the opening
 * notice, the news), started from /admin/leads.
 *
 * A send is a row of `newsletter_sends`; who received it is
 * `newsletter_deliveries` (migration 0023). The delivery is a loop of batches:
 * `claim_newsletter_batch` writes the delivery rows of the next readers BEFORE
 * the message leaves, the provider gets one request for the batch, and
 * `settle_newsletter_batch` either counts it or, when the provider refused it,
 * gives the readers back and marks the send as failed. So a retry, a second
 * worker or a resumed send never writes to the same person twice, and a reader
 * who left the list between two batches is not written to.
 *
 * Each reader gets the text of their own language and their own unsubscribe
 * address, in the body and in the List-Unsubscribe header.
 */

type Claim = {
  lead_id: string;
  email: string;
  locale: string;
  unsubscribe_token: string;
  subject: string;
  body_md: string;
};

export type NewsletterBatchOutcome = {
  /** Readers this batch took; 0 means the list is exhausted and the send was closed. */
  claimed: number;
  delivered: number;
  error?: string;
};

export async function deliverNewsletterBatch(service: SupabaseClient, sendId: string): Promise<NewsletterBatchOutcome> {
  // Without a provider nothing can leave: claim nobody, so the send stays as it is.
  if (!isEmailConfigured) return { claimed: 0, delivered: 0, error: "email_not_configured" };

  const { data, error } = await service.rpc("claim_newsletter_batch", {
    target_send: sendId,
    target_limit: BATCH_LIMIT,
  });
  if (error) throw new Error(`claim_newsletter_batch failed: ${error.message}`);
  const claims = (data ?? []) as Claim[];

  if (claims.length === 0) {
    const { error: finishError } = await service.rpc("finish_newsletter_send", { target_send: sendId });
    if (finishError) throw new Error(`finish_newsletter_send failed: ${finishError.message}`);
    return { claimed: 0, delivered: 0 };
  }

  const sent = await sendNewsletterBatch(
    claims.map((claim) => ({
      to: claim.email,
      locale: toMessageLocale(claim.locale),
      subject: claim.subject,
      bodyMarkdown: claim.body_md,
      unsubscribeUrl: unsubscribeUrl("lead", claim.unsubscribe_token),
    })),
  );

  const { error: settleError } = await service.rpc("settle_newsletter_batch", {
    target_send: sendId,
    target_leads: claims.map((claim) => claim.lead_id),
    target_delivered: sent.sent,
    target_error: sent.sent ? null : (sent.error ?? "send_failed"),
  });
  if (settleError) throw new Error(`settle_newsletter_batch failed: ${settleError.message}`);

  return sent.sent
    ? { claimed: claims.length, delivered: sent.count }
    : { claimed: claims.length, delivered: 0, error: sent.error ?? "send_failed" };
}

export type NewsletterOutcome = {
  batches: number;
  delivered: number;
  /** The list was exhausted and the send is closed. */
  done: boolean;
  error?: string;
};

/**
 * Delivers a send in this process, for as long as the time budget allows: the
 * path taken when there is no queue. A send that runs out of time simply stays
 * in "sending"; resuming it continues with whoever has not been written to.
 */
export async function deliverNewsletter(
  service: SupabaseClient,
  sendId: string,
  budgetMs: number = 45_000,
): Promise<NewsletterOutcome> {
  const startedAt = Date.now();
  const outcome: NewsletterOutcome = { batches: 0, delivered: 0, done: false };
  while (Date.now() - startedAt < budgetMs) {
    const batch = await deliverNewsletterBatch(service, sendId);
    if (batch.error) return { ...outcome, error: batch.error };
    if (batch.claimed === 0) return { ...outcome, done: true };
    outcome.batches += 1;
    outcome.delivered += batch.delivered;
  }
  return outcome;
}
