import { defineConfig } from "vitest/config";

// The templates are TSX with the automatic JSX runtime (what Next uses when it
// transpiles this package); say so here, since the package has no tsconfig.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
