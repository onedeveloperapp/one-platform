// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FakeDjenClient, type FakeDjenEntry } from "@flyee/courts/fake";
import { DjenRateLimitedError } from "@flyee/courts/providers/djen";
import type { DjenClient } from "@flyee/courts/types";

/**
 * The cases ONE opens from the lawsuits the DJEN shows (migration 0287), with the app's own worker against a real
 * database: what is owed is prepared, each lawsuit is read by its number through the same interface the public API
 * is read by, and the database opens its case from whom its communications are addressed to, or keeps why not.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`: an embedded PostgreSQL with every
 * migration applied, its address in `ONE_EMBEDDED_DB_URL`); otherwise it is skipped. What stands in is the
 * transport (a client that calls the same functions with the same named arguments PostgREST would, as the same
 * database roles) and the DJEN (the fake of `@flyee/courts`).
 *
 * Every person, firm, registration and case number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

const DB_URL = process.env.ONE_EMBEDDED_DB_URL ?? "";

type Row = Record<string, unknown>;
type Sql = {
  unsafe: (query: string, params?: unknown[]) => Promise<Row[]>;
  begin: <T>(run: (transaction: Sql) => Promise<T>) => Promise<T>;
  end: (options?: { timeout?: number }) => Promise<void>;
};

let sql: Sql;

/** The arguments of a function and whether it answers rows, read from the catalog once. */
const signatures = new Map<string, { types: Map<string, string>; rows: boolean }>();
async function signatureOf(name: string) {
  const known = signatures.get(name);
  if (known) return known;
  const found = await sql.unsafe(
    `select a.name, format_type(a.type, null) as type, p.proretset as rows
     from pg_proc p
     cross join lateral unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) as a (name, type)
     where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
    [name],
  );
  const signature = {
    types: new Map(found.map((row) => [String(row.name), String(row.type)])),
    rows: Boolean(found[0]?.rows),
  };
  signatures.set(name, signature);
  return signature;
}

/** A value as the text PostgreSQL casts to the parameter's type: an array as an array literal, an object as JSON. */
function asText(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  if (type.endsWith("[]") && Array.isArray(value)) return `{${value.join(",")}}`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A stand-in for the Supabase client, as far as the worker uses one: `rpc`. */
function clientAs(role: "service_role" | "authenticated", claims: Row) {
  return {
    async rpc(name: string, args: Row = {}) {
      try {
        const signature = await signatureOf(name);
        const keys = Object.keys(args).filter((key) => args[key] !== undefined);
        for (const key of keys) if (!signature.types.has(key)) throw new Error(`${name} has no argument ${key}`);
        const call = keys.map((key, index) => `${key} => $${index + 1}::text::${signature.types.get(key)}`).join(", ");
        const params = keys.map((key) => asText(args[key], signature.types.get(key) as string));
        const found = await sql.begin(async (transaction) => {
          await transaction.unsafe("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
          await transaction.unsafe(`set local role ${role}`);
          return transaction.unsafe(
            signature.rows ? `select * from public.${name}(${call})` : `select public.${name}(${call}) as result`,
            params,
          );
        });
        return { data: signature.rows ? found : (found[0]?.result ?? null), error: null };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        return { data: null, error: { code: failure.code, message: failure.message ?? "failed" } };
      }
    },
  };
}

const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ad287000-0000-4000-8000-000000000001";
const FIRM = "bd287000-0000-4000-8000-00000000000a";
const OAB = { uf: "GO", number: "28801" };
/** A lawsuit against the airline of the test, one where the firm is on the side sued, and one the DJEN limits. */
const AGAINST = "28720016320998090051";
const DEFENSE = "28720024820998090051";
const LIMITED = "28720033320998090051";

describe.skipIf(!DB_URL)("the cases ONE opens from the DJEN, by the worker against the database", () => {
  const published = (cnj: string, hash: string, extra: Partial<FakeDjenEntry>): FakeDjenEntry => ({
    hash,
    court: "TJGO",
    cnj,
    availableOn: "2026-11-20",
    kind: "Intimação",
    documentType: null,
    text: "Intime-se.",
    link: null,
    lawyers: [OAB],
    ...extra,
  });
  const djen = new FakeDjenClient([
    published(AGAINST, "carteira0001abcdefghijklmnopq", {
      parties: [
        { name: "MARIA INVENTADA DA SILVA", side: "active" },
        { name: "COMPANHIA AEREA DE TESTE SA", side: "passive" },
      ],
    }),
    published(AGAINST, "carteira0002abcdefghijklmnopq", {
      parties: [{ name: "Maria Inventada da Silva", side: "active" }],
    }),
    published(DEFENSE, "carteira0003abcdefghijklmnopq", {
      parties: [{ name: "COMPANHIA AEREA DE TESTE SA", side: "passive" }],
    }),
  ]);
  /** The DJEN that limits the calls for the third lawsuit, and answers the rest. */
  const limiting: DjenClient = {
    listByOab: (input) => djen.listByOab(input),
    listByProcess: async (input) => {
      if (input.cnj === LIMITED) throw new DjenRateLimitedError();
      return djen.listByProcess(input);
    },
    certificateUrl: (hash) => djen.certificateUrl(hash),
    probe: (input) => djen.probe(input),
  };

  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "..", "..");
    const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
    const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
    sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@carteira.invalid', '', now(), '{}', '{"display_name":"Ana Carteira"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Carteira Advogados', 'carteira-djen', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.oab_registrations (user_id, uf, number) values ('${ANA}', '${OAB.uf}', '${OAB.number}');
      insert into public.firm_modules (org_id, module_key) values ('${FIRM}', 'direito-do-passageiro') on conflict do nothing;
      insert into public.airlines (iata, name, country, legal_name, court_names) values
        ('ZZ', 'Companhia de Teste', 'BR', 'COMPANHIA AEREA DE TESTE SA', array['COMPANHIA AEREA DE TESTE SA'])
      on conflict (iata) do update set court_names = excluded.court_names, active = true;
      insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, unit, class_name) values
        ('${FIRM}', 'carteira-pub-1', 'TJGO', '${AGAINST}', current_date - 3, 'Intimação',
         'Requerido: COMPANHIA AÉREA DE TESTE SA. Designada audiência.', '1º Juizado Especial Cível de Goiânia',
         'Procedimento do Juizado Especial Cível'),
        ('${FIRM}', 'carteira-pub-2', 'TJGO', '${DEFENSE}', current_date - 2, 'Intimação',
         'COMPANHIA AÉREA DE TESTE SA: intime-se.', '2ª Vara Cível de Goiânia', 'Procedimento Comum Cível'),
        ('${FIRM}', 'carteira-pub-3', 'TJGO', '${LIMITED}', current_date - 1, 'Intimação',
         'COMPANHIA AÉREA DE TESTE SA: manifeste-se.', '3º Juizado Especial Cível de Goiânia',
         'Procedimento do Juizado Especial Cível');
      -- Owed in this order (the oldest is read first), so the lawsuit the DJEN limits comes last.
      insert into public.djen_case_reads (org_id, cnj, created_at) values
        ('${FIRM}', '${AGAINST}', now() - interval '3 minutes'),
        ('${FIRM}', '${DEFENSE}', now() - interval '2 minutes'),
        ('${FIRM}', '${LIMITED}', now() - interval '1 minute');
    `);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(
      `delete from public.organizations where id = '${FIRM}'; delete from auth.users where id = '${ANA}';`,
    );
    await sql.end({ timeout: 5 });
  });

  it("opens the case of a lawsuit against an airline, leaves the one on the side sued, and waits for a DJEN that limits", async () => {
    const { openDjenCases } = await import("@/lib/import/djen-cases-work");
    const outcomes = await openDjenCases(backend() as never, limiting, Date.now() + 60_000, null);
    expect(outcomes.opened).toBe(1);
    expect(outcomes.skipped).toBe(1);

    const [opened] = await sql.unsafe(
      `select c.status, c.module, c.airline_iata, pr.status as lawsuit, pr.kind, pr.created_by_one,
              (select array_agg(p.full_name) from public.case_parties cp join public.people p on p.id = cp.person_id
               where cp.case_id = c.id) as clients,
              (select h.status from public.proceeding_history_reads h where h.proceeding_id = pr.id) as history,
              (select b.kind from public.import_batches b join public.import_rows r on r.batch_id = b.id
               where r.case_id = c.id) as batch
       from public.proceedings pr join public.cases c on c.id = pr.case_id
       where pr.org_id = $1 and pr.cnj = $2`,
      [FIRM, AGAINST],
    );
    expect(opened).toMatchObject({
      status: "filed",
      module: "direito-do-passageiro",
      airline_iata: "ZZ",
      lawsuit: "filed",
      kind: "juizado",
      created_by_one: true,
      clients: ["Maria Inventada da Silva"],
      history: "due",
      batch: "djen",
    });
    const reads = await sql.unsafe(
      `select cnj, status, code, attempts from public.djen_case_reads where org_id = $1 order by cnj`,
      [FIRM],
    );
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cnj: AGAINST, status: "opened" }),
        expect.objectContaining({ cnj: DEFENSE, status: "skipped", code: "firm_on_defense" }),
      ]),
    );
    // The DJEN limited the calls: the round stopped there, and the lawsuit is tried again later.
    const limited = reads.find((row) => row.cnj === LIMITED);
    expect(limited).toMatchObject({ status: "retry", code: "djen_rate_limited", attempts: 1 });
  });

  it("opens nothing twice: a round after it finds nothing new owed", async () => {
    const { openDjenCases } = await import("@/lib/import/djen-cases-work");
    const again = await openDjenCases(backend() as never, djen, Date.now() + 60_000, null);
    expect(again.opened).toBe(0);
    const [count] = await sql.unsafe(`select count(*)::int as n from public.cases where org_id = $1`, [FIRM]);
    expect(count.n).toBe(1);
  });
});
