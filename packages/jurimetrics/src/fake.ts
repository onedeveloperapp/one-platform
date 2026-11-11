import type { MarketListing, MarketQuery, MarketSource } from "@flyee/jurimetrics/types";
import { MarketUnavailableError } from "@flyee/jurimetrics/types";
import { readMarketDecision } from "@flyee/jurimetrics/read";

/**
 * A source of public decisions in memory, for development and tests: the texts a test gives it for a court, a party
 * and a day, read by the same rule the real source reads with. A day it has nothing for is a day with nothing. It
 * keeps every query that reached it; a test makes the next one fail (`failNext`).
 */
export class FakeMarketSource implements MarketSource {
  readonly name = "fake";
  readonly asked: MarketQuery[] = [];
  private readonly days = new Map<string, { key: string; unit: string | null; text: string }[]>();
  private failing = false;

  /** The communications of a court, a party and a day. */
  give(query: MarketQuery, items: { key: string; unit: string | null; text: string }[]): void {
    this.days.set(`${query.court}|${query.party}|${query.day}`, items);
  }

  failNext(): void {
    this.failing = true;
  }

  async decisionsOn(query: MarketQuery): Promise<MarketListing> {
    this.asked.push(query);
    if (this.failing) {
      this.failing = false;
      throw new MarketUnavailableError(null);
    }
    const items = this.days.get(`${query.court}|${query.party}|${query.day}`) ?? [];
    const decisions = items.flatMap((item) => {
      const decision = readMarketDecision({
        key: item.key,
        court: query.court,
        unit: item.unit,
        party: query.party,
        day: query.day,
        text: item.text,
      });
      return decision ? [decision] : [];
    });
    return { decisions, read: items.length, complete: true };
  }
}
