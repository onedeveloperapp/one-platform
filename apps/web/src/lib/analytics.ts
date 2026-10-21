"use client";

import { COOKIE_KEYS, LOCAL_STORAGE_KEYS } from "@/constants";
import { GA4_ID, META_PIXEL_ID } from "@/lib/tracker-snippets";

/**
 * Marketing analytics — OPT-OUT model.
 *
 * The Meta Pixel + GA4 base scripts are rendered SERVER-SIDE in the marketing
 * layout (`components/consent/marketing-trackers.tsx`) and load by DEFAULT, so
 * the trackers are present in the initial HTML (detectable, and firing for every
 * visitor). A visitor may opt out from the cookie notice, which sets the
 * `analyticsOptOut` cookie — read both server-side (to skip rendering the
 * scripts) and here (to stop emitting events and disable the loaded SDKs).
 *
 * The member area loads the same snippets after the page is interactive, and
 * never on the admin consoles (components/consent/dashboard-trackers.tsx,
 * docs/TRACKING.md). Money-funnel events (sign-up, purchase) go SERVER-side via
 * the Conversions API / Measurement Protocol; the CLI sends only product
 * events to the platform, never to an ad tracker.
 */

/** Any tracker configured — the cookie notice renders only then. */
export const ANALYTICS_ENABLED = Boolean(META_PIXEL_ID || GA4_ID);

/**
 * Meta standard events we fire by name; anything else goes as a custom event
 * (`trackCustom`) so a typo never silently maps to the wrong standard event.
 */
const META_STANDARD_EVENTS = new Set([
  "PageView",
  "ViewContent",
  "Lead",
  "CompleteRegistration",
  "Contact",
  "InitiateCheckout",
  "AddPaymentInfo",
  "StartTrial",
  "Subscribe",
  "Purchase",
]);

type Fbq = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** True once the visitor has opted out (cookie set by the notice). */
export function isAnalyticsOptedOut(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((entry) => entry === `${COOKIE_KEYS.analyticsOptOut}=1`);
}

/**
 * Persists the opt-out for a year (read server-side on the next load to stop
 * rendering the scripts) and disables the ALREADY-loaded SDKs on this page.
 */
export function optOutOfAnalytics(): void {
  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE_KEYS.analyticsOptOut}=1; path=/; max-age=31536000; samesite=lax`;
  }
  // GA4's documented kill-switch for an already-loaded gtag.
  if (GA4_ID && typeof window !== "undefined") {
    (window as unknown as Record<string, boolean>)[`ga-disable-${GA4_ID}`] = true;
  }
  // Meta has no per-page disable; we simply stop emitting (the base pixel only
  // auto-fires its initial PageView, never again on its own).
}

export interface TrackOptions {
  /**
   * Meta deduplicates a browser event against a server one ONLY when both carry
   * the same eventID. Pass the id the server event uses (or will use), so the
   * pair can never double-count.
   */
  eventId?: string;
  /**
   * GA4's name for the event when it differs from Meta's (e.g. `Lead` is
   * `generate_lead` in GA4's recommended vocabulary). Defaults to `event`.
   */
  ga4Name?: string;
}

/** Fire a marketing event on the browser trackers. No-op if opted out. */
export function track(event: string, props?: Record<string, unknown>, options?: TrackOptions): void {
  if (typeof window === "undefined" || isAnalyticsOptedOut()) return;
  if (META_PIXEL_ID && window.fbq) {
    const method = META_STANDARD_EVENTS.has(event) ? "track" : "trackCustom";
    if (options?.eventId) window.fbq(method, event, props, { eventID: options.eventId });
    else window.fbq(method, event, props);
  }
  if (GA4_ID) window.gtag?.("event", options?.ga4Name ?? event, props);
}

/** Fire a PageView on SPA route changes. No-op if opted out. */
export function trackPageView(path: string): void {
  if (typeof window === "undefined" || isAnalyticsOptedOut()) return;
  if (META_PIXEL_ID) window.fbq?.("track", "PageView");
  if (GA4_ID) window.gtag?.("event", "page_view", { page_path: path });
}

/**
 * Bump when the privacy policy changes materially — the notice re-appears.
 * 3 (2026-09-26): the policy now covers people who register for our events
 * (privacy-1/3/4/6/7/8/10), including the optional ad-audience consent.
 * 4 (2026-10-01): the Pixel and GA4 also load in the member area (the privacy
 * policy and the cookie policy, version 2, migration 0022).
 */
export const CONSENT_VERSION = 4;

export interface ConsentState {
  analytics: boolean;
  version: number;
  at: string;
}

/** The visitor's recorded acknowledgement — governs whether the notice shows. */
export function getStoredConsent(): ConsentState | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEYS.cookieConsent);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    // A policy bump invalidates the stored answer — the notice shows again.
    return parsed.version === CONSENT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function storeConsent(analytics: boolean): ConsentState {
  const state: ConsentState = { analytics, version: CONSENT_VERSION, at: new Date().toISOString() };
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.cookieConsent, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode quota etc.) — the choice still applies for this page view.
  }
  return state;
}
