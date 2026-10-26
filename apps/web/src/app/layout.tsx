import "@/style/global.css";

import { Metadata } from "next";
import { JetBrains_Mono, Mulish, Urbanist } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";

import { BRAND } from "@/brand";
import BackgroundWrapper from "@/components/layout/containers/background-wrapper";
import InitialLoaderGuard from "@/components/layout/containers/initial-loader-guard";
import SnackbarWrapper from "@/components/layout/containers/snackbar-wrapper";
import LayoutContextProvider from "@/components/layout/layout-context";
import { DEFAULTS } from "@/config";
import { LOCAL_STORAGE_KEYS } from "@/constants";
import { isPublicPageRequest } from "@/lib/public-page-request";
import ThemeProvider from "@/theme/theme-provider";

/**
 * Runs before the first paint. The server renders the palette and mode classes
 * on <html> with the defaults, and the tokens are scoped to those classes, so
 * the page has its colours from the first paint; this script only corrects the
 * mode for a browser that stored another choice (the mode switcher, or
 * "system"). The theme provider keeps the classes in sync afterwards. Before,
 * the provider added them after hydration: until then the page had no palette
 * at all, which is what the loader overlay existed to hide.
 */
const THEME_BOOT = `(function(){try{var d=document.documentElement,m=JSON.parse(localStorage.getItem(${JSON.stringify(
  LOCAL_STORAGE_KEYS.themeMode,
)})||"null")||${JSON.stringify(
  DEFAULTS.themeMode,
)};if(m==="system")m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if((m==="dark"||m==="light")&&!d.classList.contains(m)){d.classList.remove("light","dark");d.classList.add(m)}}catch(e){}})()`;

const mulish = Mulish({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap", // Use 'swap' to ensure text remains visible during font loading
  preload: true,
});

// The heading face, with Mulish for the text: the type of MedChina's
// clinical-source home, chosen for ONE on 2026-10-26. That page sets its
// titles in TT Chocolates, a commercial face no licence of ONE's covers;
// Urbanist (OFL) is the heading face of MedChina's own app, beside the same
// Mulish. A variable font, so one file covers 100 to 900: the display scale
// is ExtraBold and the smaller headings Bold.
const urbanist = Urbanist({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
  preload: true,
});

// Commands, versions and file names: the `font-mono` utility and every
// <code>, <pre> and <kbd>. A variable font, so one file covers 100 to 800.
// Not preloaded: most pages show no mono text above the fold, and an unused
// preload only competes with the fonts that are. No metric-adjusted fallback
// either, because that fallback is Arial: while the file loads, the stack in
// tailwind.config.ts falls to the system mono face and the columns hold.
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

// `font-display` has no face of its own: it falls back to --font-heading
// (Urbanist) through tailwind.config.ts. A separate display face, if one is
// ever chosen, is wired here as --font-display.

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.siteUrl),
  title: {
    default: BRAND.name,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  icons: {
    icon: [
      /**
       * UNCONDITIONAL first, and it has to stay here: Googlebot does not
       * evaluate `prefers-color-scheme`, so a list of only theme-aware icons
       * left it with nothing declared and it fell back to /favicon.ico — 32×32,
       * upscaled into the search result. This one is the 512×512 square master
       * mark, which Google downscales instead.
       */
      { url: BRAND.mark, type: "image/png", sizes: "512x512" },
      { media: "(prefers-color-scheme: dark)", url: BRAND.favicon.dark },
      { media: "(prefers-color-scheme: light)", url: BRAND.favicon.light },
    ],
    // A touch icon is a home-screen tile. It has its own full-bleed file: iOS
    // paints black behind transparent corners and applies its own mask.
    apple: BRAND.appleIcon,
  },
  /**
   * Lets Google show a full-size image preview instead of the default thumbnail
   * cap. Harmless where it does not apply — a `noindex` page overrides this
   * whole field, and robots.txt keeps the app out regardless.
   */
  robots: { "max-image-preview": "large" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  // The loader overlay covers the page until the window load event. A public
  // page arrives complete and styled, so covering it only delays what the
  // visitor can already read (on a slow phone, by several seconds). The
  // signed-in areas keep it: their shell settles after hydration.
  const showLoader = !(await isPublicPageRequest());
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      style={{ "--inner-shadow-opacity": "0.6", "--foreground-opacity": "0.6" } as React.CSSProperties}
      className={`${mulish.variable} ${urbanist.variable} ${jetbrains.variable} ${DEFAULTS.themeColor} ${
        DEFAULTS.themeMode === "dark" ? "dark" : "light"
      }`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {/* The loader CSS is linked directly so the overlay is styled before anything paints. */}
        {showLoader && <link rel="stylesheet" href="/initial-loader.css" />}
        {showLoader && <Script id="loader-script" src="/initial-loader.js" strategy="beforeInteractive" />}
      </head>
      <body className="antialiased">
        {showLoader && (
          <>
            <div id="initial-loader">
              <div className="spinner"></div>
            </div>
            <InitialLoaderGuard />
          </>
        )}
        <AppRouterCacheProvider
          options={{
            key: "css",
            prepend: false,
            enableCssLayer: true,
          }}
        >
          <ThemeProvider>
            <NextIntlClientProvider messages={messages}>
              <LayoutContextProvider>
                <BackgroundWrapper />
                {/*
                  No loading boundary here, and no app/loading.tsx: a boundary
                  above the public pages sends the first bytes before a page
                  can call notFound() or redirect(), so a missing app answered
                  200 with a noindex tag and a moved address a meta refresh.
                  Each signed-in area keeps its own boundary in its layout.
                */}
                <SnackbarWrapper>{children}</SnackbarWrapper>
              </LayoutContextProvider>
            </NextIntlClientProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
