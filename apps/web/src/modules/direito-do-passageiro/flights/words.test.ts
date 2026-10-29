// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FLIGHT_REFUSALS, flightErrorKey } from "@/modules/direito-do-passageiro/flights/words";
import messages from "@flyee/content/messages/pt-BR.json";

const ROOT = path.resolve(__dirname, "../../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0030_flight_checks.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The body of a function of migration 0030. */
function body(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf("\n$$;", start);
  return MIGRATION.slice(start, end);
}

/** The codes a function answers a person with when it refuses. */
const refusals = (name: string): string[] =>
  [...body(name).matchAll(/'ok', false, 'code', '([a-z_]+)'/g)].map((match) => match[1]);

describe("the words of the check of a leg", () => {
  it("has words for every refusal the database answers a person with, and the list says them all", () => {
    const answered = [...new Set([...refusals("request_flight_recheck"), ...refusals("begin_flight_lookup")])];
    expect(answered.length).toBeGreaterThan(0);
    expect([...answered].sort()).toEqual([...FLIGHT_REFUSALS].sort());
    for (const code of FLIGHT_REFUSALS) {
      expect(flightErrorKey(code), code).not.toBe("flight-error-failed");
    }
  });

  it("says each code with words of the catalog, and anything else as a failure", () => {
    for (const code of [
      ...FLIGHT_REFUSALS,
      "lookup_not_configured",
      "lookup_key_refused",
      "lookup_refused",
      "lookup_unavailable",
      "flight_changed",
      "case_not_found",
      "not_allowed_in_support_session",
      "backend_not_configured",
      "anything else",
    ]) {
      expect(product[flightErrorKey(code)], code).toBeTruthy();
    }
    expect(flightErrorKey("anything else")).toBe("flight-error-failed");
  });
});
