import { createRequire } from "node:module";
import path from "node:path";

import {
  chooseKey,
  compileSelect,
  type EmbeddedFilter,
  FOREIGN_KEYS_SQL,
  type ForeignKey,
  parseSelect,
} from "@/lib/testing/embedded-select";

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

/**
 * The stand-in clients of one connection: `clientAs(role, claims)`. Given a
 * bucket, they carry the storage API too, as far as the app uses it, with
 * the bucket kept in that map.
 */
export function standIn(sql: Sql, options: { bucket?: Map<string, Uint8Array> } = {}) {
  const bucket = options.bucket;
  const storage = bucket
    ? {
        from: () => ({
          async upload(storagePath: string, bytes: Uint8Array) {
            bucket.set(storagePath, new Uint8Array(bytes));
            return { data: { path: storagePath }, error: null };
          },
          async download(storagePath: string) {
            const bytes = bucket.get(storagePath);
            if (!bytes) return { data: null, error: { message: "not found" } };
            return { data: { arrayBuffer: async () => bytes.slice().buffer }, error: null };
          },
          async remove(storagePaths: string[]) {
            for (const storagePath of storagePaths) bucket.delete(storagePath);
            return { data: [], error: null };
          },
          async createSignedUploadUrl(storagePath: string) {
            return {
              data: { path: storagePath, token: `memory:${storagePath}`, signedUrl: `memory://${storagePath}` },
              error: null,
            };
          },
        }),
      }
    : undefined;
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

  const keys = new Map<string, ForeignKey[]>();
  /** The foreign key an embedded resource goes by, read from the catalog once a pair of tables. */
  async function keyOf(parent: string, relation: string, hint: string | null): Promise<ForeignKey> {
    const pair = `${parent}/${relation}`;
    let found = keys.get(pair);
    if (!found) {
      found = (await sql.unsafe(FOREIGN_KEYS_SQL, [parent, relation])) as unknown as ForeignKey[];
      keys.set(pair, found);
    }
    return chooseKey(found, parent, hint);
  }

  const asText = (value: unknown, type: string): string | null => {
    if (value === null || value === undefined) return null;
    // An array as Postgres reads one: each element quoted, so a text with a comma or a space stays one element.
    if (type.endsWith("[]") && Array.isArray(value)) {
      const quoted = value.map((item) =>
        item === null || item === undefined ? "NULL" : `"${String(item).replace(/[\\"]/g, (mark) => "\\" + mark)}"`,
      );
      return `{${quoted.join(",")}}`;
    }
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
      storage,
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
      /** What the session is, as the app reads it: the level of its second factor, from its claims. */
      auth: {
        mfa: {
          async getAuthenticatorAssuranceLevel() {
            const level = claims.aal === "aal2" ? "aal2" : "aal1";
            return { data: { currentLevel: level, nextLevel: level }, error: null };
          },
        },
      },
      from(table: string) {
        let columns = "*";
        const orders: string[] = [];
        let limiting = "";
        let offsetting = "";
        // `select("id", { count: "exact", head: true })`: the count of the rows, and no row.
        let counting = false;
        // Each clause of the table's own columns with its values, one "?" a value; and the ones on an embedded
        // resource ("ai_runs.subject_id"), which filter that resource.
        const filters: { clause: string; values: string[] }[] = [];
        const embedded: EmbeddedFilter[] = [];
        const run = async () => {
          const values: string[] = [];
          let projection = columns;
          const conditions: string[] = [];
          if (/[()!:]/.test(columns)) {
            const compiled = await compileSelect({
              table,
              nodes: parseSelect(columns),
              filters: embedded,
              keyOf,
              values,
            });
            projection = compiled.projection;
            conditions.push(...compiled.conditions);
          }
          for (const item of filters) {
            conditions.push(
              item.values.reduce((clause, value) => {
                values.push(value);
                return clause.replace("?", `$${values.length}`);
              }, item.clause),
            );
          }
          const filtered = `from public.${table} t0${conditions.length ? ` where ${conditions.join(" and ")}` : ""}`;
          const ordering = orders.length ? ` order by ${orders.join(", ")}` : "";
          return as((transaction) =>
            transaction.unsafe(
              counting
                ? `select count(*)::int as count ${filtered}`
                : `select ${projection} ${filtered}${ordering}${limiting}${offsetting}`,
              values,
            ),
          );
        };
        /** PostgREST's `column.operator.value` of an `or`, as far as the app writes it. */
        const orPart = (part: string): { clause: string; values: string[] } => {
          const matched = /^([a-z_]+)\.(eq|neq|is|ilike|like)\.(.+)$/.exec(part.trim());
          if (!matched) throw new Error(`the stand-in reads only column.eq|neq|is|ilike|like.value: ${part}`);
          const [, column, operator, value] = matched;
          if (operator === "is") return { clause: `t0.${column} is ${value === "null" ? "null" : value}`, values: [] };
          // PostgREST's `*` is the pattern's `%` inside an `or` (0225: an acórdão by its document type).
          if (operator === "ilike" || operator === "like") {
            return { clause: `t0.${column}::text ${operator} ?::text`, values: [value.replace(/\*/g, "%")] };
          }
          return { clause: `t0.${column}::text ${operator === "eq" ? "=" : "<>"} ?::text`, values: [value] };
        };
        const builder = {
          /** A filter on a column of the table, or of an embedded resource ("ai_runs.subject_id"). */
          where(column: string, clause: (qualified: string) => string, values: string[] = []) {
            const dot = column.lastIndexOf(".");
            if (dot > 0) {
              const name = column.slice(dot + 1);
              embedded.push({ path: column.slice(0, dot), clause: (alias) => clause(`${alias}.${name}`), values });
            } else filters.push({ clause: clause(`t0.${column}`), values });
            return builder;
          },
          select(wanted: string, options: { count?: "exact"; head?: boolean } = {}) {
            columns = wanted.trim() === "" ? "*" : wanted;
            counting = options.count === "exact" && options.head === true;
            return builder;
          },
          eq(column: string, value: unknown) {
            return builder.where(column, (qualified) => `${qualified}::text = ?::text`, [String(value)]);
          },
          neq(column: string, value: unknown) {
            return builder.where(column, (qualified) => `${qualified}::text <> ?::text`, [String(value)]);
          },
          gt(column: string, value: unknown) {
            return builder.where(column, (qualified) => `${qualified} > ?`, [String(value)]);
          },
          gte(column: string, value: unknown) {
            return builder.where(column, (qualified) => `${qualified} >= ?`, [String(value)]);
          },
          lt(column: string, value: unknown) {
            return builder.where(column, (qualified) => `${qualified} < ?`, [String(value)]);
          },
          lte(column: string, value: unknown) {
            return builder.where(column, (qualified) => `${qualified} <= ?`, [String(value)]);
          },
          like(column: string, value: unknown) {
            return builder.where(column, (qualified) => `${qualified} like ?`, [String(value)]);
          },
          ilike(column: string, value: unknown) {
            return builder.where(column, (qualified) => `${qualified} ilike ?`, [String(value)]);
          },
          in(column: string, values: unknown[]) {
            return builder.where(column, (qualified) => `${qualified}::text = any(string_to_array(?::text, ','))`, [
              values.map(String).join(","),
            ]);
          },
          is(column: string, value: null | boolean) {
            return builder.where(column, (qualified) => `${qualified} is ${value === null ? "null" : String(value)}`);
          },
          not(column: string, operator: string, value: unknown) {
            if (operator === "is") {
              return builder.where(
                column,
                (qualified) => `${qualified} is not ${value === null ? "null" : String(value)}`,
              );
            }
            if (operator === "eq") return builder.neq(column, value);
            throw new Error(`the stand-in reads not(column, "is" | "eq"): ${operator}`);
          },
          filter(column: string, operator: string, value: unknown) {
            switch (operator) {
              case "eq":
                return builder.eq(column, value);
              case "neq":
                return builder.neq(column, value);
              case "gt":
                return builder.gt(column, value);
              case "gte":
                return builder.gte(column, value);
              case "lt":
                return builder.lt(column, value);
              case "lte":
                return builder.lte(column, value);
              default:
                throw new Error(`the stand-in reads filter(column, eq|neq|gt|gte|lt|lte): ${operator}`);
            }
          },
          or(expression: string) {
            const parts = expression.split(",").map(orPart);
            filters.push({
              clause: `(${parts.map((part) => part.clause).join(" or ")})`,
              values: parts.flatMap((part) => part.values),
            });
            return builder;
          },
          order(column: string, options: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string } = {}) {
            // The order of an embedded resource's rows is the stand-in's own; the parent's rows keep theirs.
            if (options.foreignTable || column.includes(".")) return builder;
            const direction = options.ascending === false ? "desc" : "asc";
            const nulls = options.nullsFirst === undefined ? "" : options.nullsFirst ? " nulls first" : " nulls last";
            orders.push(`t0.${column} ${direction}${nulls}`);
            return builder;
          },
          limit(count: number) {
            limiting = ` limit ${Math.max(Number(count) || 0, 0)}`;
            return builder;
          },
          range(from: number, to: number) {
            offsetting = ` offset ${Math.max(Number(from) || 0, 0)}`;
            limiting = ` limit ${Math.max((Number(to) || 0) - (Number(from) || 0) + 1, 0)}`;
            return builder;
          },
          async maybeSingle(): Promise<{ data: Row | null; error: Failure | null }> {
            try {
              return { data: (await run())[0] ?? null, error: null };
            } catch (error) {
              return { data: null, error: { message: String(error) } };
            }
          },
          async single(): Promise<{ data: Row | null; error: Failure | null }> {
            try {
              const rows = await run();
              if (rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "not one row" } };
              return { data: rows[0], error: null };
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
