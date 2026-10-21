#!/usr/bin/env node
/**
 * Applies packages/db/migrations to a throwaway database on an embedded
 * PostgreSQL 17 and runs the pgTAP suite in packages/db/tests — no Docker.
 *
 *   npm run test:db:embedded                     migrate + all tests
 *   npm run test:db:embedded -- --only 0007      tests whose file name contains "0007"
 *   npm run test:db:embedded -- --no-tests       migrate only
 *   npm run test:db:embedded -- --sql file.sql   migrate, then run a SQL file and print its rows
 *   npm run test:db:embedded -- --keep           leave the server running (port 54329)
 *   npm run test:db:embedded -- --then "cmd"     migrate (and test), then run a command with
 *                                                ONE_EMBEDDED_DB_URL set (`npm run test:db:roundtrip`)
 *
 * It is the same protocol as `npm run test:db` (Supabase CLI, needs Docker),
 * against a stand-in for what a Supabase project provides before the first
 * migration (supabase-shim.sql: API roles, auth and storage schemas, JWT
 * helpers). Use the Supabase path when Docker works; this one when it does not.
 *
 * First run: installs `embedded-postgres` into .cache/db-embedded (about
 * 100 MB, git-ignored) and downloads pgTAP from PGXN. Every run recreates the
 * database, so a result never depends on a previous run.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const cache = path.join(root, ".cache", "db-embedded");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const EMBEDDED_VERSION = "17.10.0-beta.17";
const PGTAP_VERSION = "1.3.3";
const migrationsDir = path.resolve(value("--migrations", path.join(root, "packages/db/migrations")));
const testsDir = path.resolve(value("--tests", path.join(root, "packages/db/tests")));
const only = value("--only", null);
const sqlFile = value("--sql", null);
const thenCommand = value("--then", null);
const port = Number(value("--port", "54329"));
const DB = "one_test";

// ---------- One-time setup ----------

function ensureEmbeddedPostgres() {
  const marker = path.join(cache, "node_modules", "embedded-postgres", "package.json");
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.existsSync(path.join(cache, "package.json"))) {
    fs.writeFileSync(path.join(cache, "package.json"), JSON.stringify({ name: "db-embedded-cache", private: true }, null, 2));
  }
  console.log(`Installing embedded-postgres ${EMBEDDED_VERSION} into .cache/db-embedded (first run only)...`);
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--no-audit", "--no-fund", `embedded-postgres@${EMBEDDED_VERSION}`, "postgres@3"],
    { cwd: cache, stdio: "inherit", shell: process.platform === "win32" },
  );
}

function nativeDir() {
  const packageName = {
    win32: "@embedded-postgres/windows-x64",
    darwin: process.arch === "arm64" ? "@embedded-postgres/darwin-arm64" : "@embedded-postgres/darwin-x64",
    linux: process.arch === "arm64" ? "@embedded-postgres/linux-arm64" : "@embedded-postgres/linux-x64",
  }[process.platform];
  if (!packageName) throw new Error(`Unsupported platform ${process.platform}`);
  // The platform package exports no package.json, so it is located on disk.
  const dir = path.join(cache, "node_modules", ...packageName.split("/"), "native");
  if (!fs.existsSync(dir)) throw new Error(`Embedded PostgreSQL binaries not found at ${dir}`);
  return dir;
}

async function ensurePgTap() {
  const extensionDir = path.join(nativeDir(), "share", "extension");
  if (fs.existsSync(path.join(extensionDir, "pgtap.control"))) return;

  console.log(`Downloading pgTAP ${PGTAP_VERSION} from PGXN (first run only)...`);
  const response = await fetch(`https://api.pgxn.org/dist/pgtap/${PGTAP_VERSION}/pgtap-${PGTAP_VERSION}.zip`);
  if (!response.ok) throw new Error(`pgTAP download failed: HTTP ${response.status}`);
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const source = files[`pgtap-${PGTAP_VERSION}/sql/pgtap.sql.in`];
  const control = files[`pgtap-${PGTAP_VERSION}/pgtap.control`];
  if (!source || !control) throw new Error("pgTAP archive does not have the expected layout");

  // The two substitutions the pgTAP Makefile performs for a modern server.
  const sql = strFromU8(source)
    .split("__OS__").join(process.platform)
    .split("__VERSION__").join(PGTAP_VERSION.split(".").slice(0, 2).join("."));
  fs.writeFileSync(path.join(extensionDir, `pgtap--${PGTAP_VERSION}.sql`), sql);
  fs.writeFileSync(path.join(extensionDir, "pgtap.control"), strFromU8(control));
}

ensureEmbeddedPostgres();
await ensurePgTap();

const cacheRequire = createRequire(path.join(cache, "package.json"));
const { default: EmbeddedPostgres } = await import(pathToFileURL(cacheRequire.resolve("embedded-postgres")).href);
const { default: postgres } = await import(pathToFileURL(cacheRequire.resolve("postgres")).href);

// ---------- Run ----------

const dataDir = path.join(cache, "data");
const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--locale=C"],
  onLog: () => {},
  onError: (message) => {
    if (flag("--verbose")) console.error(String(message));
  },
});

const connect = (database) =>
  postgres({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "postgres",
    database,
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 20,
  });

function describeError(error, source) {
  const lines = [error.message];
  if (error.detail) lines.push(`  detail: ${error.detail}`);
  if (error.hint) lines.push(`  hint: ${error.hint}`);
  if (error.where) lines.push(`  where: ${String(error.where).split("\n").slice(0, 4).join(" | ")}`);
  const position = Number(error.position);
  if (source && position > 0) {
    const line = source.slice(0, position).split("\n").length;
    lines.push(`  at line ${line}: ${source.split("\n")[line - 1]?.trim().slice(0, 200)}`);
  }
  return lines.join("\n");
}

let exitCode = 0;
if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) await server.initialise();
await server.start();

try {
  const admin = connect("postgres");
  await admin.unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password 'postgres'; end if;
    end
    $$;
    grant anon, authenticated, service_role to authenticator;
  `);
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.unsafe(`create database ${DB}`);
  await admin.unsafe(`alter database ${DB} set search_path to "$user", public, extensions`);
  await admin.end({ timeout: 5 });

  const sql = connect(DB);
  await sql.unsafe("revoke create on schema public from public");
  await sql.unsafe(fs.readFileSync(path.join(here, "supabase-shim.sql"), "utf8"));

  const migrations = fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort((a, b) => a.localeCompare(b));

  let applied = 0;
  for (const file of migrations) {
    const source = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    try {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(source);
      });
      applied += 1;
      if (flag("--verbose")) console.log(`applied ${file}`);
    } catch (error) {
      console.error(`MIGRATION FAILED ${file}\n${describeError(error, source)}`);
      exitCode = 1;
      break;
    }
  }
  console.log(`Migrations: ${applied}/${migrations.length} applied.`);

  if (exitCode === 0 && sqlFile) {
    const source = fs.readFileSync(path.resolve(sqlFile), "utf8");
    try {
      const results = await sql.unsafe(source);
      const sets = Array.isArray(results[0]) ? results : [results];
      for (const set of sets) if (set.length) console.log(JSON.stringify(set, null, 1));
    } catch (error) {
      console.error(`SQL FILE FAILED\n${describeError(error, source)}`);
      exitCode = 1;
    }
  }

  if (exitCode === 0 && !flag("--no-tests") && fs.existsSync(testsDir)) {
    const files = fs
      .readdirSync(testsDir)
      .filter((name) => name.endsWith(".sql") && (!only || name.includes(only)))
      .sort((a, b) => a.localeCompare(b));
    let total = 0;
    let failedFiles = 0;
    await sql.unsafe("set statement_timeout = '120s'");
    for (const file of files) {
      const source = fs.readFileSync(path.join(testsDir, file), "utf8");
      let results;
      try {
        results = await sql.unsafe(source);
      } catch (error) {
        await sql.unsafe("rollback").catch(() => undefined);
        console.error(`TEST ERROR ${file}\n${describeError(error, source)}`);
        failedFiles += 1;
        continue;
      }
      const rows = results.flatMap((result) => (Array.isArray(result) ? result : [result]));
      const lines = rows
        .flatMap((row) => (row && typeof row === "object" ? Object.values(row).filter((item) => typeof item === "string") : []))
        .flatMap((chunk) => chunk.split("\n"));
      const plan = lines.map((line) => /^1\.\.(\d+)$/u.exec(line)).find(Boolean);
      const assertions = lines.filter((line) => /^(?:not )?ok\s+\d+/u.test(line));
      const failed = assertions.filter((line) => line.startsWith("not ok")).length;
      const planned = plan ? Number(plan[1]) : -1;
      if (!plan || assertions.length !== planned || failed > 0) {
        failedFiles += 1;
        console.error(`FAILED ${file}: ${assertions.length}/${planned} assertions, ${failed} failure(s)`);
        for (const line of lines.filter((l) => l.startsWith("not ok") || l.startsWith("#")).slice(0, 60)) {
          console.error(`  ${line}`);
        }
      } else {
        total += assertions.length;
        console.log(`pgTAP ${file}: ${assertions.length}/${planned} passed.`);
      }
    }
    console.log(`pgTAP: ${total} assertions passed, ${failedFiles} file(s) failing.`);
    if (failedFiles > 0) exitCode = 1;
  }

  // An integration pass against the migrated database: the command finds its
  // address in ONE_EMBEDDED_DB_URL, and the server stops when it ends.
  if (exitCode === 0 && thenCommand) {
    try {
      execFileSync(thenCommand, {
        cwd: root,
        stdio: "inherit",
        shell: true,
        env: { ...process.env, ONE_EMBEDDED_DB_URL: `postgres://postgres:postgres@127.0.0.1:${port}/${DB}` },
      });
    } catch {
      console.error(`COMMAND FAILED ${thenCommand}`);
      exitCode = 1;
    }
  }

  await sql.end({ timeout: 5 });
} catch (error) {
  console.error(`HARNESS ERROR ${error.message}`);
  exitCode = 1;
} finally {
  if (!flag("--keep")) await server.stop();
}
process.exit(exitCode);
