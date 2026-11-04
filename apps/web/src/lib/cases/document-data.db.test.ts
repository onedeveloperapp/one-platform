// @vitest-environment node
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * What a client's documents say of them, with the app's own code against a
 * real database (migration 0063): the client sends their identity and a
 * proof of address through their link, the backend's sweep checks each with
 * the AI (the second version of the task's instructions, which reads what a
 * document says of its person), ONE accepts them, and the client's link shows
 * the data filled in and said as read from the documents, the client left to
 * confirm them and to complete what no document says.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, the bucket (in memory) and the model (the fake provider of
 * `@flyee/ai`, told here what each document says).
 *
 * Every person, firm, token and CPF here is invented; the CPF is one manuals
 * use as an example.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

/** The model, told what each document says, and what it was handed. */
const model = vi.hoisted(() => ({ asked: [] as { schema: Record<string, unknown>; text: string }[] }));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  const empty = {
    nome_completo: "",
    cpf: "",
    data_nascimento: "",
    nacionalidade: "",
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
  };
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (output, messages) => {
        const text = messages.map((message) => message.content).join(" ");
        model.asked.push({ schema: output.schema, text });
        const identity = text.includes("documento de identidade");
        return {
          decisao: "aceitar",
          motivo: "",
          tipo_identificado: identity ? "RG" : "conta de luz",
          legivel: true,
          nome_no_documento: "MARIA TESTE DE SOUZA",
          confere_com_a_pessoa: "sim",
          dados_lidos: identity
            ? {
                ...empty,
                nome_completo: "Maria Teste de Souza",
                cpf: "529.982.247-25",
                data_nascimento: "1985-04-02",
                nacionalidade: "brasileira",
              }
            : // As a bill prints it: in capitals, which the database writes as names (0065).
              {
                ...empty,
                cep: "74000-000",
                logradouro: "RUA DAS FLORES",
                numero: "10",
                bairro: "CENTRO",
                cidade: "GOIÂNIA",
                uf: "GO",
              },
          observacoes: "",
          trechos: [],
          // The purchase and the expense the check reads of a ticket and a receipt (0091): none on these papers.
          compra: { data: "", canal: "", valor: "", reserva: "" },
          gasto: { descricao: "", valor: "", data: "" },
        };
      });
    }
  }
  return { ...real, FakeChatProvider: ToldProvider };
});

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const bucket = new Map<string, Uint8Array>();

const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ad680000-0000-4000-8000-000000000001";
const DAVI = "ad680000-0000-4000-8000-000000000004";
const FIRM = "bd680000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "bd680000-0000-4000-8000-00000000000b";
const TOKEN = "token-da-maria-para-os-dados-dos-documentos-0001";

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

/** A page of a PDF, as a client's scan of a paper would be. */
async function paper(words: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]).drawText(words, { x: 60, y: 760 });
  return pdf.save();
}

describe.skipIf(!DB_URL)("what a client's documents say of them", () => {
  let caseId = "";
  let partyId = "";
  let personId = "";

  /** The client sends a paper on their link, as the link's own actions do: reserved, the bytes, kept. */
  async function send(kind: string, bytes: Uint8Array): Promise<string> {
    const reserved = await call(asClient(), "client_link_reserve_upload", {
      target_token: TOKEN,
      target_kind: kind,
      target_party: partyId,
      target_name: `${kind}.pdf`,
      target_mime: "application/pdf",
      target_bytes: bytes.byteLength,
    });
    expect(reserved.code).toBe("reserved");
    bucket.set(String(reserved.storage_path), bytes);
    const { finishLinkUpload } = await import("@/lib/cases/client-uploads");
    expect(
      await finishLinkUpload(asClient() as never, backend() as never, TOKEN, String(reserved.document_id)),
    ).toEqual({ ok: true, code: "received" });
    return String(reserved.document_id);
  }

  /** The client's page, as it reads the link. */
  async function page() {
    const opened = await call(asClient(), "client_link_open", { target_token: TOKEN });
    expect(opened.status).toBe("open");
    return opened as Row & { people: Row[]; documents: Row[]; required_documents: unknown[] };
  }

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    process.env.AI_FAKE_PROVIDER = "1";
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${DAVI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@dados.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${DAVI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'davi@dados.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-dados-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Rocha Advocacia', 'rocha-dados-app', '${DAVI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${DAVI}', 'owner', 'advogado');
    `);
    const opened = await call(asAna(), "create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: null,
      target_client: { full_name: "Maria Teste", phone: "5562999990001" },
    });
    caseId = String(opened.case_id);
    partyId = String(opened.party_id);
    personId = String(opened.person_id);
    const hash = createHash("sha256").update(TOKEN, "utf8").digest("hex");
    const link = await call(asAna(), "create_client_link", {
      target_case: caseId,
      target_person: personId,
      target_token_hash: hash,
    });
    expect(link.code).toBe("created");
  }, 120_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_PROVIDER;
    // Nothing of this file is left for another file's sweep to find.
    await sql?.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    await sql?.unsafe(`delete from auth.users where id in ('${ANA}', '${DAVI}')`);
    await sql?.end({ timeout: 5 });
  });

  it("asks the client for the documents first, before the data the documents will tell", async () => {
    const { missingItems } = await import("@/lib/cases/cases");
    const view = await page();
    const holder = view.people[0] as never as Parameters<typeof missingItems>[0]["holder"];
    const missing = missingItems({
      holder,
      claimants: [holder],
      documents: [],
      segments: 0,
      required: view.required_documents as never,
      today: "2026-10-27",
    });
    expect(missing.map((item) => item.type)).toEqual(["document", "document", "document", "fields", "flight"]);
  });

  it("fills the client's data from the identity ONE accepted, and says they were read there", async () => {
    const { processCaseDocuments } = await import("@/lib/cases/documents-work");
    const { readFieldsOf, readItems } = await import("@/lib/cases/read-fields");
    const documentId = await send("identity", await paper("Carteira de identidade de exemplo"));

    // While the sweep has not read it, the page says the document is still being read.
    const { beingRead } = await import("@/lib/cases/read-fields");
    const before = await page();
    expect(beingRead([partyId], before.documents as never)).toBe(true);

    expect(await processCaseDocuments(backend() as never, 5, documentId)).toEqual({ done: 1, other: 0 });
    // The model was handed the second version of the task, which asks what the document says of its person.
    const asked = model.asked.at(-1);
    expect(asked?.text).toContain("documento de identidade");
    expect(Object.keys((asked?.schema.properties ?? {}) as Row)).toContain("dados_lidos");

    const after = await page();
    const maria = after.people.find((person) => person.person_id === personId) as Row;
    expect([maria.full_name, maria.cpf, maria.birth_date, maria.nationality]).toEqual([
      "Maria Teste de Souza",
      "52998224725",
      "1985-04-02",
      "brasileira",
    ]);
    expect(readItems(readFieldsOf(maria.read_fields))).toEqual(["full_name", "cpf", "birth_date", "nationality"]);
    expect(beingRead([partyId], after.documents as never)).toBe(false);
    expect((after.documents as Row[]).find((document) => document.id === documentId)?.status).toBe("accepted");
  });

  it("fills the address from the proof of address, whole, and leaves the client what no paper says", async () => {
    const { processCaseDocuments } = await import("@/lib/cases/documents-work");
    const { readFieldsOf, readItems } = await import("@/lib/cases/read-fields");
    const { missingFields, ADULT_FIELDS } = await import("@/lib/cases/cases");
    const documentId = await send("address_proof", await paper("Conta de luz de exemplo"));
    expect(await processCaseDocuments(backend() as never, 5, documentId)).toEqual({ done: 1, other: 0 });

    const view = await page();
    const maria = view.people.find((person) => person.person_id === personId) as Row;
    expect([maria.postal_code, maria.street, maria.address_number, maria.district, maria.city, maria.uf]).toEqual([
      "74000000",
      "Rua das Flores",
      "10",
      "Centro",
      "Goiânia",
      "GO",
    ]);
    expect(readItems(readFieldsOf(maria.read_fields))).toEqual([
      "full_name",
      "cpf",
      "birth_date",
      "nationality",
      "address",
    ]);
    // What the client still writes: what no document says of a person.
    expect(missingFields(maria as never, ADULT_FIELDS)).toEqual(["marital_status", "profession"]);
  });

  it("lets the client correct what was read, and the mark of that field goes", async () => {
    const saved = await call(asClient(), "client_link_save_person", {
      target_token: TOKEN,
      target_person: personId,
      target_fields: { address_number: "12", marital_status: "solteiro" },
    });
    expect(saved.code).toBe("saved");
    const { readFieldsOf } = await import("@/lib/cases/read-fields");
    const maria = (await page()).people.find((person) => person.person_id === personId) as Row;
    const marks = readFieldsOf(maria.read_fields);
    expect(marks.address_number).toBeUndefined();
    expect(marks.street?.kind).toBe("address_proof");
    expect(marks.cpf?.kind).toBe("identity");
  });

  it("tells it in the case's timeline by the names of the fields, and another firm reads nothing of it", async () => {
    const events = await sql.unsafe(
      `select actor_type, data from public.case_events where case_id = $1 and kind = 'person_read' order by at`,
      [caseId],
    );
    expect(events.map((event) => event.actor_type)).toEqual(["ai", "ai"]);
    expect(JSON.stringify(events)).not.toContain("52998224725");
    const { data } = await asDavi().from("people").select("id, read_fields").eq("id", personId);
    expect(data ?? []).toEqual([]);
  });
});
