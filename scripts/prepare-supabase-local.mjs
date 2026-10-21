import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.resolve(root, "packages", "db", "migrations");
const destination = path.resolve(root, "supabase", "migrations");
if (!source.startsWith(root) || !destination.startsWith(root)) throw new Error("Unsafe migration path");

// No privilege bootstrap: the baseline (0000_init.sql) is written for a
// "secure by default" project and states every grant explicitly, so the local
// image, CI and a new hosted project all end up with the same privilege model.
// packages/db/tests/0012_grants_catalog_scan.test.sql checks it.

await mkdir(destination, { recursive: true });
for (const entry of await readdir(destination, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".sql")) await rm(path.join(destination, entry.name));
}

// The two migration runners disagree about what a "version" is, and the repo
// has to satisfy both.
//
//   * The REMOTE gate (scripts/remote-db-gate.mjs) records the FULL FILENAME in
//     public.schema_migrations. Two files sharing a numeric prefix are simply
//     two versions, so it has always applied them without complaint — and it
//     hard-fails on any recorded version whose file no longer exists, which is
//     what makes renaming an already-applied migration a deploy-breaking act.
//   * The Supabase CLI parses the leading digits as the version and makes it a
//     PRIMARY KEY. A duplicate prefix aborts `supabase start` with
//     "duplicate key value violates unique constraint schema_migrations_pkey",
//     taking local development and CI down with it.
//
// Should parallel work ever produce duplicate prefixes that a hosted project
// has already recorded under their real names, they cannot be renamed. They
// are renumbered HERE instead, in the throwaway copy the CLI reads: canonical
// files keep the names production knows, and the CLI gets the unique, strictly
// increasing versions it requires.
//
// Order is preserved exactly: files are sorted the same way the remote gate
// sorts them, and a version is only ever pushed FORWARD to stay ahead of the
// previous one. Everything up to the first collision keeps its original number.
const files = (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

const renumbered = [];
let previous = -1;
for (const name of files) {
  const match = name.match(/^(\d+)_(.+\.sql)$/u);
  if (!match) {
    await copyFile(path.join(source, name), path.join(destination, name));
    continue;
  }
  const original = Number(match[1]);
  const version = Math.max(original, previous + 1);
  previous = version;
  const localName =
    version === original ? name : `${String(version).padStart(match[1].length, "0")}_${match[2]}`;
  if (localName !== name) renumbered.push(`${name} → ${localName}`);
  await copyFile(path.join(source, name), path.join(destination, localName));
}

if (renumbered.length > 0) {
  console.log(
    `Duplicate migration prefixes detected; renumbered ${renumbered.length} file(s) for the local Supabase CLI only:`,
  );
  for (const line of renumbered) console.log(`  ${line}`);
  console.log(
    "Canonical files in packages/db/migrations are unchanged — production records them by full filename.",
  );
}
