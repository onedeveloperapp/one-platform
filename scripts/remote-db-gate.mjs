import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

const root = process.cwd();
// `--only=0052,0053` tests the files whose names start so; `--keep-going` tests every file and fails at the end.
const only = process.argv
  .slice(2)
  .filter((arg) => arg.startsWith("--only="))
  .flatMap((arg) => arg.slice("--only=".length).split(","))
  .map((prefix) => prefix.trim())
  .filter(Boolean);
const args = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith("--only=")));
const knownArgs = new Set(["--apply", "--test", "--test-only", "--keep-going"]);

for (const arg of args) {
  if (!knownArgs.has(arg)) throw new Error(`Unknown argument: ${arg}`);
}
const keepGoing = args.has("--keep-going");

const shouldApply = args.has("--apply");
const shouldTest = args.has("--test") || args.has("--test-only");
const shouldInspectMigrations = !args.has("--test-only");
// Same precedence as Next.js: apps/web/.env.local wins over apps/web/.env, and
// the FIRST file that defines a key decides it, an empty value included. A
// .env.local that blanks DATABASE_URL therefore disables this gate as well.
const envPaths = process.env.ONE_ENV_FILE
  ? [path.resolve(root, process.env.ONE_ENV_FILE)]
  : [path.resolve(root, "apps/web/.env.local"), path.resolve(root, "apps/web/.env")];
const migrationsPath = path.resolve(root, "packages/db/migrations");
const testsPath = path.resolve(root, "packages/db/tests");

function parseEnvValue(source, key) {
  const line = source
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`${key}=`));

  if (!line) return undefined;
  const value = line.slice(key.length + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

async function getDatabaseUrl() {
  let value = process.env.DATABASE_URL;
  if (value === undefined) {
    for (const envPath of envPaths) {
      const envFile = await readFile(envPath, "utf8").catch(() => null);
      if (envFile === null) continue;
      const fromFile = parseEnvValue(envFile, "DATABASE_URL");
      if (fromFile !== undefined) {
        value = fromFile;
        break;
      }
    }
  }
  if (!value) throw new Error(`DATABASE_URL is not set (checked ${envPaths.join(", ")})`);

  const databaseUrl = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }

  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "host.docker.internal"]);
  if (localHosts.has(databaseUrl.hostname)) {
    throw new Error("The remote database gate refuses local DATABASE_URL targets");
  }

  return value;
}

async function getMigrationFiles() {
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Which migrations the target already holds.
 *
 * Two facts tell four states apart — the history table and the product schema:
 *
 *   neither              a brand-new project. Applying bootstraps the history
 *                        table and the whole baseline goes in as ordinary
 *                        pending migrations; planning just lists them.
 *   both                 the normal case.
 *   history only, EMPTY  a bootstrap that stopped before the first migration
 *                        committed: continue.
 *   anything else        refuse. A product schema without history, or a
 *                        history without schema, is a database this repo did
 *                        not build, and guessing would mean running DDL
 *                        against somebody else's data.
 *
 * A foreign database that happens to have both (the MedChina project this repo
 * was copied from) is stopped one step later: its history names files this
 * repo does not have.
 */
async function readAppliedMigrations(sql) {
  const [state] = await sql`
    select
      to_regclass('public.schema_migrations') is not null as has_history,
      to_regclass('public.organizations') is not null as has_product_schema
  `;

  if (!state.has_history && !state.has_product_schema) {
    if (shouldApply) {
      await sql`
        create table public.schema_migrations (
          version text primary key,
          applied_at timestamptz not null default now()
        )
      `;
      // No policy on purpose: only the owner and the service role read it.
      await sql`alter table public.schema_migrations enable row level security`;
      console.log("Bootstrapped public.schema_migrations on an empty database.");
    }
    return new Set();
  }

  if (!state.has_history) {
    throw new Error("Unknown database: a product schema with no migration history. Refusing to touch it.");
  }

  const rows = await sql`select version from public.schema_migrations order by version`;
  if (!state.has_product_schema && rows.length > 0) {
    throw new Error("Unknown database: a migration history with no product schema. Refusing to touch it.");
  }
  return new Set(rows.map((row) => row.version));
}

async function migrate(databaseUrl) {
  const sql = postgres(databaseUrl, {
    application_name: "one-remote-db-gate",
    connect_timeout: 20,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });

  const files = await getMigrationFiles();

  try {
    if (shouldApply) {
      await sql`select pg_advisory_lock(hashtext('one'), hashtext('schema_migrations'))`;
    }

    const applied = await readAppliedMigrations(sql);
    if (shouldApply) {
      // Supabase grants every new table of public to anon and authenticated by default: the history is the owner's
      // and the service role's alone, so a session may neither read nor write it (RLS on and no policy, and no grant).
      await sql.unsafe(`
        do $$
        declare r text;
        begin
          revoke all on table public.schema_migrations from public;
          foreach r in array array['anon', 'authenticated'] loop
            if exists (select 1 from pg_roles where rolname = r) then
              execute format('revoke all on table public.schema_migrations from %I', r);
            end if;
          end loop;
        end $$;
      `);
    }
    const unknownApplied = [...applied].filter((version) => !files.includes(version));
    if (unknownApplied.length > 0) {
      throw new Error(`Remote migration history contains unknown files: ${unknownApplied.join(", ")}`);
    }

    const pending = files.filter((file) => !applied.has(file));
    console.log(`Remote migrations: ${applied.size} applied, ${pending.length} pending.`);

    if (pending.length === 0) return;

    if (!shouldApply) {
      for (const file of pending) console.log(`  pending ${file}`);
      return;
    }

    for (const file of pending) {
      const migration = await readFile(path.join(migrationsPath, file), "utf8");
      console.log(`Applying ${file}...`);
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`
          insert into public.schema_migrations (version)
          values (${file})
        `;
      });
      console.log(`Applied ${file}.`);
    }
  } finally {
    if (shouldApply) {
      await sql`select pg_advisory_unlock(hashtext('one'), hashtext('schema_migrations'))`.catch(
        () => undefined,
      );
    }
    await sql.end({ timeout: 5 });
  }
}

async function testDatabase(databaseUrl) {
  const sql = postgres(databaseUrl, {
    application_name: "one-remote-pgtap",
    connect_timeout: 20,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const entries = await readdir(testsPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .filter((name) => only.length === 0 || only.some((prefix) => name.startsWith(prefix)))
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) throw new Error("No test file matches --only");

  let total = 0;
  const failed = [];

  try {
    await sql.unsafe("set statement_timeout = '120s'");
    // The tests speak of days in Brasília, as the functions count them: the session says so, whatever the
    // server's own zone (UTC on CI and on Supabase, where a night in Brasília is already the next day).
    await sql.unsafe("set timezone = 'America/Sao_Paulo'");

    for (const file of files) {
      const source = await readFile(path.join(testsPath, file), "utf8");
      let results;

      try {
        results = await sql.unsafe(source);
      } catch (error) {
        await sql.unsafe("rollback").catch(() => undefined);
        if (!keepGoing) throw new Error(`${file} failed: ${error.message}`, { cause: error });
        console.error(`${file} failed: ${error.message}`);
        failed.push(file);
        continue;
      }

      const rows = results.flatMap((result) => (Array.isArray(result) ? result : [result]));
      const tap = rows.flatMap((row) =>
        row && typeof row === "object"
          ? Object.values(row).filter((value) => typeof value === "string")
          : [],
      );
      const plan = tap.map((line) => /^1\.\.(\d+)$/u.exec(line)).find(Boolean);
      const assertions = tap.filter((line) => /^(?:not )?ok\s+\d+/u.test(line));
      const failures = assertions.filter((line) => line.startsWith("not ok"));

      if (!plan) throw new Error(`${file} did not emit a pgTAP plan`);
      const planned = Number(plan[1]);
      if (assertions.length !== planned || failures.length > 0) {
        for (const failure of failures) console.error(`  ${failure}`);
        const message = `${file} emitted ${assertions.length}/${planned} assertions with ${failures.length} failure(s)`;
        if (!keepGoing) throw new Error(message);
        console.error(message);
        failed.push(file);
        continue;
      }

      total += assertions.length;
      console.log(`pgTAP ${file}: ${assertions.length}/${planned} passed.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (failed.length > 0) {
    throw new Error(`Remote pgTAP: ${total} assertions passed, ${failed.length} file(s) failing: ${failed.join(", ")}`);
  }
  console.log(`Remote pgTAP: ${total} assertions passed.`);
}

const databaseUrl = await getDatabaseUrl();

if (shouldInspectMigrations) await migrate(databaseUrl);

if (shouldTest) {
  if (shouldInspectMigrations && !shouldApply) {
    throw new Error("Use --apply --test to migrate and test, or --test-only to test the current schema");
  }
  await testDatabase(databaseUrl);
}
