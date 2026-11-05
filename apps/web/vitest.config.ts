import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // The app's tsconfig keeps JSX for Next to compile; a test that draws a component has it compiled here.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    // next-intl's ESM build imports "next/server" without an extension, which
    // Node refuses outside a bundler; processing it through Vite resolves it.
    server: { deps: { inline: ["next-intl"] } },
  },
});
