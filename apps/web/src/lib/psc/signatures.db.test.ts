// @vitest-environment node
import { NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { readAttachedCms } from "@flyee/documents/cms";
import { certificateFacts } from "@flyee/psc/certificate";
import { FakePsc } from "@flyee/psc/fake";
import { PscError } from "@flyee/psc/types";

/**
 * A lawyer's signature in the cloud, through the app's own code against a
 * real database (migration 0041), with the vault sealing for real and the
 * fake PSC standing where a PSC stands (`PSC_FAKE=1`): the lawyer declares
 * their CPF and starts the authorization, the PSC's return keeps it only for
 * the lawyer who started it and only for a certificate of that CPF, and
 * tries it once; the files of a filing package are signed as attached
 * `.p7s` that hold over their own PDFs, only as the package has them, each
 * use on record with the hash of every document; a certificate the PSC no
 * longer shows and a signature that does not hold are never used; a PSC that
 * no longer signs ends the authorization; and a lawyer who stops being one in
 * the firm stops signing at once.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, as the same database roles with the same claims, the
 * browser's cookies and the session's reading.
 *
 * Every person, firm, CPF and certificate here is invented: the CPFs are the
 * ones every manual uses as examples.
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
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae810000-0000-4000-8000-000000000001";
const BRUNO = "ae810000-0000-4000-8000-000000000002";
const FIRM = "be810000-0000-4000-8000-00000000000a";
const PACKAGE = "c8810000-0000-4000-8000-0000000000aa";
const BRUNO_CPF = "529.982.247-25";

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

// The vault seals with a key of this test alone, and the fake PSC stands where every PSC stands.
process.env.VAULT_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PSC_FAKE = "1";

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.7\n1 0 obj << /Title (${text}) >> endobj\n%%EOF\n`);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const shared = globalThis as typeof globalThis & { __onePscFake?: Promise<FakePsc> };

/** The files of the package, in its order. */
const FILES = [
  { id: "peticao", kind: "petition", name: "01-peticao-inicial.pdf", content: pdf("peticao inicial") },
  { id: "procuracao", kind: "power_of_attorney", name: "02-procuracao.pdf", content: pdf("procuracao") },
  { id: "bilhete", kind: "ticket", name: "03-bilhete.pdf", content: pdf("bilhete") },
];

async function connectionOf(person: string): Promise<Row | undefined> {
  const [row] = await sql.unsafe(
    `select c.id, c.status, c.last_error, c.expires_at, c.metadata,
            exists (select 1 from public.connection_secrets s where s.connection_id = c.id) as sealed
     from public.connections c where c.org_id = $1 and c.person_id = $2 and c.provider = 'psc.serproid'`,
    [FIRM, person],
  );
  return row;
}

async function usesOf(person: string): Promise<Row[]> {
  return sql.unsafe(
    `select purpose, status, error_code, signed_count, document_hashes, case_id, subject_id
     from public.lawyer_signature_uses where org_id = $1 and person_id = $2 order by opened_at, id`,
    [FIRM, person],
  );
}

/** The lawyer signed in starts an authorization, and the PSC (consenting at once) sends the browser back. */
async function authorize(hours = 24): Promise<string> {
  const { startLawyerSignature } = await import("@/lib/psc/actions");
  const started = await startLawyerSignature({ psc: "serproid", hours });
  if (!started.ok || !started.url) throw new Error(`the start was refused: ${started.code}`);
  const { GET } = await import("@/app/api/connections/psc/callback/route");
  const response = await GET(new NextRequest(started.url));
  return new URL(response.headers.get("location") ?? "").searchParams.get("assinatura") ?? "";
}

describe.skipIf(!DB_URL)("a lawyer's signature in the cloud, kept by ONE", () => {
  let caseId = "";

  /** The package's files signed by Bruno's authorization, as a filing asks. */
  const signPackage = async (documents = FILES.map((file) => ({ id: file.id, content: file.content }))) => {
    const { signForCourt } = await import("@/lib/psc/sign");
    return signForCourt({
      orgId: FIRM,
      personId: BRUNO,
      purpose: "filing.package",
      subjectId: PACKAGE,
      caseId,
      claim: 1,
      documents,
    });
  };

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id in ('${ANA}', '${BRUNO}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@psc-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
        ('${BRUNO}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bruno@psc-app.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-psc-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'),
        ('${FIRM}', '${BRUNO}', 'member', 'advogado');
    `);
    const ana = clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
    const opened = (
      await ana.rpc("create_case", {
        target_org: FIRM,
        target_incident: "delay",
        target_airline: "G3",
        target_flight_date: "2026-01-10",
        target_client: { full_name: "Maria Teste", cpf: "11144477735", birth_date: "1985-04-02" },
      })
    ).data as Row;
    caseId = String(opened.case_id);
    const lawsuit = (
      await ana.rpc("save_proceeding", {
        target_case: caseId,
        target_proceeding: null,
        target_fields: {
          kind: "juizado",
          court: "TJGO",
          comarca: "Goiânia",
          forum_basis: "domicile",
          system: "projudi",
        },
        target_parties: [opened.party_id],
      })
    ).data as Row;
    const proceedingId = String(lawsuit.proceeding_id);

    // The package of the lawsuit, built: its files measured by the backend and accepted as documents of the case.
    const documentIds: string[] = [];
    const fileIds: string[] = [];
    for (const file of FILES) {
      const reserved = (
        await backend().rpc("reserve_file", {
          target_org: FIRM,
          target_purpose: "upload",
          target_name: file.name,
          target_mime: "application/pdf",
          target_bytes: file.content.length,
        })
      ).data as Row;
      const fileId = String(reserved.file_id);
      await backend().rpc("confirm_file", {
        target_file: fileId,
        target_sha256: sha256(file.content),
        target_bytes: file.content.length,
        target_detected_mime: "application/pdf",
        target_pages: 1,
      });
      const attached = (
        await ana.rpc("attach_case_document", { target_case: caseId, target_file: fileId, target_kind: file.kind })
      ).data as Row;
      await ana.rpc("decide_case_document", { target_document: attached.document_id, target_decision: "accepted" });
      documentIds.push(String(attached.document_id));
      fileIds.push(fileId);
    }
    await sql.unsafe(`insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values ($1, $2, $3)`, [
      proceedingId,
      BRUNO,
      FIRM,
    ]);
    // Built, and held by the backend for its signature under the claim 1 (0042).
    await sql.unsafe(
      `insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id, built_at,
                                           signature_status, signature_claim, signature_claimed_at)
       values ($1, $2, $3, $4, 'TJGO', 'projudi', 'juizado', 'ready', $5, now(), 'due', 1, now())`,
      [PACKAGE, FIRM, caseId, proceedingId, documentIds[0]],
    );
    for (const [index, file] of FILES.entries()) {
      await sql.unsafe(
        `insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [FIRM, PACKAGE, index + 1, file.name, fileIds[index], documentIds[index], file.content.length],
      );
    }
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from public.lawyer_cpfs where user_id in ('${ANA}', '${BRUNO}')`);
    await sql.unsafe(`delete from auth.users where id in ('${ANA}', '${BRUNO}')`);
    await sql.end({ timeout: 5 });
  });

  it("asks the lawyer's CPF before anything, and then keeps an authorization of that CPF's certificate, tried once", async () => {
    const { declareLawyerCpf, startLawyerSignature } = await import("@/lib/psc/actions");
    signedIn = BRUNO;
    expect(await startLawyerSignature({ psc: "serproid", hours: 24 })).toEqual({ ok: false, code: "cpf_required" });
    expect(await declareLawyerCpf(BRUNO_CPF)).toEqual({ ok: true, code: "declared" });

    expect(await authorize(24)).toBe("autorizada");
    expect(jar.size).toBe(0);
    const connection = await connectionOf(BRUNO);
    expect(connection).toMatchObject({ status: "connected", sealed: true });
    const lives = Date.parse(String(connection?.expires_at)) - Date.now();
    expect(lives).toBeGreaterThan(23 * 3600_000);
    expect(lives).toBeLessThanOrEqual(24 * 3600_000);
    expect(connection?.metadata).toMatchObject({
      holder: "ADVOGADA TESTE DA SILVA",
      holder_cpf_middle: "982247",
      issuer: "AC ONE DE TESTE",
      hours: 24,
    });
    // Nothing of the token, nor the whole CPF, is in what the firm reads of the connection.
    expect(JSON.stringify(connection?.metadata)).not.toMatch(/fake\.|52998224725/);
    expect(await usesOf(BRUNO)).toMatchObject([{ purpose: "authorization.check", status: "signed", signed_count: 1 }]);
  });

  it("signs a package's files as attached .p7s that hold over their own PDFs, with the use on record", async () => {
    const fake = await shared.__onePscFake;
    const callsBefore = fake?.signed.length ?? 0;
    const outcome = await signPackage();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.holder).toBe("ADVOGADA TESTE DA SILVA");
    expect(outcome.signed.map((item) => item.id)).toEqual(["peticao", "procuracao", "bilhete"]);
    for (const [index, item] of outcome.signed.entries()) {
      const read = await readAttachedCms(item.p7s);
      expect(read.signed).toBe(true);
      expect(sha256(read.content)).toBe(sha256(FILES[index].content));
    }
    // The three digests went to the PSC in one call.
    expect((fake?.signed.length ?? 0) - callsBefore).toBe(1);
    expect((await usesOf(BRUNO)).at(-1)).toMatchObject({
      purpose: "filing.package",
      status: "signed",
      signed_count: 3,
      case_id: caseId,
      subject_id: PACKAGE,
      document_hashes: FILES.map((file) => sha256(file.content)),
    });
  });

  it("signs a package's files only as the package has them", async () => {
    const reordered = [FILES[1], FILES[0], FILES[2]].map((file) => ({ id: file.id, content: file.content }));
    expect(await signPackage(reordered)).toEqual({ ok: false, code: "files_changed" });
    const changed = FILES.map((file, index) => ({
      id: file.id,
      content: index === 0 ? pdf("outra peticao") : file.content,
    }));
    expect(await signPackage(changed)).toEqual({ ok: false, code: "files_changed" });
  });

  it("never signs with a certificate the lawyer did not authorize, nor uses a signature that does not hold", async () => {
    const fake = (await shared.__onePscFake) as FakePsc;
    const other = await FakePsc.create({ holderCpf: "11144477735" });
    const swapped = vi
      .spyOn(fake, "certificates")
      .mockResolvedValueOnce([{ alias: "fake", pem: other.certificatePem }]);
    expect(await signPackage()).toMatchObject({ ok: false, code: "certificate_changed" });
    swapped.mockRestore();
    // Only the lawyer puts that right: the authorization ends, and they authorize again.
    expect(await connectionOf(BRUNO)).toMatchObject({
      status: "expired",
      last_error: "certificate_changed",
      sealed: false,
    });
    expect(await signPackage()).toEqual({ ok: false, code: "no_signature" });
    signedIn = BRUNO;
    expect(await authorize(24)).toBe("autorizada");

    const forged = vi.spyOn(fake, "sign").mockImplementationOnce(async (request) => ({
      certificateAlias: "fake",
      signatures: request.hashes.map((item) => ({ id: item.id, value: new Uint8Array(randomBytes(256)) })),
    }));
    expect(await signPackage()).toMatchObject({ ok: false, code: "signature_invalid" });
    forged.mockRestore();
    expect((await usesOf(BRUNO)).at(-1)).toMatchObject({ status: "failed", error_code: "signature_invalid" });

    // The next signature that holds brings the authorization back.
    expect((await signPackage()).ok).toBe(true);
    expect(await connectionOf(BRUNO)).toMatchObject({ status: "connected", last_error: null });
  });

  it("ends the authorization when the PSC no longer signs with it, and opens nothing after", async () => {
    const fake = (await shared.__onePscFake) as FakePsc;
    const spy = vi.spyOn(fake, "certificates").mockRejectedValueOnce(new PscError("expired", "the session ended"));
    expect(await signPackage()).toMatchObject({ ok: false, code: "session_ended" });
    spy.mockRestore();
    expect(await connectionOf(BRUNO)).toMatchObject({ status: "expired", last_error: "session_ended", sealed: false });
    expect(await signPackage()).toEqual({ ok: false, code: "no_signature" });
  });

  it("keeps nothing of a certificate of another CPF, nor from a return that is not this lawyer's own start", async () => {
    const { startLawyerSignature } = await import("@/lib/psc/actions");
    const { GET } = await import("@/app/api/connections/psc/callback/route");
    const fake = (await shared.__onePscFake) as FakePsc;
    signedIn = BRUNO;

    // The PSC shows a certificate of another CPF than the one Bruno declared.
    const other = await FakePsc.create({ holderCpf: "11144477735" });
    expect(certificateFacts(other.certificatePem).cpf).toBe("11144477735");
    const spy = vi.spyOn(fake, "certificates").mockResolvedValueOnce([{ alias: "fake", pem: other.certificatePem }]);
    expect(await authorize(8)).toBe("outro-titular");
    spy.mockRestore();
    expect(await connectionOf(BRUNO)).toMatchObject({ sealed: false });

    // A return whose state is not the one this browser's start kept.
    const started = await startLawyerSignature({ psc: "serproid", hours: 8 });
    if (!started.ok || !started.url) throw new Error("the start was refused");
    const forged = new URL(started.url);
    forged.searchParams.set("state", "outro-estado-qualquer");
    const refused = await GET(new NextRequest(forged));
    expect(new URL(refused.headers.get("location") ?? "").searchParams.get("assinatura")).toBe("expirada");

    // Bruno's start, come back to a browser where Ana is signed in: his connection is not hers to keep.
    const second = await startLawyerSignature({ psc: "serproid", hours: 8 });
    if (!second.ok || !second.url) throw new Error("the start was refused");
    signedIn = ANA;
    const elsewhere = await GET(new NextRequest(second.url));
    expect(new URL(elsewhere.headers.get("location") ?? "").searchParams.get("assinatura")).toBe("erro");
    expect(await connectionOf(BRUNO)).toMatchObject({ sealed: false });
    expect(await connectionOf(ANA)).toBeUndefined();
    signedIn = BRUNO;
  });

  it("stops signing for a lawyer who stops being one in the firm, at once", async () => {
    signedIn = BRUNO;
    expect(await authorize(8)).toBe("autorizada");
    expect(await connectionOf(BRUNO)).toMatchObject({ status: "connected", sealed: true });
    await sql.unsafe(`update public.memberships set firm_function = 'atendimento' where org_id = $1 and user_id = $2`, [
      FIRM,
      BRUNO,
    ]);
    expect(await connectionOf(BRUNO)).toMatchObject({ status: "disconnected", sealed: false });
    expect(await signPackage()).toEqual({ ok: false, code: "not_a_lawyer" });
    await sql.unsafe(`update public.memberships set firm_function = 'advogado' where org_id = $1 and user_id = $2`, [
      FIRM,
      BRUNO,
    ]);
  });
});
