// @vitest-environment node
import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { readAttachedCms } from "@flyee/documents/cms";

/**
 * The files of a filing package signed by ONE with a lawyer's certificate in
 * the cloud (migrations 0041 and 0042), with the app's own workers against a
 * real database and real PDFs, the vault sealing for real, the fake PSC
 * standing where a PSC stands and the bucket in memory: the package of a
 * lawsuit of the Projudi of TJGO is built and waits for an authorization;
 * the lawyer who signs the lawsuit authorizes ONE and the sweep signs every
 * file as an attached `.p7s` that holds the very PDF; the case says who
 * signed and offers the `.p7s`; a firm that keeps the signature to a person
 * has the lawyer ask for it; and a package given up forgets its `.p7s`.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped.
 *
 * Every person, firm, CPF and certificate here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: () => undefined,
}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;

/** The bucket, in memory: what the workers read and write through the storage API. */
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
    async createSignedUrl(storagePath: string) {
      return bucket.has(storagePath)
        ? { data: { signedUrl: `https://bucket.invalid/${storagePath}` }, error: null }
        : { data: null, error: { message: "not found" } };
    },
  }),
};
const withStorage = <T extends object>(client: T) => Object.assign(client, { storage });
const backend = () => withStorage(clientAs("service_role", { role: "service_role" }));
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae820000-0000-4000-8000-000000000001";
const BRUNO = "ae820000-0000-4000-8000-000000000002";
const FIRM = "be820000-0000-4000-8000-00000000000a";

// The browser's cookies, and who is signed in on it.
const jar = new Map<string, string>();
let signedIn = BRUNO;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (options: string | { name: string }) => {
      jar.delete(typeof options === "string" ? options : options.name);
    },
  }),
}));
vi.mock("@/lib/member/context", () => ({
  getMemberContext: async () => ({
    userId: signedIn,
    firm: {
      id: FIRM,
      name: "Souza Advogados",
      role: signedIn === ANA ? "owner" : "member",
      firmFunction: signedIn === ANA ? "socio" : "advogado",
    },
    supabase: clientAs("authenticated", { sub: signedIn, role: "authenticated", aal: "aal2" }),
    profile: { timezone: "America/Sao_Paulo" },
  }),
}));
vi.mock("@/lib/whatsapp/session", () => ({
  connectionRefusal: async () => null,
  isSupportVisit: async () => false,
}));

process.env.VAULT_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PSC_FAKE = "1";

const asAna = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });

async function call(
  client: { rpc: (name: string, args?: Row) => Promise<{ data: unknown; error: unknown }> },
  name: string,
  args: Row,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${JSON.stringify(error)}`);
  return (data ?? {}) as Row;
}

/** A PDF of text pages. */
async function textPdf(words: string, pages = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1)
    pdf.addPage([595.28, 841.89]).drawText(`${words} ${index + 1}`, { x: 60, y: 760 });
  return pdf.save();
}

describe.skipIf(!DB_URL)("a filing package signed by ONE with a lawyer's certificate in the cloud", () => {
  let caseId = "";
  let proceedingId = "";
  const documents: Record<string, string> = {};
  const contents: Record<string, Uint8Array> = {};

  async function addDocument(key: string, kind: string, bytes: Uint8Array) {
    const { measureFile } = await import("@flyee/documents/measure");
    const reserved = await call(backend(), "reserve_file", {
      target_org: FIRM,
      target_purpose: "upload",
      target_name: `${key}.pdf`,
      target_mime: "application/pdf",
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
    });
    await call(asAna(), "decide_case_document", { target_document: attached.document_id, target_decision: "accepted" });
    documents[key] = String(attached.document_id);
    contents[key] = bytes;
  }

  /** Asks for the lawsuit's package and builds it with the worker (which then tries to sign it, as the job does). */
  async function buildPackage(): Promise<string> {
    const { buildFilingPackages } = await import("@/lib/cases/filing-work");
    const asked = await call(asAna(), "request_filing_package", {
      target_proceeding: proceedingId,
      target_petition: documents.petition,
      target_documents: [documents.evidence],
    });
    const packageId = String(asked.package_id);
    expect(await buildFilingPackages(backend() as never, 1, packageId)).toEqual({ ready: 1 });
    return packageId;
  }

  const packageOf = async (packageId: string) =>
    (
      await sql.unsafe(
        `select status, signature_status, signature_error, signed_by, signed_at, signature_use from public.filing_packages where id = $1`,
        [packageId],
      )
    )[0];

  /** The lawyer signed in starts an authorization, and the PSC (consenting at once) sends the browser back. */
  async function authorize(): Promise<string> {
    const { declareLawyerCpf, startLawyerSignature } = await import("@/lib/psc/actions");
    await declareLawyerCpf("529.982.247-25");
    const started = await startLawyerSignature({ psc: "serproid", hours: 24 });
    if (!started.ok || !started.url) throw new Error(`the start was refused: ${started.code}`);
    const { GET } = await import("@/app/api/connections/psc/callback/route");
    const response = await GET(new NextRequest(started.url));
    return new URL(response.headers.get("location") ?? "").searchParams.get("assinatura") ?? "";
  }

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id in ('${ANA}', '${BRUNO}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@pacote-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
        ('${BRUNO}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bruno@pacote-app.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-pacote-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'),
        ('${FIRM}', '${BRUNO}', 'member', 'advogado');
    `);
    const opened = await call(asAna(), "create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-01-10",
      target_client: { full_name: "Maria Teste", cpf: "11144477735", birth_date: "1985-04-02" },
    });
    caseId = String(opened.case_id);
    const saved = await call(asAna(), "save_proceeding", {
      target_case: caseId,
      target_proceeding: null,
      target_fields: { kind: "juizado", court: "TJGO", comarca: "Goiânia", forum_basis: "domicile", system: "projudi" },
      target_parties: [opened.party_id],
    });
    proceedingId = String(saved.proceeding_id);
    // ONE named the lawsuit's system from the platform's table; the firm approves it before any package (0066).
    const approved = await call(asAna(), "decide_court_system", {
      target_proceeding: proceedingId,
      target_approve: true,
    });
    expect(approved.code).toBe("approved");
    await sql.unsafe(`insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values ($1, $2, $3)`, [
      proceedingId,
      BRUNO,
      FIRM,
    ]);
    await addDocument("petition", "petition", await textPdf("Peticao inicial", 3));
    await addDocument("evidence", "evidence", await textPdf("Comprovante", 2));
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from public.lawyer_cpfs where user_id in ('${ANA}', '${BRUNO}')`);
    await sql.unsafe(`delete from auth.users where id in ('${ANA}', '${BRUNO}')`);
    await sql.end({ timeout: 5 });
  });

  it("builds the package of a Projudi lawsuit, which waits for the lawyer's authorization to be signed", async () => {
    const packageId = await buildPackage();
    expect(await packageOf(packageId)).toMatchObject({
      status: "ready",
      signature_status: "waiting",
      signature_error: "no_signature",
    });
  });

  it("signs every file of it once the lawyer who signs the lawsuit authorized ONE, each .p7s holding its very PDF", async () => {
    const { signFilingPackages } = await import("@/lib/cases/package-signature-work");
    signedIn = BRUNO;
    expect(await authorize()).toBe("autorizada");
    const [{ id: packageId }] = await sql.unsafe(
      `select id from public.filing_packages where case_id = $1 and status = 'ready'`,
      [caseId],
    );
    expect(await signFilingPackages(backend() as never, 3, null)).toMatchObject({ signed: 1 });
    expect(await packageOf(String(packageId))).toMatchObject({
      status: "ready",
      signature_status: "signed",
      signed_by: BRUNO,
    });

    const items = await sql.unsafe(
      `select i.name, i.document_id, f.storage_path as pdf_path, s.storage_path as p7s_path, s.purpose, s.detected_mime
       from public.filing_package_items i
       join public.files f on f.id = i.file_id
       join public.files s on s.id = i.signed_file_id
       where i.package_id = $1 order by i.position`,
      [packageId],
    );
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toMatchObject({ purpose: "filing", detected_mime: "application/pkcs7-mime" });
      const read = await readAttachedCms(bucket.get(String(item.p7s_path)) as Uint8Array);
      expect(read.signed).toBe(true);
      expect(Buffer.from(read.content).equals(Buffer.from(bucket.get(String(item.pdf_path)) as Uint8Array))).toBe(true);
    }
    expect(
      (
        await sql.unsafe(
          `select kind, actor_type from public.case_events where case_id = $1 and kind = 'filing_package_signed'`,
          [caseId],
        )
      )[0],
    ).toMatchObject({ actor_type: "system" });

    // The .p7s leave ONE only in the hands of the lawyer whose certificate signed them; the PDFs, for anybody of
    // the firm; and no other way to a file hands out a .p7s.
    const { openFilingFile } = await import("@/lib/cases/filing-actions");
    const { openCaseFile } = await import("@/lib/cases/actions");
    const [first] = await sql.unsafe(
      `select id, signed_file_id from public.filing_package_items where package_id = $1 order by position limit 1`,
      [packageId],
    );
    signedIn = BRUNO;
    expect(await openFilingFile(String(first.id), true)).toMatchObject({ ok: true });
    signedIn = ANA;
    expect(await openFilingFile(String(first.id), true)).toEqual({ ok: false, code: "not_the_signer" });
    expect(await openFilingFile(String(first.id))).toMatchObject({ ok: true });
    expect(await openCaseFile(String(first.signed_file_id))).toEqual({ ok: false, code: "not_found" });
    signedIn = BRUNO;
  });

  it("where the firm keeps it to a person, signs only when the lawyer of the lawsuit asks, with their authorization", async () => {
    const { requestPackageSignature } = await import("@/lib/cases/filing-actions");
    const { signFilingPackages } = await import("@/lib/cases/package-signature-work");
    await sql.unsafe(
      `insert into public.firm_autonomy (org_id, decision, mode) values ($1, 'sign_package', 'approval')`,
      [FIRM],
    );
    const packageId = await buildPackage();
    expect(await packageOf(packageId)).toMatchObject({ status: "ready", signature_status: null });
    expect(await signFilingPackages(backend() as never, 3, null)).toEqual({});

    signedIn = ANA;
    expect(await requestPackageSignature(caseId, packageId)).toMatchObject({ ok: false, code: "not_a_signer" });
    signedIn = BRUNO;
    expect(await requestPackageSignature(caseId, packageId)).toMatchObject({ ok: true, code: "requested" });
    expect(await signFilingPackages(backend() as never, 3, null)).toMatchObject({ signed: 1 });
    expect(await packageOf(packageId)).toMatchObject({ signature_status: "signed", signed_by: BRUNO });
  });

  it("forgets the .p7s of a package given up with its parts, never the documents", async () => {
    const [{ id: packageId }] = await sql.unsafe(
      `select id from public.filing_packages where case_id = $1 and status = 'ready'`,
      [caseId],
    );
    const signedFiles = (
      await sql.unsafe(`select signed_file_id from public.filing_package_items where package_id = $1`, [packageId])
    ).map((row) => String(row.signed_file_id));
    expect(signedFiles).toHaveLength(2);
    expect((await call(asAna(), "cancel_filing_package", { target_package: packageId })).ok).toBe(true);
    expect(
      Number(
        (await sql.unsafe(`select count(*)::int as n from public.files where id = any($1::uuid[])`, [signedFiles]))[0]
          .n,
      ),
    ).toBe(0);
    expect(
      Number(
        (
          await sql.unsafe(`select count(*)::int as n from public.case_documents where id = any($1::uuid[])`, [
            Object.values(documents),
          ])
        )[0].n,
      ),
    ).toBe(2);
  });
});
