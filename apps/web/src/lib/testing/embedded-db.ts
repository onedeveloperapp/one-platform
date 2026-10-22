import { createRequire } from "node:module";
import path from "node:path";

/**
 * What a test of the app's own code against the embedded database stands on
 * (`npm run test:db:roundtrip`): the connection, and a stand-in for the
 * Supabase client that calls the same functions and reads the same tables
 * PostgREST would, as the same database roles and with the same claims. It
 * is the transport that stands in, never a rule: row-level security and
 * every function run as they are.
 */

export type Row = Record<string, unknown>;
export type Sql = {
  unsafe: (query: string, params?: unknown[]) => Promise<Row[]>;
  begin: <T>(run: (transaction: Sql) => Promise<T>) => Promise<T>;
  end: (options?: { timeout?: number }) => Promise<void>;
};

/** The address of the migrated database, when one is at hand; empty otherwise, and the tests are skipped. */
export const DB_URL = process.env.ONE_EMBEDDED_DB_URL ?? "";

/** One connection to the embedded database, with the driver the runner installed. */
export function connect(): Sql {
  const root = path.resolve(process.cwd(), "..", "..");
  const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
  const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
  return postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });
}

type Failure = { code?: string; message: string };

/** The stand-in clients of one connection: `clientAs(role, claims)`. */
export function standIn(sql: Sql) {
  const signatures = new Map<string, { types: Map<string, string>; rows: boolean }>();
  async function signatureOf(name: string) {
    const known = signatures.get(name);
    if (known) return known;
    const found = await sql.unsafe(
      `select a.name, format_type(a.type, null) as type, p.proretset as rows
       from pg_proc p
       left join lateral unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) as a (name, type) on true
       where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
      [name],
    );
    if (found.length === 0) throw new Error(`no function ${name}`);
    const signature = {
      types: new Map(found.filter((row) => row.name !== null).map((row) => [String(row.name), String(row.type)])),
      rows: Boolean(found[0]?.rows),
    };
    signatures.set(name, signature);
    return signature;
  }

  const asText = (value: unknown, type: string): string | null => {
    if (value === null || value === undefined) return null;
    if (type.endsWith("[]") && Array.isArray(value)) return `{${value.join(",")}}`;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  };

  return function clientAs(role: "service_role" | "authenticated" | "anon", claims: Row) {
    const as = async <T>(work: (transaction: Sql) => Promise<T>): Promise<T> =>
      sql.begin(async (transaction) => {
        await transaction.unsafe("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
        await transaction.unsafe(`set local role ${role}`);
        return work(transaction);
      });
    return {
      async rpc(name: string, args: Row = {}): Promise<{ data: unknown; error: Failure | null }> {
        try {
          const signature = await signatureOf(name);
          const keys = Object.keys(args).filter((key) => args[key] !== undefined);
          for (const key of keys) if (!signature.types.has(key)) throw new Error(`${name} has no argument ${key}`);
          const call = keys
            .map((key, index) => `${key} => $${index + 1}::text::${signature.types.get(key)}`)
            .join(", ");
          const params = keys.map((key) => asText(args[key], signature.types.get(key) as string));
          const found = await as((transaction) =>
            transaction.unsafe(
              signature.rows ? `select * from public.${name}(${call})` : `select public.${name}(${call}) as result`,
              params,
            ),
          );
          return { data: signature.rows ? found : (found[0]?.result ?? null), error: null };
        } catch (error) {
          const failure = error as { code?: string; message?: string };
          return { data: null, error: { code: failure.code, message: failure.message ?? "failed" } };
        }
      },
      from(table: string) {
        let columns = "*";
        let ordering = "";
        let limiting = "";
        // `select("id", { count: "exact", head: true })`: the count of the rows, and no row.
        let counting = false;
        // Each clause with its values, one "?" a value.
        const filters: { clause: string; values: string[] }[] = [];
        const run = () => {
          const values: string[] = [];
          const where = filters.map((filter) =>
            filter.values.reduce((clause, value) => {
              values.push(value);
              return clause.replace("?", `$${values.length}`);
            }, filter.clause),
          );
          const filtered = `from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}`;
          return as((transaction) =>
            transaction.unsafe(
              counting
                ? `select count(*)::int as count ${filtered}`
                : `select ${columns} ${filtered}${ordering}${limiting}`,
              values,
            ),
          );
        };
        const builder = {
          select(wanted: string, options: { count?: "exact"; head?: boolean } = {}) {
            columns = wanted;
            counting = options.count === "exact" && options.head === true;
            return builder;
          },
          eq(column: string, value: unknown) {
            filters.push({ clause: `${column}::text = ?::text`, values: [String(value)] });
            return builder;
          },
          in(column: string, values: unknown[]) {
            filters.push({
              clause: `${column}::text = any(string_to_array(?::text, ','))`,
              values: [values.map(String).join(",")],
            });
            return builder;
          },
          is(column: string, value: null) {
            filters.push({ clause: `${column} is ${value === null ? "null" : "not null"}`, values: [] });
            return builder;
          },
          /** PostgREST's `or`, as far as the app writes it: `column.eq.value`, a comma between each. */
          or(expression: string) {
            const parts = expression.split(",").map((part) => /^([a-z_]+)\.eq\.(.+)$/.exec(part.trim()));
            if (parts.some((part) => part === null))
              throw new Error(`the stand-in reads only column.eq.value: ${expression}`);
            const matched = parts as RegExpExecArray[];
            filters.push({
              clause: `(${matched.map((part) => `${part[1]}::text = ?::text`).join(" or ")})`,
              values: matched.map((part) => part[2]),
            });
            return builder;
          },
          order(column: string, options: { ascending?: boolean } = {}) {
            ordering = ` order by ${column} ${options.ascending === false ? "desc" : "asc"}`;
            return builder;
          },
          limit(count: number) {
            limiting = ` limit ${Math.max(Number(count) || 0, 0)}`;
            return builder;
          },
          async maybeSingle(): Promise<{ data: Row | null; error: Failure | null }> {
            try {
              return { data: (await run())[0] ?? null, error: null };
            } catch (error) {
              return { data: null, error: { message: String(error) } };
            }
          },
          then<A, B>(
            resolve: (value: { data: Row[] | null; count?: number | null; error: Failure | null }) => A,
            reject?: (reason: unknown) => B,
          ) {
            return run()
              .then(
                (rows) =>
                  counting
                    ? { data: null, count: Number(rows[0]?.count ?? 0), error: null }
                    : { data: rows, error: null },
                (error: unknown) => ({ data: null, error: { message: String(error) } }),
              )
              .then(resolve, reject);
          },
        };
        return builder;
      },
    };
  };
}
