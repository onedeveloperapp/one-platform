import { EventSchemas, Inngest } from "inngest";

/**
 * Platform-wide event map. Packages and apps/web declare their events here so
 * every `inngest.send` and function trigger stays typed. ONE's events use the
 * `one/` prefix; the functions they start live in apps/web/src/lib/*-jobs.ts.
 */
export type JobEvents = {
  /** Run a logical database backup now (@flyee/backup); also fires on a daily cron. */
  "one/backup.run.requested": { data: Record<string, never> };
  /** Deliver a message the operator wrote to the confirmed list (newsletter_sends). */
  "one/newsletter.send": { data: { sendId: string } };
  /** A WhatsApp delivery brought a media: fetch what is pending now instead of at the next sweep. */
  "one/whatsapp.media.pending": { data: Record<string, never> };
  /** A person sent a document to be signed by ZapSign: open what is reserved now instead of at the next sweep. */
  "one/signature.requested": { data: Record<string, never> };
  /** A document reached a case: normalize it and ask the AI's check now instead of at the next sweep. */
  "one/case.document.received": { data: { documentId: string } };
  /** A client's account reached a case: transcribe it and ask for its chronology now instead of at the next sweep. */
  "one/case.statement.received": { data: { statementId: string } };
  /** A person asked for the filing package of a lawsuit: build it now instead of at the next sweep. */
  "one/case.filing.requested": { data: { packageId: string } };
  /** A package of a system that takes signed files was built, a lawyer asked for its signature, or a lawyer authorized ONE: sign what is owed now. */
  "one/case.filing.signature": { data: { packageId: string | null } };
  /** A draft of a piece is owed a work (its first text, the reading of its citations, its PDF): do it now. */
  "one/case.draft.requested": { data: { draftId: string } };
  /** A case may have a step for ONE to take (a person's change, a piece issued, a paper ONE accepted): look now. */
  "one/case.advance": { data: { caseId: string | null } };
  /** A leg of a case was written: check it against the official record now instead of at the next sweep. */
  "one/case.flights.changed": { data: { caseId: string | null } };
  "one/proceedings.read.requested": { data: { trackingId: string } };
  /** A person of a firm asked for a reading of the DJEN now: read its registrations instead of waiting for the sweep. */
  "one/publications.capture.requested": { data: { orgId: string } };
  /** A person triaged a publication as a deadline or a hearing: ONE reads it now instead of at the next sweep. */
  "one/publication.read": { data: { publicationId: string | null } };
  /** A deadline is owed a count (a person wrote it, a court's calendar changed): count it now instead of at the next sweep. */
  "one/deadline.count": { data: { deadlineId: string | null } };
  /** A hearing was written or changed (its id), or a calendar was connected (null): its events are owed at once. */
  "one/hearings.changed": { data: { hearingId: string | null } };
  /** A firm switched a kind of notice on, or somebody agreed to be told: reserve and send what is due now. */
  "one/notices.sweep": { data: Record<string, never> };
  /** A flight ONE follows has a problem (its alert), or the sweep is asked: tell what is due now. */
  "one/flight.alerts": { data: { alertId: string | null } };
  /** A passenger wrote in a conversation ONE answers: its turn, once they stop writing. */
  "one/conversation.turn": { data: { conversationId: string } };
};

export const isInngestConfigured = Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);

/**
 * Single Inngest client for the whole platform. In local dev it talks to
 * `npx inngest-cli dev` (no keys needed); in production it requires
 * INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY.
 */
export const inngest = new Inngest({
  id: "one",
  schemas: new EventSchemas().fromRecord<JobEvents>(),
});

export type SendEventResult = { sent: true } | { sent: false; hint: string };

/**
 * Fire-and-forget event send that never throws. When Inngest is unreachable
 * (no keys in production, dev server not running locally) it returns
 * `{ sent: false }` so the caller can fall back to inline processing.
 */
export async function sendEvent<Name extends keyof JobEvents & string>(
  name: Name,
  data: JobEvents[Name]["data"],
): Promise<SendEventResult> {
  try {
    await inngest.send({ name, data } as never);
    return { sent: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      sent: false,
      hint: isInngestConfigured
        ? `Inngest send failed: ${detail}`
        : `Inngest is not configured (set INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY, or run "npx inngest-cli dev" locally): ${detail}`,
    };
  }
}
