// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FakeDjenClient, type FakeDjenEntry } from "@flyee/courts/fake";
import {
  DjenInvalidQueryError,
  DjenRateLimitedError,
  DjenUnavailableError,
  DjenWindowTooLargeError,
} from "@flyee/courts/providers/djen";
import type { DjenClient, DjenCommunication, OabRegistration } from "@flyee/courts/types";

/**
 * The reading of the DJEN and the shadow triage, with the app's own workers
 * against a real database: a registration is claimed, read a few days at a
 * time through the same interface the public API is read by, and what was
 * read is kept even when the reading stops halfway; then the AI says what a
 * publication is, beside it.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`: an embedded PostgreSQL with every migration
 * applied, its address in `ONE_EMBEDDED_DB_URL`); otherwise it is skipped.
 * What stands in is the transport (a client that calls the same functions
 * with the same named arguments PostgREST would, as the same database
 * roles), the DJEN (the fake of `@flyee/courts`) and the model (the fake
 * provider of `@flyee/ai`).
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

/** A stand-in for the Supabase client, as far as the workers use one: `rpc`. */
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

const ANA = "ad200000-0000-4000-8000-000000000001";
const EVA = "ad200000-0000-4000-8000-000000000002";
const IVO = "ad200000-0000-4000-8000-000000000003";
const LIA = "ad200000-0000-4000-8000-000000000004";
const NEI = "ad200000-0000-4000-8000-000000000005";
const RUI = "ad200000-0000-4000-8000-000000000006";
const FIRM = "bd200000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "bd200000-0000-4000-8000-00000000000b";
const OAB = {
  ana: { id: "cd200000-0000-4000-8000-000000000001", uf: "GO", number: "31313" },
  eva: { id: "cd200000-0000-4000-8000-000000000002", uf: "GO", number: "42424" },
  ivo: { id: "cd200000-0000-4000-8000-000000000003", uf: "GO", number: "53535" },
  lia: { id: "cd200000-0000-4000-8000-000000000004", uf: "GO", number: "64646" },
  nei: { id: "cd200000-0000-4000-8000-000000000005", uf: "GO", number: "75757" },
  // A lawyer of the other firm, registered under Ana's number with a letter: another person.
  rui: { id: "cd200000-0000-4000-8000-000000000006", uf: "GO", number: "31313A" },
};
/** The case number of the firm's one lawsuit, and one that is nobody's. */
const CNJ_OF_THE_FIRM = "50002023920998090051";
const CNJ_OF_NOBODY = "50003037620998090051";

const asAna = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
const asRui = () => clientAs("authenticated", { sub: RUI, role: "authenticated", aal: "aal2" });

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

type Asked = OabRegistration & { since: string; until?: string };

/** A DJEN that remembers what it was asked, and may be told to fail a call. */
function recordingDjen(entries: FakeDjenEntry[], fail?: (asked: Asked, call: number) => Error | null) {
  const fake = new FakeDjenClient(entries);
  const asked: Asked[] = [];
  const client: DjenClient = {
    async listByOab(input): Promise<DjenCommunication[]> {
      asked.push({ ...input });
      const failure = fail?.(input, asked.length);
      if (failure) throw failure;
      return fake.listByOab(input);
    },
    certificateUrl: (hash) => fake.certificateUrl(hash),
  };
  return { client, asked };
}

describe.skipIf(!DB_URL)("the DJEN, read by the worker against the database", () => {
  let today = "";
  let caseId = "";
  const day = (back: number) => {
    const [year, month, date] = today.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, date - back)).toISOString().slice(0, 10);
  };
  const entry = (
    hash: string,
    back: number,
    lawyers: OabRegistration | OabRegistration[],
    extra: Partial<FakeDjenEntry> = {},
  ): FakeDjenEntry => ({
    hash,
    court: "TJGO",
    cnj: CNJ_OF_NOBODY,
    availableOn: day(back),
    kind: "Intimação",
    documentType: "Despacho",
    text: "Manifeste-se a parte autora em cinco dias.",
    link: "https://projudi.tjgo.jus.br/BuscaProcesso",
    lawyers: Array.isArray(lawyers) ? lawyers : [lawyers],
    ...extra,
  });
  const captureOf = async (registration: string) =>
    (
      await sql.unsafe(
        `select id, captured_through::text, captured_at, resume_from::text, last_new, round_new, last_skipped, skipped_at,
                skipped_items, claimed_at, attempts, error, retry_after
         from public.djen_captures where registration_id = $1`,
        [registration],
      )
    )[0];
  const claimOf = async (registration: string) => {
    const { claimDjenCaptures } = await import("@/lib/publications/capture");
    const capture = await captureOf(registration);
    await sql.unsafe(`update public.djen_captures set retry_after = null where id = $1`, [capture.id]);
    const held = await claimDjenCaptures(backend() as never, 1, String(capture.id));
    expect(held).toHaveLength(1);
    return held[0];
  };
  /** The days asked for, as pairs, in the order they were asked. */
  const windows = (asked: Asked[]) => asked.map((one) => [one.since, one.until]);
  const count = async (query: string, params: unknown[]) => Number((await sql.unsafe(query, params))[0].n);

  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "..", "..");
    const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
    const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
    sql = postgres(DB_URL, {
      max: 1,
      prepare: false,
      onnotice: () => {},
      // A day is a day, as PostgREST writes one (YYYY-MM-DD): never a moment in this machine's time zone.
      types: { date: { to: 1082, from: [1082], serialize: (value: string) => value, parse: (value: string) => value } },
    });
    process.env.AI_FAKE_PROVIDER = "1";

    const people = [
      [ANA, "ana", "Ana Souza", FIRM, "owner", "socio"],
      [EVA, "eva", "Eva Dias", FIRM, "member", "advogado"],
      [IVO, "ivo", "Ivo Reis", FIRM, "member", "advogado"],
      [LIA, "lia", "Lia Melo", FIRM, "member", "advogado"],
      // Who answers clients, and is registered at the bar too: read like anybody else of the firm.
      [NEI, "nei", "Nei Prado", FIRM, "member", "atendimento"],
      [RUI, "rui", "Rui Costa", OTHER_FIRM, "owner", "socio"],
    ] as const;
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in (${people.map(([id]) => `'${id}'`).join(", ")});
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ${people
        .map(
          ([id, slug, name]) =>
            `('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${slug}@djen.invalid', '', now(), '{}', '{"display_name":"${name}"}', now(), now())`,
        )
        .join(", ")};
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-djen', '${ANA}'),
        ('${OTHER_FIRM}', 'Costa Advocacia', 'costa-djen', '${RUI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ${people
        .map(([id, , , firm, role, work]) => `('${firm}', '${id}', '${role}', '${work}')`)
        .join(", ")};
      insert into public.oab_registrations (id, user_id, uf, number, kind) values
        ('${OAB.ana.id}', '${ANA}', '${OAB.ana.uf}', '${OAB.ana.number}', 'principal'),
        ('${OAB.eva.id}', '${EVA}', '${OAB.eva.uf}', '${OAB.eva.number}', 'principal'),
        ('${OAB.ivo.id}', '${IVO}', '${OAB.ivo.uf}', '${OAB.ivo.number}', 'principal'),
        ('${OAB.lia.id}', '${LIA}', '${OAB.lia.uf}', '${OAB.lia.number}', 'principal'),
        ('${OAB.nei.id}', '${NEI}', '${OAB.nei.uf}', '${OAB.nei.number}', 'principal'),
        ('${OAB.rui.id}', '${RUI}', '${OAB.rui.uf}', '${OAB.rui.number}', 'principal');
    `);
    today = String((await sql.unsafe(`select (now() at time zone 'America/Sao_Paulo')::date::text as today`))[0].today);

    const opened = await call(asAna(), "create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: null,
      target_client: { full_name: "Maria Teste", birth_date: "1985-04-02" },
    });
    caseId = String(opened.case_id);
    const lawsuit = await call(asAna(), "save_proceeding", {
      target_case: caseId,
      target_proceeding: null,
      target_fields: {
        kind: "juizado",
        court: "TJGO",
        system: "projudi",
        status: "filed",
        cnj: CNJ_OF_THE_FIRM,
        filed_at: day(40),
      },
      target_parties: [String(opened.party_id)],
    });
    expect(lawsuit.code).toBe("saved");
    // Who is read is recomputed from the data: every registration held by somebody of a firm has its reading.
    const { prepareDjenCaptures } = await import("@/lib/publications/capture");
    await prepareDjenCaptures(backend() as never);
  }, 120_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_PROVIDER;
    await sql?.unsafe(`update public.ai_tasks set is_active = true where slug = 'publicacao.triagem'`);
    await sql?.end({ timeout: 5 });
  });

  it("reads every registration held by somebody of a firm, whatever they do in it", async () => {
    const read = await sql.unsafe(
      `select c.org_id, c.uf || c.number as registration, c.active from public.djen_captures c
       where c.org_id in ($1, $2) order by c.org_id, c.number`,
      [FIRM, OTHER_FIRM],
    );
    expect(read.map((row) => [row.org_id, row.registration, row.active])).toEqual([
      [FIRM, "GO31313", true],
      [FIRM, "GO42424", true],
      [FIRM, "GO53535", true],
      [FIRM, "GO64646", true],
      [FIRM, "GO75757", true],
      [OTHER_FIRM, "GO31313A", true],
    ]);
  });

  it("reads thirty days back to today a few days at a time, and keeps each communication once", async () => {
    const { captureClaimed } = await import("@/lib/publications/capture");
    const djen = recordingDjen([
      // A court's text may be a whole page and very long: it goes in a call of its own, is kept up to the
      // setting's length, and a list reads its start and its end as plain text.
      entry("djenlonga0000001abcdefghijklm", 20, OAB.ana, {
        text: `<html><head><style>p { margin: 0 }</style></head><body><p>Vistos &amp; examinados.</p>${"<p>Fundamenta&ccedil;&atilde;o.</p>".repeat(9_000)}<p>Julgo procedente o pedido.</p></body></html>`,
      }),
      entry("djenlonga0000002abcdefghijklm", 20, OAB.ana, { text: "Acórdão. ".repeat(30_000) }),
      entry("djendocaso000001abcdefghijklm", 9, OAB.ana, { cnj: CNJ_OF_THE_FIRM }),
      // Addressed to Ana and to the lawyer of the other firm whose number is hers with a letter.
      entry("djenrecente00001abcdefghijklm", 1, [OAB.ana, OAB.rui]),
      entry("djendehoje000001abcdefghijklm", 0, OAB.ana),
      // Not in the shape of a communication: left out by the database, and counted.
      entry("curto", 2, OAB.ana),
      // Of the other firm's lawyer alone, and of a lawyer of nobody's firm: never Ana's.
      entry("djendorui0000001abcdefghijklm", 3, OAB.rui),
      entry("djendeoutro00001abcdefghijklm", 3, { uf: "GO", number: "99991" }),
    ]);

    expect(await captureClaimed(backend() as never, djen.client, await claimOf(OAB.ana.id))).toBe("done");

    // Thirty days back and today, five days a search, each day asked once.
    expect(windows(djen.asked)).toEqual([
      [day(30), day(26)],
      [day(25), day(21)],
      [day(20), day(16)],
      [day(15), day(11)],
      [day(10), day(6)],
      [day(5), day(1)],
      [day(0), day(0)],
    ]);
    expect(djen.asked.every((one) => one.uf === "GO" && one.number === OAB.ana.number)).toBe(true);

    const kept = await sql.unsafe(
      `select hash, char_length(body) as length, truncated, head, tail, case_id, document_type, lawyer_ids
       from public.publications where org_id = $1 order by available_on, hash`,
      [FIRM],
    );
    expect(kept.map((row) => row.hash)).toEqual([
      "djenlonga0000001abcdefghijklm",
      "djenlonga0000002abcdefghijklm",
      "djendocaso000001abcdefghijklm",
      "djenrecente00001abcdefghijklm",
      "djendehoje000001abcdefghijklm",
    ]);
    expect(kept[0]).toMatchObject({ length: 100_000, truncated: true });
    // The start and the end are the publication's own words: no mark of a page, no style, no named character.
    expect(String(kept[0].head).startsWith("Vistos & examinados. Fundamentação. Fundamentação.")).toBe(true);
    expect(String(kept[0].tail).endsWith("Fundamentação. Julgo procedente o pedido.")).toBe(true);
    expect(kept[2]).toMatchObject({ case_id: caseId, truncated: false, tail: null });
    expect(kept[2].head).toBe("Manifeste-se a parte autora em cinco dias.");
    expect(kept[3].case_id).toBeNull();
    expect(kept.every((row) => row.document_type === "Despacho")).toBe(true);
    expect(kept.every((row) => JSON.stringify(row.lawyer_ids) === JSON.stringify([ANA]))).toBe(true);

    const capture = await captureOf(OAB.ana.id);
    expect(capture).toMatchObject({
      captured_through: today,
      resume_from: null,
      last_new: 5,
      round_new: 0,
      // What could not be kept is counted beside the reading, with its moment.
      last_skipped: 1,
      claimed_at: null,
      attempts: 0,
      error: null,
    });
    expect(capture.captured_at).not.toBeNull();
    expect(capture.skipped_at).not.toBeNull();
    // And kept by what tells it apart: its hash was no hash, so its court and its day are what there is.
    expect(capture.skipped_items).toEqual([{ court: "TJGO", day: day(2) }]);
    expect(
      await count(
        `select count(*)::int as n from public.case_events where case_id = $1 and kind = 'publication_captured'`,
        [caseId],
      ),
    ).toBe(1);
  });

  it("keeps a firm's reading apart from another's, also for the same number with a letter", async () => {
    const { captureClaimed } = await import("@/lib/publications/capture");
    const djen = recordingDjen([
      entry("djenrecente00001abcdefghijklm", 1, [OAB.ana, OAB.rui]),
      entry("djendorui0000001abcdefghijklm", 3, OAB.rui, { cnj: CNJ_OF_THE_FIRM }),
      entry("djendaana0000009abcdefghijklm", 3, OAB.ana),
    ]);
    expect(await captureClaimed(backend() as never, djen.client, await claimOf(OAB.rui.id))).toBe("done");
    // Asked for by the number with its letter.
    expect(djen.asked.every((one) => one.number === "31313A")).toBe(true);

    const theirs = await sql.unsafe(
      `select hash, case_id, proceeding_id, lawyer_ids from public.publications where org_id = $1 order by hash`,
      [OTHER_FIRM],
    );
    expect(theirs.map((row) => row.hash)).toEqual(["djendorui0000001abcdefghijklm", "djenrecente00001abcdefghijklm"]);
    // The case number is of a lawsuit of the other firm: here it is of nobody's.
    expect(theirs.every((row) => row.case_id === null && row.proceeding_id === null)).toBe(true);
    expect(theirs.every((row) => JSON.stringify(row.lawyer_ids) === JSON.stringify([RUI]))).toBe(true);
    // And nothing of it reached the first firm, which read the same communication for its own lawyer.
    expect(await count(`select count(*)::int as n from public.publications where org_id = $1`, [FIRM])).toBe(5);
    expect((await call(asRui(), "firm_today", { target_org: OTHER_FIRM })).publications_new).toBe(2);
  });

  it("reads again from a few days back, and writes nothing twice", async () => {
    const { captureClaimed } = await import("@/lib/publications/capture");
    const djen = recordingDjen([
      entry("djenrecente00001abcdefghijklm", 1, OAB.ana),
      // The court took it back since the first reading, and said why.
      entry("djendehoje000001abcdefghijklm", 0, OAB.ana, {
        active: false,
        cancelReason: "Publicada em <b>duplicidade</b>.",
      }),
    ]);
    await sql.unsafe(
      `update public.djen_captures set captured_at = now() - interval '1 day' where registration_id = $1`,
      [OAB.ana.id],
    );

    expect(await captureClaimed(backend() as never, djen.client, await claimOf(OAB.ana.id))).toBe("done");

    expect(windows(djen.asked)).toEqual([[day(3), day(0)]]);
    const cancelled = await sql.unsafe(
      `select active, cancel_reason, body, cancelled_at from public.publications where org_id = $1 and hash = 'djendehoje000001abcdefghijklm'`,
      [FIRM],
    );
    expect(cancelled[0]).toMatchObject({
      active: false,
      cancel_reason: "Publicada em duplicidade.",
      // What the firm first read stays as it read it.
      body: "Manifeste-se a parte autora em cinco dias.",
    });
    expect(cancelled[0].cancelled_at).not.toBeNull();
    expect(await count(`select count(*)::int as n from public.publications where org_id = $1`, [FIRM])).toBe(5);
    // A clean reading does not unsay what an earlier one left out.
    expect(await captureOf(OAB.ana.id)).toMatchObject({ last_new: 0, last_skipped: 1 });
  });

  it("hands the rest to the next turn when its own ends, and goes on from the day it stopped", async () => {
    const { captureClaimed, claimDjenCaptures } = await import("@/lib/publications/capture");
    const djen = recordingDjen([
      entry("djendaeva0000001abcdefghijklm", 28, OAB.eva),
      entry("djendaeva0000002abcdefghijklm", 2, OAB.eva),
    ]);
    // A clock that passes a second each time it is read, and a turn of half a second: one search a turn.
    let clock = 0;
    const turn = { now: () => (clock += 1000), turnMs: 500 };

    expect(await captureClaimed(backend() as never, djen.client, await claimOf(OAB.eva.id), turn)).toBe("paused");
    expect(windows(djen.asked)).toEqual([[day(30), day(26)]]);
    // What was read is kept, and nothing says the registration was read while days remain.
    expect(await captureOf(OAB.eva.id)).toMatchObject({
      resume_from: day(25),
      captured_through: null,
      captured_at: null,
      round_new: 1,
      claimed_at: null,
      attempts: 0,
    });

    // Due again at once, with nobody touching its wait.
    const again = await claimDjenCaptures(backend() as never, 1, String((await captureOf(OAB.eva.id)).id));
    expect(again).toHaveLength(1);
    expect(await captureClaimed(backend() as never, djen.client, again[0])).toBe("done");
    expect(windows(djen.asked).slice(1)).toEqual([
      [day(25), day(21)],
      [day(20), day(16)],
      [day(15), day(11)],
      [day(10), day(6)],
      [day(5), day(1)],
      [day(0), day(0)],
    ]);
    expect(await captureOf(OAB.eva.id)).toMatchObject({ captured_through: today, resume_from: null, last_new: 2 });
  });

  it("stops when the DJEN limits the calls, keeps what it read, and later goes on from there", async () => {
    const { captureClaimed } = await import("@/lib/publications/capture");
    let limited = true;
    const djen = recordingDjen(
      [entry("djendoivo0000001abcdefghijklm", 27, OAB.ivo), entry("djendoivo0000002abcdefghijklm", 4, OAB.ivo)],
      (_asked, number) => (limited && number === 3 ? new DjenRateLimitedError() : null),
    );
    const held = await claimOf(OAB.ivo.id);

    expect(await captureClaimed(backend() as never, djen.client, held)).toBe("retry");
    const stopped = await captureOf(OAB.ivo.id);
    expect(stopped).toMatchObject({
      resume_from: day(20),
      captured_through: null,
      round_new: 1,
      claimed_at: null,
      error: "djen_rate_limited",
      // Days were read before the limit: it was not a try that came to nothing.
      attempts: 1,
    });
    expect(stopped.retry_after).not.toBeNull();
    // A worker that fell behind says nothing under a claim that is over.
    expect(await captureClaimed(backend() as never, djen.client, held)).toBe("not_held");
    expect(djen.asked).toHaveLength(3);

    limited = false;
    expect(await captureClaimed(backend() as never, djen.client, await claimOf(OAB.ivo.id))).toBe("done");
    // The third search is asked again, and the two before it are not.
    expect(windows(djen.asked).slice(3)[0]).toEqual([day(20), day(16)]);
    expect(djen.asked).toHaveLength(3 + 5);
    expect(await captureOf(OAB.ivo.id)).toMatchObject({ captured_through: today, last_new: 2, error: null });
  });

  it("asks for fewer days when a search holds more than it gives, and never takes a part for the whole", async () => {
    const { captureClaimed } = await import("@/lib/publications/capture");
    // A DJEN whose search gives the whole of two days at most.
    const span = (asked: Asked) =>
      Math.round((Date.parse(String(asked.until)) - Date.parse(asked.since)) / 86_400_000) + 1;
    const narrow = recordingDjen([entry("djendalia0000001abcdefghijklm", 12, OAB.lia)], (asked) =>
      span(asked) > 2 ? new DjenWindowTooLargeError() : null,
    );
    expect(await captureClaimed(backend() as never, narrow.client, await claimOf(OAB.lia.id))).toBe("done");
    expect(windows(narrow.asked).slice(0, 4)).toEqual([
      [day(30), day(26)],
      [day(30), day(29)],
      [day(28), day(27)],
      [day(26), day(25)],
    ]);
    expect(await captureOf(OAB.lia.id)).toMatchObject({ captured_through: today, last_new: 1 });

    // One day alone that holds more than a search gives is beyond the public API: said, never skipped.
    await sql.unsafe(
      `update public.djen_captures set captured_at = now() - interval '1 day' where registration_id = $1`,
      [OAB.lia.id],
    );
    const beyond = recordingDjen([], (asked) =>
      asked.since <= day(2) && String(asked.until) >= day(2) ? new DjenWindowTooLargeError() : null,
    );
    expect(await captureClaimed(backend() as never, beyond.client, await claimOf(OAB.lia.id))).toBe("failed");
    const stuck = await captureOf(OAB.lia.id);
    expect(stuck.error).toBe("djen_too_many");
    // The day before it was read; the day it could not read is where the reading stays, and it says so.
    expect(stuck.resume_from).toBe(day(2));
    expect(windows(beyond.asked)).toEqual([
      [day(3), day(0)],
      [day(3), day(2)],
      [day(3), day(3)],
      [day(2), day(2)],
    ]);
  });

  it("says where the reading stopped when the very first day asked is the one it cannot read", async () => {
    const { captureClaimed } = await import("@/lib/publications/capture");
    // Nei's registration was never read: thirty days back, and the first of them is beyond the API.
    const beyond = recordingDjen([], (asked) => (asked.since === day(30) ? new DjenWindowTooLargeError() : null));
    expect(await captureClaimed(backend() as never, beyond.client, await claimOf(OAB.nei.id))).toBe("failed");
    expect(await captureOf(OAB.nei.id)).toMatchObject({
      error: "djen_too_many",
      resume_from: day(30),
      captured_through: null,
    });
  });

  it("asks for one day alone when the DJEN refuses a search, and tries again later when it is out", async () => {
    const { captureClaimed } = await import("@/lib/publications/capture");
    await sql.unsafe(
      `update public.djen_captures set resume_from = null, error = null, attempts = 0 where registration_id = $1`,
      [OAB.nei.id],
    );
    // An API that answers an error to any search of more than one day, as it does to a request it does not like.
    const refuses = recordingDjen([entry("djendonei0000001abcdefghijklm", 29, OAB.nei)], (asked) =>
      asked.since !== asked.until ? new DjenUnavailableError(500) : null,
    );
    expect(await captureClaimed(backend() as never, refuses.client, await claimOf(OAB.nei.id))).toBe("done");
    expect(windows(refuses.asked).slice(0, 3)).toEqual([
      [day(30), day(26)],
      [day(30), day(30)],
      [day(29), day(29)],
    ]);
    expect(await captureOf(OAB.nei.id)).toMatchObject({ captured_through: today, last_new: 1, error: null });

    // Out for every search: one day is tried once, and the try is given up until later.
    await sql.unsafe(
      `update public.djen_captures set captured_at = now() - interval '1 day' where registration_id = $1`,
      [OAB.nei.id],
    );
    const out = recordingDjen([], () => new DjenUnavailableError(500));
    expect(await captureClaimed(backend() as never, out.client, await claimOf(OAB.nei.id))).toBe("retry");
    expect(windows(out.asked)).toEqual([
      [day(3), day(0)],
      [day(3), day(3)],
    ]);
    expect(await captureOf(OAB.nei.id)).toMatchObject({ error: "djen_unavailable", captured_through: today });
    // With no answer at all (the network), nothing says the days were the trouble: no second search.
    const silent = recordingDjen([], () => new DjenUnavailableError(null));
    expect(await captureClaimed(backend() as never, silent.client, await claimOf(OAB.nei.id))).toBe("retry");
    expect(silent.asked).toHaveLength(1);
  });

  it("takes by itself the registration that waits, and fails the round of one the DJEN cannot be asked for", async () => {
    const { captureNext } = await import("@/lib/publications/capture");
    // Every registration of the firm was read a moment ago: nothing is due, and nothing is asked.
    await sql.unsafe(
      `update public.djen_captures
       set captured_at = now(), captured_through = $1::date, resume_from = null, retry_after = null, error = null,
           attempts = 0, requested_at = null, claimed_at = null
       where org_id = $2`,
      [today, FIRM],
    );
    const idle = recordingDjen([]);
    expect(await captureNext(backend() as never, idle.client, FIRM)).toBe("none");
    expect(idle.asked).toHaveLength(0);

    // One is due again. Claimed and read in one piece of work: no claim waits for a worker.
    await sql.unsafe(
      `update public.djen_captures set captured_at = now() - interval '1 day' where registration_id = $1`,
      [OAB.nei.id],
    );
    const refused = recordingDjen([], () => new DjenInvalidQueryError("registration"));
    expect(await captureNext(backend() as never, refused.client, FIRM)).toBe("failed");
    expect(refused.asked).toHaveLength(1);
    expect(refused.asked[0]).toMatchObject({ uf: "GO", number: OAB.nei.number });
    // Never recorded as days that were read: the reading says why it did not happen, and waits for the next round.
    const failed = await captureOf(OAB.nei.id);
    expect(failed).toMatchObject({ error: "djen_invalid_registration", claimed_at: null, captured_through: today });
    expect(failed.retry_after).not.toBeNull();
    expect(await captureNext(backend() as never, refused.client, FIRM)).toBe("none");

    // The home counts the registration whose reading left a communication out, until the days of the setting pass.
    expect((await call(asAna(), "firm_today", { target_org: FIRM })).djen_incomplete).toBe(1);
    await sql.unsafe(
      `update public.djen_captures set skipped_at = now() - interval '8 days' where registration_id = $1`,
      [OAB.ana.id],
    );
    expect((await call(asAna(), "firm_today", { target_org: FIRM })).djen_incomplete).toBe(0);
  });

  it("asks the AI what a publication is, in shadow mode: beside the person's word, changing nothing of it", async () => {
    const { claimPublicationTriage, triageClaimedPublication, triageNext, triageReady } = await import(
      "@/lib/publications/triage-work"
    );
    expect(await triageReady(backend() as never)).toBe(true);
    // A firm that keeps the triage to a person (0104): the AI's answer, however sure, decides nothing.
    await sql.unsafe(
      `insert into public.firm_autonomy (org_id, decision, mode) values ($1, 'publication_triage', 'approval'), ($2, 'publication_triage', 'approval')`,
      [FIRM, OTHER_FIRM],
    );
    const publication = (
      await sql.unsafe(
        `select id from public.publications where org_id = $1 and hash = 'djendocaso000001abcdefghijklm'`,
        [FIRM],
      )
    )[0];

    // The task cannot be run (as when the provider is out or a key is refused): nothing was learned of the
    // publication, so its try is given back, and it waits.
    await sql.unsafe(`update public.ai_tasks set is_active = false where slug = 'publicacao.triagem'`);
    const first = await claimPublicationTriage(backend() as never, 1, String(publication.id));
    expect(first).toHaveLength(1);
    expect(await triageClaimedPublication(backend() as never, first[0])).toBe("released");
    const waiting = (
      await sql.unsafe(
        `select ai_attempts, ai_error, ai_claimed_at, ai_retry_after from public.publications where id = $1`,
        [publication.id],
      )
    )[0];
    expect(waiting).toMatchObject({ ai_attempts: 0, ai_error: "unknown_task", ai_claimed_at: null });
    expect(waiting.ai_retry_after).not.toBeNull();
    expect(await claimPublicationTriage(backend() as never, 1, String(publication.id))).toEqual([]);
    await sql.unsafe(`update public.ai_tasks set is_active = true where slug = 'publicacao.triagem'`);
    await sql.unsafe(`update public.publications set ai_retry_after = null where id = $1`, [publication.id]);

    const held = await claimPublicationTriage(backend() as never, 1, String(publication.id));
    expect(held).toHaveLength(1);
    expect(await triageClaimedPublication(backend() as never, held[0])).toBe("done");
    const shadow = (
      await sql.unsafe(
        `select p.ai_category, p.ai_urgent, p.ai_claimed_at, p.category, r.task, r.status, r.subject_type, r.subject_id,
                (select count(*)::int from public.approvals a where a.run_id = r.id) as approvals
         from public.publications p join public.ai_runs r on r.id = p.ai_run_id where p.id = $1`,
        [publication.id],
      )
    )[0];
    expect(shadow).toMatchObject({
      ai_claimed_at: null,
      // Nobody of the firm said anything yet, and the AI's word is not one.
      category: null,
      task: "publicacao.triagem",
      status: "succeeded",
      subject_type: "publication",
      subject_id: String(publication.id),
      // In shadow mode an answer waits in no queue.
      approvals: 0,
    });
    expect(["prazo", "audiencia", "decisao", "pagamento", "ciencia", "outro"]).toContain(shadow.ai_category);
    // Classified once: the same claim says nothing more, and there is nothing left to claim of it.
    expect(await triageClaimedPublication(backend() as never, held[0])).toBe("not_held");
    expect(await claimPublicationTriage(backend() as never, 1, String(publication.id))).toEqual([]);

    // The run that holds the answer is not the firm's to read: a member finds none of this task.
    const seen = await sql.begin(async (transaction) => {
      await transaction.unsafe("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ANA, role: "authenticated", aal: "aal2" }),
      ]);
      await transaction.unsafe("set local role authenticated");
      return transaction.unsafe(`select count(*)::int as n from public.ai_runs where task = 'publicacao.triagem'`);
    });
    expect(seen[0].n).toBe(0);

    // The sweep takes by itself the one that waits the longest, claimed and classified in one piece of work.
    const unclassified = () =>
      count(
        `select count(*)::int as n from public.publications where ai_category is null and active and org_id in ($1, $2)`,
        [FIRM, OTHER_FIRM],
      );
    const waitingBefore = await unclassified();
    expect(await triageNext(backend() as never)).toBe("done");
    expect(await unclassified()).toBe(waitingBefore - 1);

    // The person's word is theirs, and counts in the home until it is given.
    const before = await call(asAna(), "firm_today", { target_org: FIRM });
    // Ten were kept and still stand (one more was taken back by its court); the AI's word triaged none.
    expect(before.publications_new).toBe(10);
    const said = await call(asAna(), "triage_publication", {
      target_publication: publication.id,
      target_category: "audiencia",
      target_note: null,
    });
    expect(said.code).toBe("saved");
    expect((await call(asAna(), "firm_today", { target_org: FIRM })).publications_new).toBe(9);
  });

  it("has ONE triage what the AI is sure of, and asks the lawyer it was addressed to for their awareness", async () => {
    const { claimPublicationTriage, triageClaimedPublication } = await import("@/lib/publications/triage-work");
    // The firm lets ONE triage again, as by default (0104).
    await sql.unsafe(`delete from public.firm_autonomy where org_id = $1 and decision = 'publication_triage'`, [FIRM]);
    const publication = (
      await sql.unsafe(
        `select id, lawyer_ids from public.publications
         where org_id = $1 and category is null and ai_category is null and active and not truncated
         order by captured_at limit 1`,
        [FIRM],
      )
    )[0];
    expect(publication).toBeDefined();
    const held = await claimPublicationTriage(backend() as never, 1, String(publication.id));
    expect(held).toHaveLength(1);
    // The test model answers the first word of each list: a term, and sure of it.
    const followed: string[] = [];
    expect(
      await triageClaimedPublication(backend() as never, held[0], async (publicationId) => {
        followed.push(publicationId);
      }),
    ).toBe("done");
    const triaged = (
      await sql.unsafe(
        `select category, ai_applied, ack_owed, triaged_by, acked_by from public.publications where id = $1`,
        [publication.id],
      )
    )[0];
    expect(triaged).toMatchObject({
      category: "prazo",
      ai_applied: true,
      ack_owed: true,
      triaged_by: null,
      acked_by: null,
    });
    // What follows a triage ONE made (the reading of the term, the bell, the notices) is asked for at once.
    expect(followed).toEqual([String(publication.id)]);

    // The firm reads what awareness is owed, with who it waits on: the lawyers it was addressed to.
    const owed = await call(asAna(), "firm_publication_acks", { target_org: FIRM });
    const item = (owed.items as Row[]).find((row) => row.publication_id === String(publication.id));
    expect(item).toMatchObject({ category: "prazo", late: false });
    const signers = (
      await sql.unsafe(
        `select coalesce(array_agg(m.user_id::text order by m.user_id), '{}') as ids
         from public.publications p join public.memberships m on m.org_id = p.org_id and m.user_id = any (p.lawyer_ids)
         where p.id = $1 and m.firm_function in ('socio', 'advogado')`,
        [publication.id],
      )
    )[0].ids as string[];
    expect(signers.length).toBeGreaterThan(0);
    expect([...(item?.lawyers as string[])].sort()).toEqual([...signers].sort());

    // Said by who triages: nothing is owed of it any more.
    const acknowledged = await call(asAna(), "acknowledge_publication", { target_publication: publication.id });
    expect(acknowledged.code).toBe("saved");
    const after = (
      await sql.unsafe(`select ack_owed, acked_by, category from public.publications where id = $1`, [publication.id])
    )[0];
    expect(after).toMatchObject({ ack_owed: false, acked_by: ANA, category: "prazo" });
    const left = await call(asAna(), "firm_publication_acks", { target_org: FIRM });
    expect((left.items as Row[]).some((row) => row.publication_id === String(publication.id))).toBe(false);
  });
});
