import { defineConfig } from "drizzle-kit";

// Migrations are hand-written SQL in ./migrations and the schema is pulled
// FROM them (npm run db:schema:pull). This config only serves
// `drizzle-kit studio`; `out` points away from ./migrations so no drizzle-kit
// command can write there.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./.drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Direct (non-pooled) connection string; required for DDL.
    url: process.env.DATABASE_URL!,
  },
});
