import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readClaimedHistory } from "@/lib/publications/history-work";
import { FakeDjenClient, type FakeDjenEntry } from "@flyee/courts/fake";
import { DjenRateLimitedError, DjenUnavailableError, DjenWindowTooLargeError } from "@flyee/courts/providers/djen";
import type { DjenClient } from "@flyee/courts/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const CNJ = "10002868420998260100";
const HELD = { readId: "read-1", claim: 1, cnj: CNJ };
const LAWYER = { uf: "SP", number: "123456" };

/** What the court published of the lawsuit, and of another one. Every number here is invented. */
const PUBLISHED: FakeDjenEntry[] = [
  {
    hash: "hist0002abcdefghijklmnopqrstuv",
    court: "TJSP",
    cnj: CNJ,
    availableOn: "2099-02-10",
    kind: "Intimação",
    text: "Sentença.",
    link: null,
    lawyers: [LAWYER],
  },
  {
    hash: "hist0001abcdefghijklmnopqrstuv",
    court: "TJSP",
    cnj: CNJ,
    availableOn: "2099-01-10",
    kind: "Intimação",
    text: "Audiência.",
    link: null,
    lawyers: [],
  },
  {
    hash: "hist0099abcdefghijklmnopqrstuv",
    court: "TJSP",
    cnj: "30002865020998260100",
    availableOn: "2099-01-11",
    kind: "Intimação",
    text: "Outro.",
    link: null,
    lawyers: [LAWYER],
  },
];

/** A database that answers `record_proceeding_history` as told and remembers each call. */
function database(answer: (outcome: string) => string = (outcome) => outcome) {
  const calls: { outcome: string; items: { hash: string }[]; code: string | null }[] = [];
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("record_proceeding_history");
      expect(args.target_read).toBe(HELD.readId);
      expect(args.target_claim).toBe(HELD.claim);
      const outcome = String(args.target_outcome);
      calls.push({
        outcome,
        items: args.target_items as { hash: string }[],
        code: (args.target_code as string) ?? null,
      });
      return { data: { ok: true, code: answer(outcome) }, error: null };
    },
  } as unknown as SupabaseClient;
  return { service, calls };
}

const failing = (error: Error): DjenClient => {
  const fake = new FakeDjenClient();
  return {
    listByOab: (input) => fake.listByOab(input),
    listByProcess: async () => {
      throw error;
    },
    certificateUrl: (hash) => fake.certificateUrl(hash),
    probe: (input) => fake.probe(input),
  };
};

describe("ONE's reading of a lawsuit's history in the DJEN (0286)", () => {
  it("hands the database every communication of the lawsuit, oldest first, and says it is read", async () => {
    const { service, calls } = database();
    const client = new FakeDjenClient(PUBLISHED);
    expect(await readClaimedHistory(service, client, HELD)).toBe("done");
    expect(client.calls.listByProcess).toBe(1);
    expect(calls.map((call) => [call.outcome, call.items.map((item) => item.hash)])).toEqual([
      ["done", ["hist0001abcdefghijklmnopqrstuv", "hist0002abcdefghijklmnopqrstuv"]],
    ]);
  });

  it("says a lawsuit with nothing published is read, with nothing in it", async () => {
    const { service, calls } = database();
    expect(await readClaimedHistory(service, new FakeDjenClient([]), HELD)).toBe("done");
    expect(calls).toEqual([{ outcome: "done", items: [], code: null }]);
  });

  it("tries again later when the DJEN limits the calls or does not answer, and gives up a history it cannot read", async () => {
    for (const [error, outcome, code] of [
      [new DjenRateLimitedError(), "retry", "djen_rate_limited"],
      [new DjenUnavailableError(503), "retry", "djen_unavailable"],
      [new DjenWindowTooLargeError(), "failed", "djen_too_many"],
    ] as const) {
      const { service, calls } = database();
      expect(await readClaimedHistory(service, failing(error), HELD)).toBe(outcome);
      expect(calls).toEqual([{ outcome, items: [], code }]);
    }
  });

  it("stops when the claim is no longer its own", async () => {
    const { service } = database(() => "not_working");
    expect(await readClaimedHistory(service, new FakeDjenClient(PUBLISHED), HELD)).toBe("not_held");
  });
});
