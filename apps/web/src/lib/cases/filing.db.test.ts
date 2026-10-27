// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The building of a filing package, with the app's own worker against a real
 * database and real PDFs: a person asks for the package of a lawsuit, the
 * worker orders, names and cuts the documents under the limit of the court's
 * system, and the database keeps only what it may.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`: an embedded PostgreSQL with every migration
 * applied, its address in `ONE_EMBEDDED_DB_URL`); otherwise it is skipped.
 * What stands in is the transport and the bucket: a client that calls the
 * same functions with the same named arguments PostgREST would, as the same
 * database roles, and a bucket kept in memory.
 *
 * Every person, firm and number here is invented.
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

/** The bucket, in memory: what the worker reads and writes through the storage API. */
const bucket = new Map<string, Uint8Array>();
/** When set, the upload of that number from now (1 is the next) fails as a storage that did not answer. */
let failUploadIn = 0;

const storage = {
  from: () => ({
    async upload(storagePath: string, bytes: Uint8Array) {
      if (failUploadIn > 0) {
        failUploadIn -= 1;
        if (failUploadIn === 0) return { data: null, error: { message: "storage did not answer" } };
      }
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
  }),
};

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

/** A stand-in for the Supabase client, as far as the filing code uses one: `rpc` and the bucket. */
function clientAs(role: "service_role" | "authenticated", claims: Row) {
  return {
    storage,
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

const ANA = "ac000000-0000-4000-8000-000000000001";
const FIRM = "bc000000-0000-4000-8000-00000000000a";
/** The limit of the court system in this test: set from the scan itself, so that it takes a little over three parts. */
let limit = 0;

const asAna = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

/** A PDF of text pages: small, and with as many pages as asked. */
async function textPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    pdf.addPage([595.28, 841.89]).drawText(`Pagina ${index + 1}`, { x: 60, y: 760 });
  }
  return pdf.save();
}

/**
 * A PDF of one page that is heavy and holds no picture: lines of text nobody can compress much (the
 * same every time: a counter, not chance), so compressing its images again cannot make it fit.
 */
async function heavyPagePdf(bytes: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  let seed = 20261009;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  for (let written = 0; written < bytes; written += 96) {
    const line = Array.from({ length: 12 }, () => next().toString(16).padStart(8, "0")).join("");
    page.drawText(line, { x: 20, y: 20 + (next() % 800), size: 4 });
  }
  return pdf.save();
}

/** A PDF as a scanner makes one: every page a picture of its own, so the file is heavy and its pages cannot share weight. */
async function scannedPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    const picture = await sharp({
      create: {
        width: 320,
        height: 452,
        channels: 3,
        background: "#808080",
        noise: { type: "gaussian", mean: 128, sigma: 50 },
      },
    })
      .jpeg({ quality: 82 })
      .toBuffer();
    const image = await pdf.embedJpg(picture);
    pdf.addPage([595.28, 841.89]).drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return pdf.save();
}

describe.skipIf(!DB_URL)("a filing package, built by the worker against the database", () => {
  let caseId = "";
  let partyId = "";
  let proceedingId = "";
  const documents: Record<string, string> = {};
  const sizes: Record<string, { bytes: number; pages: number }> = {};

  /** Stores a file of the firm as an upload would (reserved, put in the bucket, measured) and makes it an accepted document. */
  async function addDocument(
    key: string,
    kind: string,
    name: string,
    mime: string,
    bytes: Uint8Array,
    forParty = false,
  ) {
    const { measureFile } = await import("@flyee/documents/measure");
    const reserved = await call(backend(), "reserve_file", {
      target_org: FIRM,
      target_purpose: "upload",
      target_name: name,
      target_mime: mime,
      target_bytes: bytes.byteLength,
    });
    bucket.set(String(reserved.storage_path), bytes);
    const measure = await measureFile(bytes);
    await call(backend(), "confirm_file", {
      target_file: reserved.file_id,
      target_sha256: measure.sha256,
      target_bytes: measure.bytes,
      target_detected_mime: measure.detectedMime,
      target_pages: measure.pages,
    });
    const attached = await call(asAna(), "attach_case_document", {
      target_case: caseId,
      target_file: reserved.file_id,
      target_kind: kind,
      target_party: forParty ? partyId : null,
    });
    expect(attached.code, key).toBe("attached");
    await call(asAna(), "decide_case_document", { target_document: attached.document_id, target_decision: "accepted" });
    documents[key] = String(attached.document_id);
    sizes[key] = { bytes: measure.bytes, pages: measure.pages ?? 0 };
  }

  const ask = async (extra: string[]) =>
    call(asAna(), "request_filing_package", {
      target_proceeding: proceedingId,
      target_petition: documents.petition,
      target_documents: extra.map((key) => documents[key]),
    });

  const itemsOf = (packageId: string) =>
    sql.unsafe(
      `select i.position, i.name, i.part, i.parts, i.bytes, i.pages, i.document_id, f.purpose, f.storage_path
       from public.filing_package_items i join public.files f on f.id = i.file_id
       where i.package_id = $1 order by i.position`,
      [packageId],
    );

  const partsLeft = async () =>
    Number(
      (
        await sql.unsafe(`select count(*)::int as n from public.files where org_id = $1 and purpose = 'filing'`, [FIRM])
      )[0].n,
    );

  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "..", "..");
    const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
    const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
    sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });

    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@filing.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-filing', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
    `);
    // The limit of the court's system is data: a small one here, a little under a third of the scan,
    // so a scan of a few pages has to be cut and every page of it still fits a part.
    const scan = await scannedPdf(7);
    limit = Math.floor(scan.byteLength / 3.2);
    await sql.unsafe(
      `update public.court_systems set max_file_bytes = $1 where court = 'TJGO' and proceeding_kind = 'juizado'`,
      [limit],
    );

    const opened = await call(asAna(), "create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: null,
      target_client: { full_name: "Maria Teste", birth_date: "1985-04-02" },
    });
    caseId = String(opened.case_id);
    partyId = String(opened.party_id);
    const lawsuit = await call(asAna(), "save_proceeding", {
      target_case: caseId,
      target_proceeding: null,
      target_fields: { kind: "juizado", court: "TJGO", comarca: "Goiânia", forum_basis: "domicile", system: "projudi" },
      target_parties: [partyId],
    });
    proceedingId = String(lawsuit.proceeding_id);
    // ONE named the lawsuit's system from the platform's table; the firm approves it before any package (0066).
    const approved = await call(asAna(), "decide_court_system", {
      target_proceeding: proceedingId,
      target_approve: true,
    });
    expect(approved.code).toBe("approved");

    await addDocument("petition", "petition", "inicial.pdf", "application/pdf", await textPdf(6));
    await addDocument("identity", "identity", "rg.pdf", "application/pdf", await textPdf(1), true);
    await addDocument("scan", "evidence", "conversas.pdf", "application/pdf", scan);
    // One page, heavier than the limit even after everything in it was compressed.
    await addDocument("poster", "other", "painel.pdf", "application/pdf", await heavyPagePdf(limit * 6));
    const photo = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#888888" } })
      .jpeg()
      .toBuffer();
    await addDocument("photo", "evidence", "foto.jpg", "image/jpeg", new Uint8Array(photo));
  }, 120_000);

  afterAll(async () => {
    await sql?.unsafe(
      `update public.court_systems set max_file_bytes = 6000000 where court = 'TJGO' and proceeding_kind = 'juizado'`,
    );
    await sql?.end({ timeout: 5 });
  });

  it("orders, names and cuts the documents, and the parts add up to the document", async () => {
    const { buildFilingPackages } = await import("@/lib/cases/filing-work");
    // The scan is heavier than the limit: the test would prove nothing otherwise.
    expect(sizes.scan.bytes).toBeGreaterThan(limit * 3);
    const asked = await ask(["scan", "identity"]);
    expect(asked.code).toBe("requested");

    expect(await buildFilingPackages(backend() as never, 1, String(asked.package_id))).toEqual({ ready: 1 });

    const items = await itemsOf(String(asked.package_id));
    expect(items.slice(0, 2).map((item) => [item.position, item.name, item.purpose])).toEqual([
      [1, "01-peticao-inicial.pdf", "upload"],
      [2, "02-documento-de-identidade-maria-teste.pdf", "upload"],
    ]);
    const parts = items.slice(2);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.map((item) => item.name)).toEqual(
      parts.map((_, index) => `03-prova-parte-${index + 1}-de-${parts.length}.pdf`),
    );
    let pages = 0;
    for (const [index, part] of parts.entries()) {
      expect(part.purpose).toBe("filing");
      expect(part.document_id).toBe(documents.scan);
      expect([part.part, part.parts]).toEqual([index + 1, parts.length]);
      expect(Number(part.bytes)).toBeLessThanOrEqual(limit);
      // What is in the bucket is a PDF that opens, of the size the database says.
      const stored = bucket.get(String(part.storage_path)) as Uint8Array;
      expect(stored.byteLength).toBe(Number(part.bytes));
      pages += (await PDFDocument.load(stored)).getPageCount();
    }
    expect(pages).toBe(sizes.scan.pages);
    expect(await partsLeft()).toBe(parts.length);
  }, 120_000);

  it("names what cannot go and leaves nothing behind", async () => {
    const { buildFilingPackages } = await import("@/lib/cases/filing-work");
    // Asking again replaces the package above: its parts are forgotten with it.
    const asked = await ask(["photo", "scan"]);
    expect(await partsLeft()).toBe(0);

    expect(await buildFilingPackages(backend() as never, 1, String(asked.package_id))).toEqual({ failed: 1 });

    const found = (
      await sql.unsafe(`select status, error, problems from public.filing_packages where id = $1`, [asked.package_id])
    )[0];
    expect(found.status).toBe("failed");
    expect(found.error).toBe("problems");
    expect(found.problems).toEqual([{ code: "not_a_pdf", document_id: documents.photo }]);
    expect(await itemsOf(String(asked.package_id))).toEqual([]);
    expect(await partsLeft()).toBe(0);
  }, 120_000);

  it("takes back what it already cut when a later document turns out not to fit", async () => {
    const { buildFilingPackages } = await import("@/lib/cases/filing-work");
    // The page is heavier than the limit, and the plan cannot know whether compressing would help: the cut says.
    expect(sizes.poster.pages).toBe(1);
    expect(sizes.poster.bytes).toBeGreaterThan(limit);
    // The scan comes first in the package (a proof before another document) and is cut; then the page does not fit.
    const asked = await ask(["poster", "scan"]);
    const before = bucket.size;

    expect(await buildFilingPackages(backend() as never, 1, String(asked.package_id))).toEqual({ failed: 1 });

    const found = (
      await sql.unsafe(`select status, error, problems from public.filing_packages where id = $1`, [asked.package_id])
    )[0];
    expect([found.status, found.error]).toEqual(["failed", "problems"]);
    expect(found.problems).toEqual([{ code: "page_too_large", document_id: documents.poster }]);
    expect(await itemsOf(String(asked.package_id))).toEqual([]);
    // The parts of the scan were stored and recorded before the page was found: none is left, in the table or in the bucket.
    expect(await partsLeft()).toBe(0);
    expect(bucket.size).toBe(before);
  }, 120_000);

  it("takes back the parts it cut when the storage fails, and tries again later", async () => {
    const { buildClaimedPackage, claimFilingPackages } = await import("@/lib/cases/filing-work");
    const asked = await ask(["scan"]);
    const before = bucket.size;
    const [held] = await claimFilingPackages(backend() as never, 1, String(asked.package_id));
    expect(held).toEqual({ packageId: asked.package_id, claim: 1 });

    // The first part is stored and recorded; the second never arrives. Both are taken back.
    failUploadIn = 2;
    expect(await buildClaimedPackage(backend() as never, held)).toBe("retry");
    expect(failUploadIn).toBe(0);

    const found = (
      await sql.unsafe(`select status, error, retry_after > now() as waits from public.filing_packages where id = $1`, [
        asked.package_id,
      ])
    )[0];
    expect([found.status, found.error, found.waits]).toEqual(["requested", "store_unavailable", true]);
    expect(await partsLeft()).toBe(0);
    expect(bucket.size).toBe(before);
    // A worker that fell behind reads nothing under a claim that is not its own.
    expect(await buildClaimedPackage(backend() as never, { packageId: String(asked.package_id), claim: 9 })).toBe(
      "not_held",
    );
    // And while the package waits, nobody claims it.
    expect(await claimFilingPackages(backend() as never, 1, String(asked.package_id))).toEqual([]);
  }, 120_000);
});
