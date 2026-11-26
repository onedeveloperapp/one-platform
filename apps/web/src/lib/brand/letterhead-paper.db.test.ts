// @vitest-environment node
import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { type ConvertResult, fakeConverter } from "@flyee/documents/office";

/**
 * The firm's Word letterhead copied on ONE's server, with the app's own code against a real database (migration
 * 0300): who manages the firm sends a Word document, the converter claims it, empties its body, has the suite make
 * it a PDF (the stand-in converter here), keeps the paper as a file of the firm's brand and records it; the documents
 * ONE writes then draw that paper, its first page under the first. A suite that does not answer is tried again
 * until its attempts are spent; a letterhead sent anew while its copy ran takes the copy's file with it. Another firm
 * reads nothing of it.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped. What
 * stands in is the transport, the bucket (in memory) and the office suite.
 *
 * Every person, firm and name here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const bucket = new Map<string, Uint8Array>();

const backend = () => clientAs("service_role", { role: "service_role" });

const ANA = "a3001000-0000-4000-8000-000000000001";
const DAVI = "a3001000-0000-4000-8000-000000000002";
const FIRM = "b3001000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "b3001000-0000-4000-8000-00000000000b";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const asAna = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
const asDavi = () => clientAs("authenticated", { sub: DAVI, role: "authenticated", aal: "aal2" });

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A Word document on an invented firm's letterhead, a petition written on it. */
const letterheadDocx = () =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<w:document ${W}><w:body><w:p><w:r><w:t>O autor viajou no dia 3 e o voo atrasou seis horas.</w:t></w:r></w:p>` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="2835" w:right="1134" w:bottom="1701" w:left="1701" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>',
    ),
    "word/_rels/document.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Target="header1.xml"/></Relationships>',
    ),
    "word/header1.xml": strToU8(`<w:hdr ${W}><w:p><w:r><w:t>Souza Advogados</w:t></w:r></w:p></w:hdr>`),
  });

/** The Word document A sends as its letterhead, kept as the person's upload is, and read by ONE (0260). */
async function send(): Promise<string> {
  const bytes = letterheadDocx();
  const reserved = await call(asAna(), "reserve_file_upload", {
    target_org: FIRM,
    target_purpose: "brand",
    target_name: "Timbrado Souza.docx",
    target_mime: DOCX,
    target_bytes: bytes.byteLength,
  });
  expect(reserved.code).toBe("reserved");
  bucket.set(String(reserved.storage_path), bytes);
  const { supabaseFileStore } = await import("@/lib/files/store");
  const { measureFile } = await import("@flyee/documents/measure");
  const kept = await supabaseFileStore(backend() as never).confirm(String(reserved.file_id), await measureFile(bytes));
  expect(kept.ok).toBe(true);
  const read = await call(asAna(), "set_firm_letterhead", {
    target_org: FIRM,
    target_kind: "word",
    target_source_file: reserved.file_id,
    target_data: { margins: { top: 141.75, bottom: 85.05, left: 85.05, right: 56.7 } },
  });
  expect(read.code).toBe("read");
  return String(reserved.file_id);
}

const brand = async () =>
  (
    await sql.unsafe(
      `select letterhead_paper_status, letterhead_paper_problem, letterhead_paper_file_id, letterhead_paper,
              letterhead_paper_attempts from public.firm_brands where org_id = $1`,
      [FIRM],
    )
  )[0]!;

describe.skipIf(!DB_URL)("the firm's Word letterhead copied on ONE's server", () => {
  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${DAVI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@papel.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${DAVI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'davi@papel.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-papel-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Rocha Advocacia', 'rocha-papel-app', '${DAVI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${DAVI}', 'owner', 'advogado');
    `);
    // A letterhead some other firm left waiting on this database is not this file's to claim.
    await sql.unsafe(
      `update public.firm_brands set letterhead_paper_status = 'failed', letterhead_paper_claim = null
       where letterhead_paper_status = 'converting'`,
    );
  }, 120_000);

  afterAll(async () => {
    await sql?.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    await sql?.unsafe(`delete from auth.users where id in ('${ANA}', '${DAVI}')`);
    await sql?.end({ timeout: 5 });
  });

  it("claims the Word document, keeps its paper and records it; the documents then draw it", async () => {
    const { convertLetterheadPaper } = await import("@/lib/brand/letterhead-paper-work");
    const { firmLetterhead } = await import("@/lib/brand/letterhead-read");
    await send();
    expect((await brand()).letterhead_paper_status).toBe("converting");
    // Not yet: the person confirms only a paper they could see.
    expect((await call(asAna(), "confirm_firm_letterhead", { target_org: FIRM })).code).toBe("paper_not_ready");

    // What the suite is handed is the document with its body emptied into two pages.
    const handed: Uint8Array[] = [];
    const suite = fakeConverter(async (docx) => {
      handed.push(docx);
      return fakeConverter().docxToPdf(docx);
    });
    const outcome = await convertLetterheadPaper(backend() as never, suite);
    expect(outcome).toMatchObject({ code: "ready", orgId: FIRM });
    const { strFromU8, unzipSync } = await import("fflate");
    const body = strFromU8(unzipSync(handed[0]!)["word/document.xml"]!);
    expect(body).not.toContain("O autor viajou");
    expect(body).toContain('<w:br w:type="page"/>');

    const row = await brand();
    expect(row.letterhead_paper_status).toBe("ready");
    const paper = row.letterhead_paper as {
      pages: number;
      first: { header: number };
      rest: { header: number; margins: { top: number } };
      converter: string;
    };
    expect(paper.pages).toBe(2);
    // The stand-in's first page has a taller band than its following one; the text keeps the Word's own top.
    expect(paper.first.header).toBeGreaterThan(paper.rest.header);
    expect(paper.rest.margins.top).toBeGreaterThanOrEqual(141);
    expect(paper.converter).toBe("fake");
    const [file] = await sql.unsafe(
      `select purpose, status, detected_mime, storage_path from public.files where id = $1`,
      [row.letterhead_paper_file_id],
    );
    expect(file).toMatchObject({ purpose: "brand", status: "stored", detected_mime: "application/pdf" });
    expect(bucket.has(String(file!.storage_path))).toBe(true);
    // Nothing more waits.
    expect(await convertLetterheadPaper(backend() as never, suite)).toEqual({ code: "idle" });

    // The person sees the pages of example on the paper, and confirms it.
    const drawn = await firmLetterhead(backend() as never, FIRM, { unconfirmed: true });
    expect(drawn).toMatchObject({ kind: "page", page: 1, first: { page: 0 } });
    expect((await PDFDocument.load((drawn as { pdf: Uint8Array }).pdf)).getPageCount()).toBe(2);
    expect(await firmLetterhead(backend() as never, FIRM)).toBeNull();
    expect((await call(asAna(), "confirm_firm_letterhead", { target_org: FIRM })).code).toBe("confirmed");
    expect(await firmLetterhead(backend() as never, FIRM)).toMatchObject({ kind: "page" });

    // Another firm reads nothing of it.
    const { data } = await asDavi().from("firm_brands").select("org_id").eq("org_id", FIRM);
    expect(data ?? []).toEqual([]);
  });

  it("tries a suite that did not answer again, and gives up once its attempts are spent", async () => {
    const { convertLetterheadPaper } = await import("@/lib/brand/letterhead-paper-work");
    await send();
    const silent = fakeConverter(async (): Promise<ConvertResult> => ({ ok: false, code: "unavailable" }));
    expect(await convertLetterheadPaper(backend() as never, silent)).toMatchObject({ code: "retry" });
    expect(await convertLetterheadPaper(backend() as never, silent)).toMatchObject({ code: "retry" });
    expect(await convertLetterheadPaper(backend() as never, silent)).toMatchObject({ code: "failed" });
    expect(await brand()).toMatchObject({
      letterhead_paper_status: "failed",
      letterhead_paper_problem: "unavailable",
      letterhead_paper_attempts: 3,
    });
    expect(await convertLetterheadPaper(backend() as never, silent)).toEqual({ code: "idle" });
  });

  it("forgets the copy of a letterhead sent anew while it ran", async () => {
    const { convertLetterheadPaper } = await import("@/lib/brand/letterhead-paper-work");
    await send();
    const papers = async () =>
      Number(
        (
          await sql.unsafe(
            `select count(*)::int as count from public.files where org_id = $1 and name = 'timbrado-papel.pdf'`,
            [FIRM],
          )
        )[0]!.count,
      );
    const papersBefore = await papers();
    const objectsBefore = bucket.size;
    // While the suite works, the person sends another document.
    const racing = fakeConverter(async (docx) => {
      await send();
      return fakeConverter().docxToPdf(docx);
    });
    expect(await convertLetterheadPaper(backend() as never, racing)).toMatchObject({ code: "stale" });
    // The copy nobody keeps is forgotten, its record and its bytes: only the new document was added.
    expect(await papers()).toBe(papersBefore);
    expect(bucket.size).toBe(objectsBefore + 1);
    // The new document waits for its own copy.
    expect((await brand()).letterhead_paper_status).toBe("converting");
  });
});
