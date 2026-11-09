// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FakeProceedingSource } from "@flyee/courts/fake";
import { AggregatorAuthError } from "@flyee/courts/providers/aggregator-http";

/**
 * The course of a firm's lawsuits, with the app's own worker against a real
 * database: lawsuits are filed as a person files them, the worker claims
 * each reading, reads the lawsuit from its source (a stand-in of Projudi
 * for TJGO's, an aggregator's for the others) and records it; the next
 * reading adds what is new to the case's timeline and to what the firm did
 * not see; then the case screen reads each lawsuit's course.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`: an embedded PostgreSQL with every migration
 * applied, its address in `ONE_EMBEDDED_DB_URL`); otherwise it is skipped.
 * What stands in is the transport (a client that calls the same functions
 * and reads the same tables PostgREST would, as the same database roles) and
 * the sources, as fakes of the same interface.
 *
 * Every person, firm and lawsuit here is invented.
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

function asText(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  if (type.endsWith("[]") && Array.isArray(value)) return `{${value.join(",")}}`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A stand-in for the Supabase client, as far as the check uses one: `rpc`, and plain reads of a table. */
function clientAs(role: "service_role" | "authenticated", claims: Row) {
  const as = async <T>(work: (transaction: Sql) => Promise<T>): Promise<T> =>
    sql.begin(async (transaction) => {
      await transaction.unsafe("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await transaction.unsafe(`set local role ${role}`);
      return work(transaction);
    });
  return {
    async rpc(name: string, args: Row = {}) {
      try {
        const signature = await signatureOf(name);
        const keys = Object.keys(args).filter((key) => args[key] !== undefined);
        for (const key of keys) if (!signature.types.has(key)) throw new Error(`${name} has no argument ${key}`);
        const call = keys.map((key, index) => `${key} => $${index + 1}::text::${signature.types.get(key)}`).join(", ");
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
      const filters: { clause: string; value: string }[] = [];
      const run = () =>
        as((transaction) =>
          transaction.unsafe(
            `select ${columns} from public.${table}${filters.length ? ` where ${filters.map((filter, index) => filter.clause.replace("?", `$${index + 1}`)).join(" and ")}` : ""}${ordering}${limiting}`,
            filters.map((filter) => filter.value),
          ),
        );
      const builder = {
        select(wanted: string) {
          columns = wanted;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ clause: `${column}::text = ?::text`, value: String(value) });
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
        in(column: string, values: unknown[]) {
          filters.push({
            clause: `${column}::text = any(string_to_array(?::text, ','))`,
            value: values.map(String).join(","),
          });
          return builder;
        },
        async maybeSingle() {
          try {
            return { data: (await run())[0] ?? null, error: null };
          } catch (error) {
            return { data: null, error: { message: String(error) } };
          }
        },
        then<A, B>(
          resolve: (value: { data: Row[] | null; error: { message: string } | null }) => A,
          reject?: (reason: unknown) => B,
        ) {
          return run()
            .then(
              (rows) => ({ data: rows, error: null }),
              (error: unknown) => ({ data: null, error: { message: String(error) } }),
            )
            .then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ad500000-0000-4000-8000-000000000001";
const RUI = "ad500000-0000-4000-8000-000000000003";
const FIRM = "bd500000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "bd500000-0000-4000-8000-00000000000b";
const asAna = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
const asRui = () => clientAs("authenticated", { sub: RUI, role: "authenticated", aal: "aal2" });

const movement = (id: string, at: string, title: string) => ({ id, at, title, detail: null, by: null });

describe.skipIf(!DB_URL)("the course of a firm's lawsuits, read from the courts", () => {
  let caseId = "";
  const lawsuits: Record<string, string> = {};
  const tracking = async (lawsuit: string) =>
    (
      await sql.unsafe(
        `select id, status, movements_count, unseen_count, read_at, snapshot, work_error, work_attempts from public.proceeding_tracking where proceeding_id = $1`,
        [lawsuit],
      )
    )[0];

  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "..", "..");
    const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
    const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
    sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });

    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${RUI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@andamento.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${RUI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rui@andamento.invalid', '', now(), '{}', '{"display_name":"Rui Costa"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-andamento-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Costa Advocacia', 'costa-andamento-app', '${RUI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${RUI}', 'owner', 'socio');
    `);
    const opened = await asAna().rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-07-20",
      target_client: { full_name: "Maria Teste" },
    });
    caseId = String((opened.data as Row).case_id);
    const file = async (name: string, fields: Row) => {
      const saved = await asAna().rpc("save_proceeding", {
        target_case: caseId,
        target_proceeding: null,
        target_fields: fields,
      });
      lawsuits[name] = String((saved.data as Row).proceeding_id);
    };
    await file("goias", {
      kind: "juizado",
      court: "TJGO",
      system: "projudi",
      status: "filed",
      cnj: "5000123-60.2099.8.09.0051",
      filed_at: "2026-08-03",
    });
    await file("saoPaulo", {
      kind: "comum",
      court: "TJSP",
      system: "esaj",
      status: "filed",
      cnj: "1000234-88.2099.8.26.0100",
      filed_at: "2026-08-04",
    });
    // The lawsuits other files of this run left in the database are theirs, and the sweep reads across firms:
    // they are taken out of its line, so it reads this file's own.
    await sql.unsafe(
      `update public.proceeding_tracking set next_read_at = null, requested_at = null
       where org_id not in ('${FIRM}', '${OTHER_FIRM}')`,
    );
  }, 120_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("reads each lawsuit from its source, keeps each movement once and tells what is new", async () => {
    const { readNext } = await import("@/lib/courts/tracking-work");
    const projudi = new FakeProceedingSource("projudi", ["809"]);
    projudi.add({
      number: "5000123-60.2099.8.09.0051",
      unit: "Goiânia - 3º Juizado Especial Cível",
      status: "Ativo",
      lawyers: [{ name: "ANA TESTE SOUZA", oab: "12345 N", party: "Polo Ativo", receivesNotices: true }],
      pending: [
        {
          kind: "pendency",
          title: "Intimação",
          status: "Aguardando Decurso de Prazo",
          start: null,
          end: "2026-10-30T02:59:59.000Z",
        },
      ],
      movements: [
        movement("900000001", "2026-08-03T20:36:41.000Z", "Petição Enviada"),
        movement("900000002", "2026-08-03T20:36:42.000Z", "Processo Distribuído"),
      ],
    });
    // No aggregator here: the lawsuit of São Paulo waits, and is never claimed.
    const service = backend();
    expect(await readNext(service as never, { projudi, aggregator: null })).toBe("read");
    expect(await readNext(service as never, { projudi, aggregator: null })).toBe("none");
    const first = await tracking(lawsuits.goias);
    expect(first).toMatchObject({ status: "tracked", movements_count: 2, unseen_count: 0 });
    expect((first.snapshot as Row).vendor).toBe("projudi");
    expect((await tracking(lawsuits.saoPaulo)).status).toBe("waiting");

    // The court moves: one movement more, read at the next reading (the first is set a day back).
    projudi.add({
      number: "5000123-60.2099.8.09.0051",
      unit: "Goiânia - 3º Juizado Especial Cível",
      status: "Ativo",
      movements: [
        movement("900000001", "2026-08-03T20:36:41.000Z", "Petição Enviada"),
        movement("900000002", "2026-08-03T20:36:42.000Z", "Processo Distribuído"),
        movement("900000003", "2026-08-10T18:46:42.000Z", "Decisão -> Outras Decisões"),
      ],
    });
    await sql.unsafe(
      `update public.proceeding_tracking set next_read_at = now(), seen_until = now() - interval '1 day' where proceeding_id = $1`,
      [lawsuits.goias],
    );
    await sql.unsafe(`update public.movements set learned_at = now() - interval '2 days' where proceeding_id = $1`, [
      lawsuits.goias,
    ]);
    expect(await readNext(service as never, { projudi, aggregator: null })).toBe("read");
    expect(await tracking(lawsuits.goias)).toMatchObject({ movements_count: 3, unseen_count: 1 });
    const told = await sql.unsafe(`select data from public.case_events where case_id = $1 and kind = 'court_moved'`, [
      caseId,
    ]);
    expect(told.map((row) => (row.data as Row).count)).toEqual([1]);
  });

  it("reads a person's request first, and stops at an aggregator that refuses its key", async () => {
    const { readNext } = await import("@/lib/courts/tracking-work");
    const refusing = {
      name: "escavador",
      covers: () => true,
      read: async (): Promise<never> => {
        throw new AggregatorAuthError("escavador");
      },
    };
    const asked = await asAna().rpc("request_proceeding_read", { target_proceeding: lawsuits.saoPaulo });
    expect((asked.data as Row).ok).toBe(true);
    const outcome = await readNext(
      backend() as never,
      { projudi: null, aggregator: refusing },
      { requestedOnly: true },
    );
    expect(outcome).toBe("stopped");
    // The platform's key, not the lawsuit: its attempt is given back.
    expect(await tracking(lawsuits.saoPaulo)).toMatchObject({
      status: "waiting",
      work_error: "escavador_key_refused",
      work_attempts: 0,
    });

    // With a key the aggregator answers: the lawsuit is not in its copy yet.
    const empty = new FakeProceedingSource("escavador");
    await sql.unsafe(`update public.proceeding_tracking set next_read_at = now() where proceeding_id = $1`, [
      lawsuits.saoPaulo,
    ]);
    expect(await readNext(backend() as never, { projudi: null, aggregator: empty })).toBe("not_found");
    expect((await tracking(lawsuits.saoPaulo)).status).toBe("not_found");
  });

  it("shows each lawsuit's course on its case, the new marked, until a person says they saw it", async () => {
    const { loadCourseFacts } = await import("@/lib/courts/course-facts");
    const read = await loadCourseFacts(asAna() as never, FIRM, caseId, "America/Sao_Paulo");
    const goias = read.byProceeding[lawsuits.goias];
    expect(goias).toMatchObject({
      status: "tracked",
      source: "projudi",
      unit: "Goiânia - 3º Juizado Especial Cível",
      unseen: 1,
    });
    expect(goias.movements.map((item) => [item.title, item.fresh])).toEqual([
      ["Decisão -> Outras Decisões", true],
      ["Processo Distribuído", false],
      ["Petição Enviada", false],
    ]);
    expect(read.byProceeding[lawsuits.saoPaulo].status).toBe("not_found");

    const seen = await asAna().rpc("acknowledge_proceeding_movements", { target_proceeding: lawsuits.goias });
    expect((seen.data as Row).code).toBe("seen");
    const after = await loadCourseFacts(asAna() as never, FIRM, caseId, null);
    expect(after.byProceeding[lawsuits.goias].unseen).toBe(0);
    expect(after.byProceeding[lawsuits.goias].movements.some((item) => item.fresh)).toBe(false);

    // Another firm reads nothing of it.
    const theirs = await loadCourseFacts(asRui() as never, FIRM, caseId, null);
    expect(Object.keys(theirs.byProceeding)).toEqual([]);
  });

  it("pauses a reading that stops, says on the case when ONE tries again, and calls nobody until then", async () => {
    const { readNext } = await import("@/lib/courts/tracking-work");
    const { loadCourseFacts } = await import("@/lib/courts/course-facts");
    const silent = new FakeProceedingSource("escavador");
    silent.unreachable("1000234-88.2099.8.26.0100");
    // Its last attempt: the source does not answer, and the reading is given up for now.
    const [{ tries }] = await sql.unsafe(
      `select coalesce((value ->> 'max_attempts')::int, 5) as tries from public.platform_settings where key = 'tracking'`,
    );
    await sql.unsafe(
      `update public.proceeding_tracking set next_read_at = now(), work_attempts = $2 where proceeding_id = $1`,
      [lawsuits.saoPaulo, Number(tries) - 1],
    );
    expect(await readNext(backend() as never, { projudi: null, aggregator: silent })).toBe("paused");
    expect(await tracking(lawsuits.saoPaulo)).toMatchObject({ status: "paused" });

    const facts = await loadCourseFacts(asAna() as never, FIRM, caseId, "America/Sao_Paulo");
    expect(facts.byProceeding[lawsuits.saoPaulo]).toMatchObject({ status: "paused", asked: false });
    expect(facts.byProceeding[lawsuits.saoPaulo].retryLabel).toBeTruthy();
    const today = await asAna().rpc("firm_today", { target_org: FIRM });
    expect((today.data as Row).tracking_failed).toBe(0);
    // Before its week nothing reads it.
    expect(await readNext(backend() as never, { projudi: null, aggregator: silent })).toBe("none");

    // Its week past, ONE starts it over, and the source answers: the count starts over.
    await sql.unsafe(
      `update public.proceeding_tracking set retry_at = now() - interval '1 minute' where proceeding_id = $1`,
      [lawsuits.saoPaulo],
    );
    const answering = new FakeProceedingSource("escavador");
    answering.add({
      number: "1000234-88.2099.8.26.0100",
      unit: "São Paulo - 10ª Vara Cível",
      status: "Ativo",
      movements: [movement("sp-1", "2026-08-05T13:00:00.000Z", "Distribuído por sorteio")],
    });
    expect(await readNext(backend() as never, { projudi: null, aggregator: answering })).toBe("read");
    const [after] = await sql.unsafe(
      `select status, retry_rounds, retry_at from public.proceeding_tracking where proceeding_id = $1`,
      [lawsuits.saoPaulo],
    );
    expect(after).toMatchObject({ status: "tracked", retry_rounds: 0, retry_at: null });
  });
});
