// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The photo of a document measured where it arrives, with the app's own code
 * against a real database and real pictures: a client's link reserves a
 * photo, the backend measures its pixels before anything is kept, the client
 * is told what is wrong with one nobody will read and takes another (the one
 * that waited goes at once, record and bytes) or sends it all the same, and
 * the firm reads the photo beside its measure. And a photo that came some
 * other way is measured by the sweep. What runs is what the link's own
 * actions run (`finishLinkUpload`, `takeBackClientUpload`): the actions
 * themselves only add the check of the request around them.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`: an embedded PostgreSQL with every migration
 * applied, its address in `ONE_EMBEDDED_DB_URL`); otherwise it is skipped.
 * What stands in is the transport and the bucket: a client that calls the
 * same functions with the same named arguments PostgREST would, as the same
 * database roles, and a bucket kept in memory. The pictures are drawn
 * (`@flyee/documents/quality-fixtures`): nobody's document is in a fixture.
 *
 * Every person, firm and token here is invented.
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

/** The bucket, in memory: what the backend reads and writes through the storage API. */
const bucket = new Map<string, Uint8Array>();

const storage = {
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

/** The functions that do not answer, when a test says so: the database out of reach for that one call. */
const down = new Set<string>();
/** What happens just before a function is called, once, when a test says so: another request getting there first. */
const first = new Map<string, () => Promise<void>>();

/** A stand-in for the Supabase client, as far as this code uses one: `rpc` and the bucket. */
function clientAs(role: "service_role" | "authenticated" | "anon", claims: Row) {
  return {
    storage,
    async rpc(name: string, args: Row = {}) {
      if (down.has(name)) return { data: null, error: { code: "08006", message: "the database did not answer" } };
      const before = first.get(name);
      if (before) {
        first.delete(name);
        await before();
      }
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

const ANA = "af100000-0000-4000-8000-000000000001";
const DAVI = "af100000-0000-4000-8000-000000000004";
const FIRM = "bf100000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "bf100000-0000-4000-8000-00000000000b";
/** The tokens of the two links: of a client of each firm. */
const TOKEN = "token-da-maria-para-a-medida-da-foto-0001";
const OTHER_TOKEN = "token-do-paulo-para-a-medida-da-foto-0002";

const asAna = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
const asDavi = () => clientAs("authenticated", { sub: DAVI, role: "authenticated", aal: "aal2" });
/** Whoever holds a link: no account, the token is the credential. */
const asClient = () => clientAs("anon", { role: "anon" });

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

describe.skipIf(!DB_URL)("the photo of a document, measured where it arrives", () => {
  let caseId = "";
  let partyId = "";
  /** A page that can be read, one out of focus and one taken in the dark: the same page, drawn. */
  let sharpPhoto: Uint8Array = new Uint8Array(0);
  let blurredPhoto: Uint8Array = new Uint8Array(0);
  let darkPhoto: Uint8Array = new Uint8Array(0);
  /** A frame of grain alone: nothing in it stands out, so the rule cannot tell it sharp from soft. */
  let grainAlone: Uint8Array = new Uint8Array(0);

  type Quality = {
    rule: string;
    sharpness: number;
    problems: string[];
    insisted: boolean;
    limits: Row;
    measured_at: string;
  } | null;
  const documentOf = async (documentId: string) =>
    (
      await sql.unsafe(
        `select d.status, d.quality, d.normalized_file_id, d.processing, f.status as file_status, f.storage_path
         from public.case_documents d left join public.files f on f.id = d.file_id where d.id = $1`,
        [documentId],
      )
    )[0] as
      | {
          status: string;
          quality: Quality;
          normalized_file_id: string | null;
          processing: string;
          file_status: string;
          storage_path: string;
        }
      | undefined;

  /** The client chooses a file on their link: the reservation, and the bytes where the link put them (unless they never arrive). */
  async function upload(kind: string, bytes: Uint8Array | null, mime = "image/jpeg") {
    const reserved = await call(asClient(), "client_link_reserve_upload", {
      target_token: TOKEN,
      target_kind: kind,
      target_party: kind === "identity" ? partyId : null,
      target_name: mime === "application/pdf" ? "documento.pdf" : "foto.jpg",
      target_mime: mime,
      target_bytes: bytes?.byteLength ?? 1000,
    });
    expect(reserved.code).toBe("reserved");
    if (bytes) bucket.set(String(reserved.storage_path), bytes);
    return {
      documentId: String(reserved.document_id),
      fileId: String(reserved.file_id),
      storagePath: String(reserved.storage_path),
    };
  }

  /** The second half of an upload, as the link's own action runs it. */
  async function finish(documentId: string, insist = false) {
    const { finishLinkUpload } = await import("@/lib/cases/client-uploads");
    return finishLinkUpload(asClient() as never, backend() as never, TOKEN, documentId, { insist });
  }

  /** A photo taken back through a link, as the link's own action runs it. */
  async function takeBack(token: string, documentId: string) {
    const { takeBackClientUpload } = await import("@/lib/cases/client-uploads");
    return takeBackClientUpload(asClient() as never, backend() as never, token, documentId);
  }

  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "..", "..");
    const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
    const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
    sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });

    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${DAVI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@foto.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
        ('${DAVI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'davi@foto.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-foto', '${ANA}'),
        ('${OTHER_FIRM}', 'Rocha Advocacia', 'rocha-foto', '${DAVI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'),
        ('${OTHER_FIRM}', '${DAVI}', 'owner', 'advogado');
    `);

    const { createHash } = await import("node:crypto");
    const hashOf = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
    const opened = await call(asAna(), "create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: null,
      target_client: { full_name: "Maria Teste", birth_date: "1985-04-02" },
    });
    caseId = String(opened.case_id);
    partyId = String(opened.party_id);
    const link = await call(asAna(), "create_client_link", {
      target_case: caseId,
      target_person: opened.person_id,
      target_token_hash: hashOf(TOKEN),
    });
    expect(link.code).toBe("created");
    const other = await call(asDavi(), "create_case", {
      target_org: OTHER_FIRM,
      target_incident: "cancellation",
      target_airline: null,
      target_flight_date: null,
      target_client: { full_name: "Paulo Teste", birth_date: "1980-01-10" },
    });
    const otherLink = await call(asDavi(), "create_client_link", {
      target_case: other.case_id,
      target_person: other.person_id,
      target_token_hash: hashOf(OTHER_TOKEN),
    });
    expect(otherLink.code).toBe("created");

    const { grainy, lit, page, plain, unfocused } = await import("@flyee/documents/quality-fixtures");
    const drawn = await page({ width: 1500, height: 2000 });
    sharpPhoto = new Uint8Array(drawn);
    blurredPhoto = new Uint8Array(await unfocused(drawn, 6));
    darkPhoto = new Uint8Array(await lit(drawn, 0.25, 0));
    grainAlone = new Uint8Array(await grainy(await plain(1500, 2000, "#909090"), 12));
  }, 120_000);

  afterAll(async () => {
    down.clear();
    first.clear();
    await sql?.end({ timeout: 5 });
  });

  it("keeps a photo that can be read, with what was measured of it beside it", async () => {
    const sent = await upload("identity", sharpPhoto);
    expect(await finish(sent.documentId)).toEqual({ ok: true, code: "received" });

    const kept = await documentOf(sent.documentId);
    expect([kept?.status, kept?.file_status]).toEqual(["received", "stored"]);
    expect(bucket.has(sent.storagePath)).toBe(true);
    // What the rule really hands over is what the database keeps: its version, its measure, its limits.
    const { IMAGE_LIMIT_NAMES, IMAGE_QUALITY_RULE } = await import("@flyee/documents/quality");
    expect(kept?.quality?.rule).toBe(IMAGE_QUALITY_RULE);
    expect(kept?.quality?.problems).toEqual([]);
    expect(kept?.quality?.insisted).toBe(false);
    expect(kept?.quality?.sharpness).toBeGreaterThan(150);
    expect(Object.keys(kept?.quality?.limits ?? {}).sort()).toEqual(Object.values(IMAGE_LIMIT_NAMES).sort());

    // The same request again (an answer that got lost on the way): the same answer, and nothing done twice.
    expect(await finish(sent.documentId)).toEqual({ ok: true, code: "received" });
    expect((await documentOf(sent.documentId))?.quality?.measured_at).toBe(kept?.quality?.measured_at);
  });

  it("tells a photo hard to read before it is kept, the same at every request, and takes 'all the same' only from who was told", async () => {
    const sent = await upload("address_proof", blurredPhoto);
    const poor = { ok: false, code: "photo_poor", problems: ["blurry"] };

    // A request that already asks to send it all the same: nobody was told yet, so it is told, and no more.
    expect(await finish(sent.documentId, true)).toEqual(poor);
    const told = await documentOf(sent.documentId);
    // On record before the client is told, and nothing kept: the document still waits, and so does its file.
    expect([told?.status, told?.file_status]).toEqual(["uploading", "reserved"]);
    expect(told?.quality?.problems).toEqual(["blurry"]);
    expect(told?.quality?.insisted).toBe(false);

    // Asked again, the record answers and nothing is read again: the bytes are not even there to be read.
    bucket.delete(sent.storagePath);
    expect(await finish(sent.documentId)).toEqual(poor);
    expect((await documentOf(sent.documentId))?.quality?.measured_at).toBe(told?.quality?.measured_at);
    // A photo that was measured was there: not finding it now is a failure of the moment, never "it did not arrive".
    expect(await finish(sent.documentId, true)).toEqual({ ok: false, code: "failed" });
    bucket.set(sent.storagePath, blurredPhoto);

    // Neither is a database that did not answer "the upload is gone": the client keeps the choice.
    for (const name of [
      "client_link_upload_to_finish",
      "record_document_insisted",
      "confirm_file",
      "client_link_finish_upload",
    ]) {
      down.add(name);
      expect(await finish(sent.documentId, true), name).toEqual({ ok: false, code: "failed" });
      down.clear();
    }
    const waiting = await documentOf(sent.documentId);
    expect([waiting?.status, bucket.has(sent.storagePath)]).toEqual(["uploading", true]);

    // Told, the client sends it all the same: it goes on, with both on record for the firm.
    expect(await finish(sent.documentId, true)).toEqual({ ok: true, code: "received" });
    const received = await documentOf(sent.documentId);
    expect([received?.status, received?.file_status]).toEqual(["received", "stored"]);
    expect(received?.quality?.problems).toEqual(["blurry"]);
    expect(received?.quality?.insisted).toBe(true);

    // What the firm reads of it, and what the check of the document is told.
    const { readQuality } = await import("@/lib/cases/document-quality");
    const { checkBriefing } = await import("@/lib/cases/document-check");
    const quality = readQuality(received?.quality);
    expect(quality).toEqual({ problems: ["blurry"], insisted: true });
    const briefing = checkBriefing({
      kind: "address_proof",
      personName: "Maria Teste",
      incident: "delay",
      airline: null,
      flightDate: null,
      quality,
    });
    expect(briefing).toContain("Medida da foto: tremida ou sem foco.");
    expect(briefing).toContain("O cliente foi avisado disso e enviou a foto assim mesmo.");
  });

  it("answers a request another got ahead of from the one record, and takes no 'all the same' from it", async () => {
    // Another request measures this very upload and keeps its measure first, between this one's look at the
    // record and its own measure being kept. What that request kept is another reading of the photo than this
    // one took (as after a change of the limits): so what is told shows which of the two answered.
    const ahead = async (documentId: string, problems: string[]) => {
      const { judgeImage } = await import("@flyee/documents/quality");
      const rule = await call(backend(), "document_quality_rule", { target_kind: "receipt" });
      const record = judgeImage({ width: 1500, height: 2000, sharpness: 230, shadow: 20, highlight: 250 }, rule);
      const kept = await call(backend(), "record_document_quality", {
        target_document: documentId,
        target_quality: { ...record, problems },
      });
      expect(kept.code).toBe("measured");
    };

    // This request measures a blurred photo; the one ahead of it kept "too dark". The record answers.
    const soft = await upload("receipt", blurredPhoto);
    first.set("record_document_quality", () => ahead(soft.documentId, ["too_dark"]));
    expect(await finish(soft.documentId)).toEqual({ ok: false, code: "photo_poor", problems: ["too_dark"] });
    expect((await documentOf(soft.documentId))?.quality?.problems).toEqual(["too_dark"]);

    // The same, asking to send it all the same: this request found no measure on record when it came, so it
    // is not the answer of a client who was told. It is told, and nothing is sent.
    const other = await upload("receipt", blurredPhoto);
    first.set("record_document_quality", () => ahead(other.documentId, ["too_dark"]));
    expect(await finish(other.documentId, true)).toEqual({ ok: false, code: "photo_poor", problems: ["too_dark"] });
    const told = await documentOf(other.documentId);
    expect([told?.status, told?.quality?.insisted]).toEqual(["uploading", false]);
    // Now told, the client's next request is taken.
    expect(await finish(other.documentId, true)).toEqual({ ok: true, code: "received" });
    expect((await documentOf(other.documentId))?.quality?.insisted).toBe(true);

    // The one ahead found nothing against the photo this request would have called blurred: it goes on.
    const kind = await upload("receipt", blurredPhoto);
    first.set("record_document_quality", () => ahead(kind.documentId, []));
    expect(await finish(kind.documentId)).toEqual({ ok: true, code: "received" });
    expect((await documentOf(kind.documentId))?.quality?.problems).toEqual([]);

    // And two requests truly at once, of a photo with nothing against it: received once, its bytes kept.
    const fine = await upload("receipt", sharpPhoto);
    const received = { ok: true, code: "received" };
    expect(await Promise.all([finish(fine.documentId), finish(fine.documentId)])).toEqual([received, received]);
    expect(bucket.has(fine.storagePath)).toBe(true);
    expect((await documentOf(fine.documentId))?.file_status).toBe("stored");
  });

  it("takes back at once the photo a client did not send: the document that waited, the file and its bytes", async () => {
    const sent = await upload("identity", darkPhoto);
    expect(await finish(sent.documentId)).toEqual({ ok: false, code: "photo_poor", problems: ["too_dark"] });
    expect(bucket.has(sent.storagePath)).toBe(true);

    // Another firm's link does not reach it, nor a token that is no link; a database that did not answer took nothing.
    expect(await takeBack(OTHER_TOKEN, sent.documentId)).toEqual({ ok: false, code: "not_found" });
    expect(await takeBack("um-token-que-nao-existe", sent.documentId)).toEqual({ ok: false, code: "link_not_open" });
    down.add("client_link_discard_upload");
    expect(await takeBack(TOKEN, sent.documentId)).toEqual({ ok: false, code: "failed" });
    down.clear();
    expect(bucket.has(sent.storagePath)).toBe(true);
    expect((await documentOf(sent.documentId))?.status).toBe("uploading");

    // The client took another photo: nothing of this one is left.
    expect(await takeBack(TOKEN, sent.documentId)).toEqual({ ok: true, code: "discarded" });
    expect(bucket.has(sent.storagePath)).toBe(false);
    expect(await documentOf(sent.documentId)).toBeUndefined();
    expect(await sql.unsafe(`select 1 from public.files where id = $1`, [sent.fileId])).toHaveLength(0);
    expect(await takeBack(TOKEN, sent.documentId)).toEqual({ ok: false, code: "not_found" });
    // And the request that would have sent it finds nothing to send.
    expect(await finish(sent.documentId, true)).toEqual({ ok: false, code: "not_found" });

    // What the firm received is the firm's: a photo sent is not a client's to take back.
    const kept = await upload("receipt", sharpPhoto);
    expect(await finish(kept.documentId)).toEqual({ ok: true, code: "received" });
    expect(await takeBack(TOKEN, kept.documentId)).toEqual({ ok: false, code: "already_sent" });
    expect(bucket.has(kept.storagePath)).toBe(true);
    expect((await documentOf(kept.documentId))?.status).toBe("received");
  });

  it("measures only the photo of a paper to be read, and tells nobody of a measure it could not keep", async () => {
    // A photo of what happened is what it is: nobody takes it again.
    const happened = await upload("evidence", blurredPhoto);
    expect(await finish(happened.documentId)).toEqual({ ok: true, code: "received" });
    expect((await documentOf(happened.documentId))?.quality).toBeNull();

    // A PDF is no photo, whatever it is of.
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.addPage([595.28, 841.89]).drawText("Bilhete", { x: 60, y: 760 });
    const paper = await upload("ticket", await pdf.save(), "application/pdf");
    expect(await finish(paper.documentId)).toEqual({ ok: true, code: "received" });
    expect((await documentOf(paper.documentId))?.quality).toBeNull();

    // A file that says it is a photo and is none: nothing is measured, the file is refused and its bytes go.
    const fake = await upload("ticket", new TextEncoder().encode("isto não é uma imagem"));
    expect(await finish(fake.documentId)).toEqual({ ok: false, code: "type_not_allowed" });
    expect((await documentOf(fake.documentId))?.quality).toBeNull();
    expect(bucket.has(fake.storagePath)).toBe(false);

    // A file that never arrived.
    const absent = await upload("ticket", null);
    expect(await finish(absent.documentId)).toEqual({ ok: false, code: "not_uploaded" });

    // The measure could not be kept: the client is told nothing (they could never send the photo then), and
    // the photo goes on for the sweep to measure.
    const unlucky = await upload("boarding_pass", blurredPhoto);
    down.add("record_document_quality");
    expect(await finish(unlucky.documentId)).toEqual({ ok: true, code: "received" });
    down.clear();
    expect((await documentOf(unlucky.documentId))?.quality).toBeNull();
    // And while the rule itself cannot be read, nothing is measured.
    const unruled = await upload("boarding_pass", blurredPhoto);
    down.add("document_quality_rule");
    expect(await finish(unruled.documentId)).toEqual({ ok: true, code: "received" });
    down.clear();
    expect((await documentOf(unruled.documentId))?.quality).toBeNull();
  });

  it("keeps the measure of a picture that is grain all over as the rule gives it", async () => {
    // Nothing in it stands out: the whole of it is read. Its grain is in focus, and its light is flat.
    const sent = await upload("receipt", grainAlone);
    expect(await finish(sent.documentId)).toEqual({ ok: false, code: "photo_poor", problems: ["flat"] });
    const kept = await documentOf(sent.documentId);
    expect(kept?.quality?.sharpness).toBeGreaterThan(150);
    expect(kept?.quality?.problems).toEqual(["flat"]);
  });

  it("counts every attempt against what a link may send, the photos taken back included", async () => {
    const [link] = await sql.unsafe(
      `select upload_count, (select count(*)::int from public.case_documents d where d.link_id = l.id) as documents
       from public.client_links l where l.case_id = $1 and l.revoked_at is null`,
      [caseId],
    );
    // Fifteen reservations so far, one of them taken back and gone.
    expect([Number(link.upload_count), Number(link.documents)]).toEqual([15, 14]);
  });

  it("measures in the sweep a photo that came some other way, once, and keeps the page made of it", async () => {
    const { processCaseDocuments } = await import("@/lib/cases/documents-work");
    const { measureFile } = await import("@flyee/documents/measure");

    // A person of the firm adds a photo and accepts it: nobody was asked on a link, and no check waits.
    const reserved = await call(backend(), "reserve_file", {
      target_org: FIRM,
      target_purpose: "upload",
      target_name: "comprovante.jpg",
      target_mime: "image/jpeg",
      target_bytes: darkPhoto.byteLength,
    });
    bucket.set(String(reserved.storage_path), darkPhoto);
    const measure = await measureFile(darkPhoto);
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
      target_kind: "address_proof",
      target_party: partyId,
    });
    expect(attached.code).toBe("attached");
    const documentId = String(attached.document_id);
    await call(asAna(), "decide_case_document", { target_document: documentId, target_decision: "accepted" });

    expect(await processCaseDocuments(backend() as never, 1, documentId)).toEqual({ done: 1, other: 0 });
    const processed = await documentOf(documentId);
    expect(processed?.processing).toBe("done");
    expect(processed?.normalized_file_id).toBeTruthy();
    expect(processed?.quality?.problems).toEqual(["too_dark"]);
    // Nobody was told on a link, so nobody "sent it all the same".
    expect(processed?.quality?.insisted).toBe(false);

    // A measure is taken once: what is on record stands, whoever hands another.
    const { keepQuality } = await import("@/lib/cases/document-quality-work");
    const again = { ...(processed?.quality as Row), problems: [] };
    expect(await keepQuality(backend() as never, documentId, again as never)).toBe("already");
    expect((await documentOf(documentId))?.quality?.problems).toEqual(["too_dark"]);
  });
});
