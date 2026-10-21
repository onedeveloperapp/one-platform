import "server-only";

import { randomBytes } from "node:crypto";

import { createServiceClient } from "@flyee/auth/service";
import type { MetaAppConfig } from "@flyee/whatsapp/providers/meta";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the WhatsApp of ONE needs that is not a firm's: the platform's own app
 * at the vendor (environment), the simulator's switch, and the settings an
 * operator changes without a deploy (`platform_settings`, key `whatsapp`).
 * A firm's token is never here: it comes from the vault.
 */

/**
 * The simulator answers in place of the vendor on a machine with no Meta app
 * (`WHATSAPP_SIMULATOR=1`). Production never honours the switch: a message a
 * firm sends there goes to a person.
 */
export function isSimulatorOn(): boolean {
  return process.env.WHATSAPP_SIMULATOR === "1" && process.env.VERCEL_ENV !== "production";
}

/**
 * What the simulator signs its deliveries with. It is drawn when the process
 * starts and never leaves it, so a simulated delivery can only be made from
 * inside the app: nobody outside can sign one for the webhook.
 */
const SIMULATOR_SECRET = randomBytes(32).toString("hex");
export const simulatorSecret = (): string => SIMULATOR_SECRET;

export type MetaPlatform = {
  appId: string;
  appSecret: string;
  /** The Embedded Signup configuration the signup window opens with. */
  signupConfigId: string;
  /** What the vendor repeats when it checks that the webhook address is ours. */
  verifyToken: string;
};

/** The platform's app at Meta, or null while any of its four values is missing. */
export function metaPlatform(): MetaPlatform | null {
  const appId = (process.env.META_APP_ID ?? "").trim();
  const appSecret = (process.env.META_APP_SECRET ?? "").trim();
  const signupConfigId = (process.env.META_SIGNUP_CONFIG_ID ?? "").trim();
  const verifyToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "").trim();
  if (!appId || !appSecret || !signupConfigId || !verifyToken) return null;
  return { appId, appSecret, signupConfigId, verifyToken };
}

export type WhatsAppSettings = {
  /** `v25.0`: a new version of the vendor's API is a setting, not a deploy. */
  graphApiVersion: string;
  serviceWindowHours: number;
};

const DEFAULT_SETTINGS: WhatsAppSettings = { graphApiVersion: "v25.0", serviceWindowHours: 24 };

/** The settings as they are in the database; what is missing or unreadable falls back to what the migration seeded. */
export async function readWhatsAppSettings(service: SupabaseClient): Promise<WhatsAppSettings> {
  const { data } = await service.from("platform_settings").select("value").eq("key", "whatsapp").maybeSingle();
  const value = (data?.value ?? {}) as { graph_api_version?: unknown; service_window_hours?: unknown };
  const version = typeof value.graph_api_version === "string" ? value.graph_api_version.trim() : "";
  const hours = Number(value.service_window_hours);
  return {
    graphApiVersion: /^v\d{1,3}\.\d{1,2}$/.test(version) ? version : DEFAULT_SETTINGS.graphApiVersion,
    serviceWindowHours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SETTINGS.serviceWindowHours,
  };
}

/**
 * What the browser needs to open the vendor's signup window: the platform's
 * app, its signup configuration and the API version. None of it is secret;
 * the app's secret never leaves the server. Null while the app is not
 * configured, or when the settings cannot be read.
 */
export async function signupWindowConfig(): Promise<{ appId: string; configId: string; sdkVersion: string } | null> {
  const platform = metaPlatform();
  if (!platform) return null;
  try {
    // Platform configuration, not a firm's data: the one read a page makes with the backend's client.
    const settings = await readWhatsAppSettings(createServiceClient());
    return { appId: platform.appId, configId: platform.signupConfigId, sdkVersion: settings.graphApiVersion };
  } catch {
    return null;
  }
}

/** The platform's app, in the shape the signup calls take. */
export const metaAppConfig = (platform: MetaPlatform, settings: WhatsAppSettings): MetaAppConfig => ({
  appId: platform.appId,
  appSecret: platform.appSecret,
  apiVersion: settings.graphApiVersion,
});
