import type { WhatsAppEvent, WhatsAppProviderName } from "@flyee/whatsapp/types";

/**
 * What the platform does with each thing a webhook delivery says, with no
 * database in sight: `applyEvents` routes every event to its firm and hands it
 * to an inbox, which in production is the functions of migration 0019
 * (`lib/whatsapp/inbox.ts`) and in tests is a fake.
 *
 * Two rules are decided here and nowhere else. An event only reaches a number
 * of the provider whose signature the delivery carried, so a simulated
 * delivery can never touch a real number. And an event for a number no firm
 * has connected is dropped: one webhook serves every firm, and the vendor
 * also delivers for numbers that left.
 */

export type NumberRoute = { orgId: string; numberId: string; connectionId: string; wabaId: string; mode: string };
export type AccountNumber = { orgId: string; numberId: string; connectionId: string };

type EventOf<Type extends WhatsAppEvent["type"]> = Extract<WhatsAppEvent, { type: Type }>;

export interface WhatsAppInbox {
  /** The firm a number is active in, within a provider. Null when no firm has it connected. */
  route(provider: WhatsAppProviderName, phoneNumberId: string): Promise<NumberRoute | null>;
  /** The active numbers of an account at the vendor, within a provider. */
  accountNumbers(provider: WhatsAppProviderName, wabaId: string): Promise<AccountNumber[]>;
  inbound(route: NumberRoute, event: EventOf<"message">): Promise<{ mediaPending: boolean }>;
  status(route: NumberRoute, event: EventOf<"status">): Promise<void>;
  echo(route: NumberRoute, event: EventOf<"echo">): Promise<void>;
  contact(route: NumberRoute, event: EventOf<"contact">): Promise<void>;
  history(route: NumberRoute, event: EventOf<"history">): Promise<void>;
  disconnect(number: AccountNumber, reason: string): Promise<void>;
  templateStatus(provider: WhatsAppProviderName, event: EventOf<"template_status">): Promise<void>;
  templateCategory(provider: WhatsAppProviderName, event: EventOf<"template_category">): Promise<void>;
}

/** What a delivery came to, as counts: nothing of what it said is repeated here. */
export type DeliveryReport = {
  events: number;
  applied: number;
  /** For a number or an account no firm has connected. */
  unrouted: number;
  /** Understood, and nothing to do about it. */
  ignored: number;
  /** Could not be applied now: the vendor is asked to deliver again. */
  failed: number;
  /** A message brought a media that still has to be fetched into the firm's files. */
  mediaPending: boolean;
};

/**
 * The account events that mean the firm's number no longer answers to the
 * platform: the firm disconnected it on its phone, or it was taken off the
 * vendor's platform (the coexistence reference, read on 2026-10-09). Any other
 * account event changes nothing here.
 */
const DISCONNECTIONS = new Set(["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED"]);

/** A failure the vendor's retry cannot fix: the same data would be refused again. */
export class RefusedEvent extends Error {}

export async function applyEvents(
  inbox: WhatsAppInbox,
  provider: WhatsAppProviderName,
  events: readonly WhatsAppEvent[],
): Promise<DeliveryReport> {
  const report: DeliveryReport = {
    events: events.length,
    applied: 0,
    unrouted: 0,
    ignored: 0,
    failed: 0,
    mediaPending: false,
  };
  // One lookup per number per delivery: a delivery often carries many events of the same number.
  const routes = new Map<string, NumberRoute | null>();
  const routeOf = async (phoneNumberId: string): Promise<NumberRoute | null> => {
    if (!routes.has(phoneNumberId)) routes.set(phoneNumberId, await inbox.route(provider, phoneNumberId));
    return routes.get(phoneNumberId) ?? null;
  };

  for (const event of events) {
    try {
      if (event.type === "account") {
        if (!DISCONNECTIONS.has(event.event)) {
          report.ignored += 1;
          continue;
        }
        const numbers = await inbox.accountNumbers(provider, event.wabaId);
        if (numbers.length === 0) {
          report.unrouted += 1;
          continue;
        }
        for (const number of numbers) await inbox.disconnect(number, event.reason ?? event.event);
        report.applied += 1;
        continue;
      }
      if (event.type === "template_status") {
        await inbox.templateStatus(provider, event);
        report.applied += 1;
        continue;
      }
      if (event.type === "template_category") {
        await inbox.templateCategory(provider, event);
        report.applied += 1;
        continue;
      }

      const route = await routeOf(event.phoneNumberId);
      if (!route) {
        report.unrouted += 1;
        continue;
      }
      if (event.type === "message") {
        const { mediaPending } = await inbox.inbound(route, event);
        report.mediaPending = report.mediaPending || mediaPending;
      } else if (event.type === "status") {
        await inbox.status(route, event);
      } else if (event.type === "echo") {
        await inbox.echo(route, event);
      } else if (event.type === "contact") {
        await inbox.contact(route, event);
      } else if (event.type === "history") {
        await inbox.history(route, event);
      } else {
        // The firm chose not to share its history: there is nothing to bring.
        report.ignored += 1;
        continue;
      }
      report.applied += 1;
    } catch (error) {
      if (error instanceof RefusedEvent) report.ignored += 1;
      else report.failed += 1;
    }
  }
  return report;
}
