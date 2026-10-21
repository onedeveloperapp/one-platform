#!/usr/bin/env node
/**
 * Regenerates the Drizzle mirror (packages/db/src/schema/{schema,relations}.ts)
 * from the migrations, with no Docker and no remote database:
 *
 *   npm run db:schema:pull
 *
 * Applies packages/db/migrations to the embedded server (run.mjs --no-tests),
 * runs `drizzle-kit pull` against it into a temporary folder, fixes the
 * constructs drizzle-kit gets wrong on this schema, and writes the two files.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const cache = path.join(root, ".cache", "db-embedded");
const schemaDir = path.join(root, "packages", "db", "src", "schema");
const port = 54329;

execFileSync(process.execPath, [path.join(here, "run.mjs"), "--no-tests"], { stdio: "inherit" });

const cacheRequire = createRequire(path.join(cache, "package.json"));
const { default: EmbeddedPostgres } = await import(pathToFileURL(cacheRequire.resolve("embedded-postgres")).href);
const server = new EmbeddedPostgres({
  databaseDir: path.join(cache, "data"),
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});

const out = fs.mkdtempSync(path.join(os.tmpdir(), "one-drizzle-"));
const config = path.join(root, "packages", "db", "drizzle.pull.tmp.config.js");
await server.start();
try {
  fs.writeFileSync(
    config,
    `export default ${JSON.stringify({
      dialect: "postgresql",
      out: out.split(path.sep).join("/"),
      schemaFilter: ["public"],
      dbCredentials: { url: `postgres://postgres:postgres@127.0.0.1:${port}/one_test` },
    })};\n`,
  );
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["drizzle-kit", "pull", "--config", path.basename(config)], {
    cwd: path.join(root, "packages", "db"),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
} finally {
  fs.rmSync(config, { force: true });
  await server.stop();
}

const header = [
  "// GENERATED from packages/db/migrations by `npm run db:schema:pull`.",
  "// Regenerate after every migration instead of editing by hand.",
  "",
].join("\n");

let schema = fs.readFileSync(path.join(out, "schema.ts"), "utf8");
let relations = fs.readFileSync(path.join(out, "relations.ts"), "utf8");

// The foreign keys into auth.users need a table to point at, and leads.email
// is citext, which drizzle-kit reports as unknown.
schema = schema.replace("import { pgTable,", "import { customType, pgSchema, pgTable,");
schema = schema.replace(
  'import { sql } from "drizzle-orm"\n',
  [
    'import { sql } from "drizzle-orm"',
    "",
    'const authSchema = pgSchema("auth");',
    "",
    "/** Stub of the Supabase auth table: only what the foreign keys reference. */",
    'export const users = authSchema.table("users", {',
    "\tid: uuid().primaryKey().notNull(),",
    "});",
    "export const usersInAuth = users;",
    "",
    "const citext = customType<{ data: string }>({",
    "\tdataType() {",
    '\t\treturn "citext";',
    "\t},",
    "});",
    "",
  ].join("\n"),
);
schema = schema.split('unknown("email")').join('citext("email")');

// An empty-string default comes out as .default(') and an empty enum array
// default as .default([""]).
schema = schema.split(".default(').").join(".default('').");
schema = schema.split('.array().default([""])').join(".array().default(sql`'{}'`)");

// subscriptions.billing_operation_id <-> billing_operations.subscription_id is
// a cycle TypeScript cannot infer: the mirror drops the subscriptions-side
// foreign key declaration (the SQL baseline still enforces it).
const cycle = schema.indexOf('name: "subscriptions_billing_operation_id_fkey"');
if (cycle !== -1) {
  const blockStart = schema.lastIndexOf("foreignKey({", cycle);
  let end = schema.indexOf("})", cycle) + 2;
  const onDelete = schema.slice(end, end + 40).match(/^\.onDelete\("[a-z ]+"\)/);
  if (onDelete) end += onDelete[0].length;
  if (schema[end] === ",") end += 1;
  schema =
    schema.slice(0, blockStart) +
    "// subscriptions_billing_operation_id_fkey: declared in SQL only (a TypeScript inference cycle with billing_operations).\n\t" +
    schema.slice(end).replace(/^\s*/, "");
}

fs.writeFileSync(path.join(schemaDir, "schema.ts"), header + schema);
fs.writeFileSync(path.join(schemaDir, "relations.ts"), header + relations);
fs.rmSync(out, { recursive: true, force: true });
console.log("Wrote packages/db/src/schema/schema.ts and relations.ts.");
