/**
 * The Meta Pixel and GA4 base snippets, written once for the two places that
 * load them (docs/TRACKING.md): rendered on the server on the public site
 * (components/consent/marketing-trackers.tsx) and injected after load in the
 * member area (components/consent/dashboard-trackers.tsx). A second copy is
 * how the two would drift apart.
 *
 * The ids are our own build-time config, never user input, so interpolating
 * them into the inline scripts is safe.
 */
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || null;
export const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID?.trim() || null;

/** The Pixel loader; it fires the first PageView of the page itself. */
export const metaPixelSnippet = (id: string) =>
  `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`;

/** The image beacon for browsers without JavaScript. */
export const metaPixelNoscriptUrl = (id: string) => `https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`;

export const ga4ScriptUrl = (id: string) => `https://www.googletagmanager.com/gtag/js?id=${id}`;

/** gtag setup; `config` sends the first page_view. */
export const ga4Snippet = (id: string) =>
  `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true});`;
