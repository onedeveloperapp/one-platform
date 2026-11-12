import "server-only";

import { FakeChatwootProvider } from "@flyee/chatwoot/fake";
import { HttpChatwootProvider } from "@flyee/chatwoot/providers/http";
import type { ChatwootFeatures, ChatwootProvider } from "@flyee/chatwoot/types";
import { BRAND } from "@flyee/content";

/**
 * Who speaks for the firms' panel of attendance (migration 0223). The platform's Chatwoot, at `CHATWOOT_URL`, with
 * the Platform App's token (`CHATWOOT_PLATFORM_TOKEN`); on a development machine or a preview with
 * `CHATWOOT_FAKE=1`, a panel in memory, never in production. Without either, nothing is written to any panel and
 * the firm's people answer in ONE's Atendimento alone.
 */

/** The fake kept for the process, on the global object so that every bundle of the server shares it. */
const shared = globalThis as typeof globalThis & { __oneChatwootFake?: FakeChatwootProvider };

export function isChatwootFakeOn(): boolean {
  return process.env.CHATWOOT_FAKE === "1" && process.env.VERCEL_ENV !== "production";
}

/** The panel in memory, when it is the one in use: a test reads and drives it. */
export function chatwootFake(): FakeChatwootProvider | null {
  if (!isChatwootFakeOn()) return null;
  shared.__oneChatwootFake ??= new FakeChatwootProvider();
  return shared.__oneChatwootFake;
}

export function chatwootProvider(): ChatwootProvider | null {
  const fake = chatwootFake();
  if (fake) return fake;
  const url = (process.env.CHATWOOT_URL ?? "").trim().replace(/\/+$/, "");
  const platformToken = (process.env.CHATWOOT_PLATFORM_TOKEN ?? "").trim();
  if (!/^https:\/\//.test(url) || !platformToken) return null;
  // The firms' accounts are shared by every server of the same database: one made from a machine whose site is not
  // public (a development machine) would point its inbox at an address Chatwoot cannot reach, for every server.
  if (!/^https:\/\//.test(BRAND.siteUrl)) return null;
  return new HttpChatwootProvider({ url, platformToken });
}

/** Where the inbox of each firm's account delivers what happens in the panel. */
export const chatwootWebhookUrl = (): string => `${BRAND.siteUrl.replace(/\/+$/, "")}/api/webhooks/chatwoot`;

/**
 * The functions of an account that stay off: the kit's choices for ONE (`packages/atendimento/escolhas.json`,
 * `chatwoot.features_off`; a test keeps the two lists equal). ONE talks to WhatsApp and writes every message, so
 * the panel needs no campaign, automation, help center, other channel or voice recorder of its own. The ones the
 * attendance stands on are always on.
 */
export const CHATWOOT_FEATURES_OFF = [
  "campaigns",
  "automations",
  "help_center",
  "companies",
  "voice_recorder",
  "channel_email",
  "channel_facebook",
  "channel_website",
  "channel_instagram",
  "channel_tiktok",
  "inbound_emails",
] as const;

const ALWAYS_ON = ["api_and_webhooks", "agent_bots", "inbox_management", "agent_management", "labels"] as const;

export function chatwootFeatures(): ChatwootFeatures {
  const features: ChatwootFeatures = {};
  for (const name of CHATWOOT_FEATURES_OFF) features[name] = false;
  for (const name of ALWAYS_ON) features[name] = true;
  return features;
}

/** The panel closes a reply this many hours after the client last wrote, as WhatsApp does. */
export const REPLY_WINDOW_HOURS = 24;

/**
 * What a person of the firm sees of their panel the first time: every conversation, the latest first. ONE's
 * conversations stay pending while ONE answers, and the panel's own first view ("open") would look empty.
 */
export const FIRST_UI_SETTINGS = {
  conversations_filter_by: { status: "all", order_by: "last_activity_at_desc" },
} as const;
