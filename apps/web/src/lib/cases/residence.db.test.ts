// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * A bill in the mother's name becomes a signed declaration that goes to the court (migration 0123), with the app's own
 * code against a real database: ONE's check accepts Maria's bill in her mother's name where the firm accepts such
 * bills, writes its address and owes the declaration; Maria says on her link who the holder is; once she finished, the
 * worker issues the power of attorney and the declaration as PDFs of the firm's own and sends them to sign by gov.br;
 * she sends back each PDF signed, a person of the firm confirms it, and the lawsuit's filing package takes the signed
 * declaration. Before it is signed, the filing waits for it.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped. What stands
 * in is the transport, as the same database roles with the same claims, and the bucket (in memory). The check's answer
 * is written as the model would answer: the model is tried on its own (the instructions' run with a real model).
 *
 * Every person, firm and number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const bucket = new Map<string, Uint8Array>();
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae930000-0000-4000-8000-000000000001";
const FIRM = "be930000-0000-4000-8000-00000000000a";
const TOKEN = "token-da-maria-residencia-0123456789abcdef";
const BILL = "ab930000-0000-4000-8000-000000000001";
const PETITION = "ab930000-0000-4000-8000-000000000002";
const LAWSUIT = "ab930000-0000-4000-8000-000000000003";

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });
const anon = () => clientAs("anon", { role: "anon" });

async function ok(result: { data: unknown; error: { message: string } | null }): Promise<Row> {
  expect(result.error).toBeNull();
  const answer = result.data as Row;
  expect(answer.ok, JSON.stringify(answer)).toBe(true);
  return answer;
}

/** What ONE carries of the case now: the sweep's worker. */
async function carry(caseId: string) {
  const { advanceCases, followSoon } = await import("@/lib/cases/advance-work");
  return advanceCases(backend() as never, 1, caseId, followSoon);
}

/** The PDF as a signer gives it back: a revision that signs it (its value made up: only that one is there is read). */
function signedPdf(original: Uint8Array): Uint8Array {
  const base = Buffer.from(original).toString("latin1");
  const value = "3082054306092A864886F70D010702A0";
  const pad = (n: number) => String(n).padStart(10, "0");
  const head = (range: string) =>
    `${base}\n9999 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange ${range} /Contents <`;
  const tail = "> >>\nendobj\n%%EOF\n";
  const width = head("[0 0000000000 0000000000 0000000000]").length;
  const after = width + value.length + 1;
  const total = after + tail.length - 1;
  return new Uint8Array(
    Buffer.from(`${head(`[0 ${pad(width - 1)} ${pad(after)} ${pad(total - after)}]`)}${value}${tail}`, "latin1"),
  );
}

/**
 * Maria sends back, on her link, the PDF she signed at gov.br, and Ana confirms it signed. The PDF as ONE issued it,
 * with no signature, is refused with why first (the owner's test of 2026-11-23).
 */
async function signedByGovBr(envelope: string, bytes: Uint8Array): Promise<string> {
  const { finishLinkUpload } = await import("@/lib/cases/client-uploads");
  const send = async (file: Uint8Array) => {
    const reserved = await ok(
      await anon().rpc("client_link_reserve_signed", {
        target_token: TOKEN,
        target_envelope: envelope,
        target_name: "assinado.pdf",
        target_mime: "application/pdf",
        target_bytes: file.length,
      }),
    );
    bucket.set(String(reserved.storage_path), file);
    const finished = await finishLinkUpload(anon() as never, backend() as never, TOKEN, String(reserved.document_id));
    return { documentId: String(reserved.document_id), finished };
  };
  const unsigned = await send(bytes);
  expect(unsigned.finished).toEqual({ ok: false, code: "paper_unsigned" });
  const [kept] = await sql.unsafe(`select count(*)::integer as n from public.case_documents where id = $1`, [
    unsigned.documentId,
  ]);
  expect(kept).toEqual({ n: 0 });
  const signed = await send(signedPdf(bytes));
  expect(signed.finished.ok, JSON.stringify(signed.finished)).toBe(true);
  await ok(
    await as(ANA).rpc("confirm_signature", {
      target_envelope: envelope,
      target_document: signed.documentId,
    }),
  );
  return signed.documentId;
}

describe.skipIf(!DB_URL)("a bill in the mother's name, declared and signed", () => {
  let caseId = "";
  let maria = "";

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@residencia-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-residencia-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.oab_registrations (user_id, uf, number, kind) values ('${ANA}', 'GO', '93001', 'principal');
      insert into public.firm_signers (org_id, user_id, added_by) values ('${FIRM}', '${ANA}', '${ANA}');
    `);
    const opened = await as(ANA).rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-01-10",
      target_client: { full_name: "Maria Teste", birth_date: "1985-04-02", phone: "5500999990193" },
    });
    expect(opened.error).toBeNull();
    caseId = String((opened.data as Row).case_id);
    const [person] = await sql.unsafe(`select person_id from public.case_parties where case_id = $1`, [caseId]);
    maria = String(person.person_id);
    // What a power of attorney writes of who grants it, but the address, which the bill gives.
    await sql.unsafe(
      `update public.people set cpf = '52998224725', nationality = 'brasileira', marital_status = 'solteiro',
         profession = 'Professora' where id = $1`,
      [maria],
    );
    await ok(
      await as(ANA).rpc("create_client_link", {
        target_case: caseId,
        target_person: maria,
        target_token_hash: createHash("sha256").update(TOKEN, "utf8").digest("hex"),
      }),
    );
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("accepts the bill in her mother's name, writes its address and asks Maria who the holder is", async () => {
    await sql.unsafe(
      `insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256,
                                 bytes, detected_mime, pages, expires_at, confirmed_at)
       values ($1, $2, 'client', 'org/x/conta', 'conta.pdf', 'application/pdf', 100, 'stored', $3, 100,
               'application/pdf', 1, now() + interval '1 hour', now())`,
      [BILL, FIRM, "c".repeat(64)],
    );
    await sql.unsafe(
      `insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status)
       select $1, $2, $3, cp.id, $1, 'address_proof', 'client', 'received'
       from public.case_parties cp where cp.case_id = $3`,
      [BILL, FIRM, caseId],
    );
    const [run] = await sql.unsafe(
      `insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, finished_at,
                                   subject_type, subject_id)
       values ($1, 'caso.documento.conferencia',
               (select v.id from public.prompt_versions v where v.task = 'caso.documento.conferencia' and v.is_active),
               'fake', 'fake', $2, 'succeeded', now(), 'case_document', $3)
       returning id`,
      [FIRM, "a".repeat(64), BILL],
    );
    const answer = {
      decisao: "aceitar",
      motivo: "",
      tipo_identificado: "conta de luz",
      legivel: true,
      nome_no_documento: "JOANA TESTE",
      confere_com_a_pessoa: "nao",
      dados_lidos: {
        nome_completo: "",
        cpf: "",
        data_nascimento: "",
        nacionalidade: "",
        cep: "74000000",
        logradouro: "RUA DAS FLORES",
        numero: "10",
        complemento: "",
        bairro: "CENTRO",
        cidade: "GOIÂNIA",
        uf: "GO",
      },
      observacoes: "",
      trechos: [],
    };
    const [applied] = await sql.unsafe(`select public.apply_document_check($1, $2::text::jsonb, 'ai') as code`, [
      run.id,
      JSON.stringify(answer),
    ]);
    expect(applied.code).toBe("accepted");

    const { residenceViewsOf } = await import("@/lib/cases/residence");
    const read = await as(ANA).rpc("case_residence", { target_case: caseId });
    expect(read.error).toBeNull();
    expect(residenceViewsOf(read.data)).toEqual([
      expect.objectContaining({
        holder: "Joana Teste",
        holderRead: "JOANA TESTE",
        standing: "asking",
        documentId: BILL,
      }),
    ]);
    const [person] = await sql.unsafe(`select street, city, postal_code from public.people where id = $1`, [maria]);
    expect(person).toEqual({ street: "Rua das Flores", city: "Goiânia", postal_code: "74000000" });

    const asked = await anon().rpc("client_link_residence", { target_token: TOKEN });
    expect(asked.error).toBeNull();
    const item = (asked.data as { items: Row[] }).items[0];
    expect(item).toMatchObject({ holder: "Joana Teste", issued: false });
    await ok(
      await backend().rpc("client_link_answer_residence", {
        target_token: TOKEN,
        target_declaration: String(item.id),
        target_relation: "mae",
        target_note: null,
        target_holder: "",
        target_evidence: { ip: "203.0.113.9" },
      }),
    );
  });

  it("issues the declaration beside the power of attorney once Maria finished, each a PDF to sign by gov.br", async () => {
    await ok(await anon().rpc("client_link_finish", { target_token: TOKEN }));
    await carry(caseId);
    const papers = await sql.unsafe(
      `select p.kind, e.method, e.status, f.name, f.storage_path, d.kind as document_kind from public.case_papers p
       join public.signature_envelopes e on e.id = p.envelope_id
       join public.case_documents d on d.id = p.document_id
       join public.files f on f.id = d.file_id
       where p.case_id = $1 order by p.kind`,
      [caseId],
    );
    expect(papers.map((paper) => [paper.kind, paper.method, paper.status, paper.document_kind])).toEqual([
      ["declaracao_residencia", "govbr", "pending", "residence_declaration"],
      ["procuracao", "govbr", "pending", "power_of_attorney"],
    ]);
    expect(String(papers[0].name)).toMatch(/^declaracao-de-residencia-maria-teste/);
    const pdf = bucket.get(String(papers[0].storage_path));
    expect(pdf && new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
  });

  it("waits for the signed declaration, then lets the lawsuit's package take it", async () => {
    // A planned lawsuit of the case, its system approved, and the petition a lawyer accepted.
    await sql.unsafe(
      `insert into public.proceedings (id, org_id, case_id, kind, court, status)
       values ($1, $2, $3, 'juizado', 'TJGO', 'planned')`,
      [LAWSUIT, FIRM, caseId],
    );
    await sql.unsafe(
      `update public.proceedings set system = 'projudi', system_approved_at = now(), system_approved_by = $2
       where id = $1`,
      [LAWSUIT, ANA],
    );
    await sql.unsafe(
      `insert into public.proceeding_parties (proceeding_id, party_id, org_id)
       select $1, cp.id, $2 from public.case_parties cp where cp.case_id = $3`,
      [LAWSUIT, FIRM, caseId],
    );
    await sql.unsafe(
      `insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256,
                                 bytes, detected_mime, pages, expires_at, confirmed_at)
       values ($1, $2, 'petition', 'org/x/peticao', 'peticao.pdf', 'application/pdf', 100, 'stored', $3, 100,
               'application/pdf', 1, now() + interval '1 hour', now())`,
      [PETITION, FIRM, "e".repeat(64)],
    );
    await sql.unsafe(
      `insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at)
       values ($1, $2, $3, $1, 'petition', 'firm', 'accepted', now())`,
      [PETITION, FIRM, caseId],
    );
    const envelopes = await sql.unsafe(
      `select p.kind, p.envelope_id, f.storage_path from public.case_papers p
       join public.case_documents d on d.id = p.document_id
       join public.files f on f.id = d.file_id
       where p.case_id = $1`,
      [caseId],
    );
    const of = (kind: string) => envelopes.find((row) => row.kind === kind) as Row;

    // The power of attorney signed first: the filing still waits for the declaration.
    await signedByGovBr(String(of("procuracao").envelope_id), bucket.get(String(of("procuracao").storage_path))!);
    const waiting = await as(ANA).rpc("request_filing_package", {
      target_proceeding: LAWSUIT,
      target_petition: PETITION,
      target_documents: [],
    });
    expect(waiting.data).toMatchObject({ ok: false, code: "residence_declaration_unsigned" });

    const signed = await signedByGovBr(
      String(of("declaracao_residencia").envelope_id),
      bucket.get(String(of("declaracao_residencia").storage_path))!,
    );
    const [document] = await sql.unsafe(
      `select d.kind, d.status, cp.person_id from public.case_documents d
       join public.case_parties cp on cp.id = d.party_id where d.id = $1`,
      [signed],
    );
    expect(document).toEqual({ kind: "residence_declaration", status: "accepted", person_id: maria });

    const { residenceViewsOf } = await import("@/lib/cases/residence");
    const read = await as(ANA).rpc("case_residence", { target_case: caseId });
    expect(residenceViewsOf(read.data)[0]).toMatchObject({ standing: "signed", relation: "mae" });

    const requested = await ok(
      await as(ANA).rpc("request_filing_package", {
        target_proceeding: LAWSUIT,
        target_petition: PETITION,
        target_documents: [BILL, signed],
      }),
    );
    const [packaged] = await sql.unsafe(`select document_ids from public.filing_packages where id = $1`, [
      String(requested.package_id),
    ]);
    expect(packaged.document_ids).toEqual(expect.arrayContaining([BILL, signed]));
  });
});
