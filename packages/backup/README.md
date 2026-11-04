# @flyee/backup

Automatic **logical** database backups for the template.

`runBackup()` discovers every table in the `public` schema at runtime (so a
derived project's tables are included automatically), streams each table's rows
to gzipped **JSONL**, and uploads them to the private `backups` storage bucket
under `<run-id>/<table>.jsonl.gz`. Each run is recorded in `backup_runs`
(migration `0017_backups.sql`) with status, table/row counts, size and duration.

## How it runs

- **Nightly** — the platform's clock runs the sweep `backup` at `03:00 UTC`
  (`apps/web/src/lib/backup-jobs.ts`, listed in `apps/web/src/lib/jobs/registry.ts`).
- **On demand** — the superadmin clicks *Run backup now* in `/admin/backups`,
  which runs the export inline (bounded by the serverless function timeout —
  fine for ONE's data today, not a large production DB).
- **Retention** — after each successful run, runs (rows + archives) older than
  `BACKUP_RETENTION_DAYS` (default 30) are pruned.

## Configuration

| Env | Purpose |
| --- | --- |
| `DATABASE_URL` | Direct Postgres connection the export reads from. |
| `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` | Writes archives to / signs downloads from the private bucket. |
| `BACKUP_RETENTION_DAYS` | Days to keep runs before pruning (default 30). |

Without `DATABASE_URL` or the service key, `runBackup()` returns
`{ ok: false, hint }` and the console shows the hint — a fresh clone never
crashes.

## What is never copied

Every table of `public` is copied, so a table added later is in the backup
without anybody remembering it, except the ones in `src/tables.ts`, each with
its reason: `backup_runs` (the record of the backups) and `connection_secrets`
(the firms' sealed vendor tokens: a restore never needs them, the firm
reconnects its account instead). `npm run test:backup` holds that list.

Each table is compressed as its rows are read, so what a run keeps in memory
is the compressed archive of one table, never the table as text.

## Scope — read this

This is a **data** backup (rows as JSONL), meant for operational visibility and
quick recovery of table contents. It does **not** capture DDL (schema, indexes,
policies, functions), roles, or storage objects. It is **not** a disaster-recovery
solution on its own: keep Supabase's native daily backups / PITR as the real DR
layer. Think of this as a portable, downloadable, self-hosted-in-your-bucket copy
of the data on top of that.
