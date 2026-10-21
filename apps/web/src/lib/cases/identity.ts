import "server-only";

import { type CpfLookup, SerproCpfLookup } from "@flyee/identity";

/**
 * The CPF registry ONE asks, or null when this environment has no credential.
 *
 * The credential is the platform's (ONE contracts the registry), never a
 * firm's: `SERPRO_CONSUMER_KEY` and `SERPRO_CONSUMER_SECRET`, from the Serpro
 * customer area. `SERPRO_ENVIRONMENT=trial` points at the demonstration
 * environment, which answers for the fictitious CPFs of its reference and
 * bills nothing; anything else is production, where every lookup is billed.
 */
let cached: { key: string; lookup: CpfLookup } | null = null;

export function cpfLookup(): CpfLookup | null {
  const consumerKey = (process.env.SERPRO_CONSUMER_KEY ?? "").trim();
  const consumerSecret = (process.env.SERPRO_CONSUMER_SECRET ?? "").trim();
  if (!consumerKey || !consumerSecret) return null;
  const environment = process.env.SERPRO_ENVIRONMENT === "trial" ? "trial" : "production";
  const key = `${consumerKey}:${environment}`;
  // One instance per process keeps the gateway's token between lookups.
  if (!cached || cached.key !== key) {
    cached = { key, lookup: new SerproCpfLookup({ consumerKey, consumerSecret, environment }) };
  }
  return cached.lookup;
}
