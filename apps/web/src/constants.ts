/**
 * ONE speaks Brazilian Portuguese only (docs/ONE-PLANO-DESENVOLVIMENTO.md,
 * M0). It stays a list, and every per-language table stays a `Record` over
 * `LocaleOption`, so a second language is added here and the compiler names
 * each place that has to learn it.
 */
export const LOCALES = ["pt-BR"] as const;
export type LocaleOption = (typeof LOCALES)[number];

/**
 * A single locked palette (packages/design-tokens/css/blue.css), provisional
 * for ONE by the decision of 2026-10-08, until the official ONE palette is
 * written as tokens. The theme provider applies only a class listed here,
 * whatever a browser has stored.
 */
export const THEME_OPTIONS = {
  BLUE: "theme-blue",
} as const;

export type ThemeVariant = (typeof THEME_OPTIONS)[keyof typeof THEME_OPTIONS];

export type ModeVariant = (typeof THEME_MODE_OPTIONS)[number];
export const THEME_MODE_OPTIONS = ["light", "dark", "system"] as const;

const storagePrefix = process.env.NEXT_PUBLIC_STORAGE_PREFIX || "";
export const COOKIE_KEYS = {
  // Opt-out flag for marketing analytics (read server-side to SSR the trackers,
  // and client-side by lib/analytics). Absent = tracking on (opt-out model).
  analyticsOptOut: `${storagePrefix}-analytics-optout`,
  // Coupon code carried by a campaign link (`?cupom=`). Captured by the
  // middleware on ANY page so it survives the sign-up + e-mail confirmation
  // round trip and is still there when she reaches checkout. Not a secret:
  // readable by the client so the billing page can confirm it visually.
  offerCoupon: `${storagePrefix}-cupom`,
  // FIRST-touch campaign attribution (?origem/?onda/utm_*), captured by the
  // middleware and persisted to the workspace at signup. httpOnly: nothing in
  // the browser reads it, unlike the coupon.
  attribution: `${storagePrefix}-atrib`,
  // LAST-touch campaign (origem/utm_*), rewritten by the middleware on every
  // link that carries one. The checkout falls back to it when its own link has
  // none (e.g. an event's button → /planos → sign-up → billing), so a sale is
  // credited to the campaign that brought it. httpOnly; 14 days, the same
  // window the billing webhook accepts (migration 0113).
  lastCampaign: `${storagePrefix}-campanha`,
  // The currency the visitor chose to see and buy in (`?moeda=USD` or the
  // currency switch); without it the language decides (lib/billing-currency.ts).
  // Readable by the client, which shows the active currency.
  currency: `${storagePrefix}-moeda`,
  // The waitlist confirmation token, moved out of the e-mail link by the
  // middleware (a URL is what analytics scripts and Referer headers carry).
  // httpOnly, 15 minutes, consumed by the confirm action.
  leadConfirm: `${storagePrefix}-confirmacao`,
  // The request of an unsubscribe link ("m:<token>" or "l:<token>"), moved out
  // of the address on the way to the page that asks before acting
  // (lib/unsubscribe.ts). httpOnly, 15 minutes, consumed by that page.
  unsubscribe: `${storagePrefix}-descadastro`,
};

export const SESSION_STORAGE_KEYS = {
  /**
   * The address a sign-up just used, handed to /auth/get-verification so it can
   * resend the confirmation without asking her to retype it. sessionStorage,
   * not the URL: an e-mail in a query string ends up in history and server logs.
   */
  signupEmail: `${storagePrefix}-signup-email`,
};

export const LOCAL_STORAGE_KEYS = {
  themeColor: `${storagePrefix}-theme-color`,
  themeMode: `${storagePrefix}-theme-mode`,
  leftMenuType: `${storagePrefix}-left-menu-type`,
  contentType: `${storagePrefix}-content-type`,
  cookieConsent: `${storagePrefix}-cookie-consent`,
};

/**
 * The request header the middleware writes the requested path into. A server
 * layout cannot see the path it is rendering for, and the gate of the logged
 * area (lib/firm/gate.ts) needs it. The middleware always overwrites it, so a
 * value sent by a browser never reaches a layout.
 */
export const REQUEST_PATH_HEADER = "x-one-path";
