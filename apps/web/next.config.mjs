import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Metadata always in <head>, for every user agent. By default Next streams
  // it into the <body> for browsers and for Googlebot and keeps it in <head>
  // only for link-preview bots; a canonical or hreflang link outside <head>
  // counts for a search engine only if it renders the page, and audits read
  // the page as having no description. The public pages are rendered whole
  // before the first byte (no loading boundary above them), so this delays
  // nothing.
  htmlLimitedBots: /.*/,
  // Vercel's default build container is 8 GB. This app is large (MUI X Premium,
  // many admin/marketing routes), and parallel static-generation workers
  // collectively exhausted the container (SIGKILL / OOM) after a successful
  // compile. Cap build parallelism to one worker and enable Next's webpack
  // memory optimizations so peak build memory stays under the limit.
  experimental: {
    webpackMemoryOptimizations: true,
    cpus: 1,
  },
  // Type-checking and linting the whole monorepo inside `next build` is the
  // heaviest memory phase and OOM-killed the Vercel build container. Both are
  // already enforced as dedicated CI steps (`npm run typecheck` + lint in
  // .github/workflows/ci.yml), so skipping them here is safe and only removes
  // redundant work from the production build.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  transpilePackages: [
    "@mui/material-nextjs",
    "@flyee/content",
    "@flyee/design-tokens",
    "@flyee/auth",
    "@flyee/db",
    "@flyee/email",
    "@flyee/billing",
    "@flyee/ai",
    "@flyee/jobs",
    "@flyee/audit",
    "@flyee/onboarding",
    "@flyee/backup",
    "@flyee/connectors",
    "@flyee/documents",
    "@flyee/whatsapp",
    "@flyee/rules",
    "@flyee/identity",
    "@flyee/courts",
    "@flyee/flights",
    "@flyee/knowledge",
  ],
  images: {
    formats: ["image/webp", "image/avif"],
    qualities: [90],
  },
};

export default withNextIntl(nextConfig);
