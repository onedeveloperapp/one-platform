// @vitest-environment node
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * The passenger of a travel agency, from the agency's area to the firm's case, with the app's own code against a
 * real database (migrations 0070 and 0071): the agency registers the passenger, the trip and the identity, which
 * the backend measures and ONE reads (the firm never reads that run); the passenger agrees on the agency's link
 * with the test chat's number, so the firm's test chat follows the trip; the flight is cancelled, ONE tells the
 * passenger, the passenger taps SIM, and ONE opens the case with the agency's record: the data, the document as
 * the case's (the firm's file now, never again the agency's) and what ONE read marked as read.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped. What
 * stands in is the transport, the bucket (in memory), the model (the fake provider of `@flyee/ai`, told what the
 * identity says) and the vendor (the test chat's own number).
 *
 * Every person, firm, agency, number and CPF here is invented; the CPF is one manuals use as an example.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["user-agent", "Navegador de teste"]]) }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));
vi.mock("@/lib/whatsapp/session", () => ({ isSupportVisit: async () => false }));

/** The model, told what the passenger's identity says, and what it was handed. */
const model = vi.hoisted(() => ({ asked: [] as string[] }));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (_output, messages) => {
        model.asked.push(messages.map((message) => String(message.content ?? "")).join(" "));
        return {
          confere_tipo: "sim",
          tipo_identificado: "RG",
          legivel: true,
          nome_no_documento: "RAFAELA TESTE LIMA",
          dados_lidos: {
            nome_completo: "Rafaela Teste Lima",
            cpf: "52998224725",
            data_nascimento: "1990-04-12",
            nacionalidade: "brasileira",
            cep: "",
            logradouro: "",
            numero: "",
            complemento: "",
            bairro: "",
            cidade: "",
            uf: "",
          },
          trechos: [],
          observacoes: "",
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
vi.mock("@/lib/public-content", () => ({ createAnonClient: () => clientAs("anon", { role: "anon" }) }));

const ANA = "ae710000-0000-4000-8000-000000000001";
const DUDA = "ae710000-0000-4000-8000-000000000003";
const FIRM = "be710000-0000-4000-8000-00000000000a";
const AGENCY = "ce710000-0000-4000-8000-00000000000a";
const PARTNERSHIP = "de710000-0000-4000-8000-00000000000a";
const CONNECTION = "fe710000-0000-4000-8000-00000000000a";
const CHAT_TOKEN = "v".repeat(43);
const LINK_TOKEN = "acordo-da-rafaela-para-o-teste-de-ponta-a-ponta-01";

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });

async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Row> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Row;
}

/** A page of a PDF, as an agency's scan of an identity would be. */
async function paper(words: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]).drawText(words, { x: 60, y: 760 });
  return pdf.save();
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

describe.skipIf(!DB_URL)("an agency's passenger, from the agency's area to the firm's case", () => {
  let debounce: unknown = null;
  let traveler = "";
  let fileId = "";
  let tripId = "";

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    process.env.AI_FAKE_PROVIDER = "1";
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from public.partners where id = '${AGENCY}';
      delete from auth.users where id in ('${ANA}', '${DUDA}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@agencia-ponta.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${DUDA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'duda@agencia-ponta.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-agencia-ponta', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
        ('${CONNECTION}', '${FIRM}', 'whatsapp', 'test-waba-agencia', 'Chat de teste', 'connected', '${ANA}', now());
      insert into public.partners (id, name) values ('${AGENCY}', 'Viagens Sol');
      insert into public.partner_members (partner_id, user_id, role) values ('${AGENCY}', '${DUDA}', 'owner');
      insert into public.partner_links (id, partner_id, org_id, module_key) values
        ('${PARTNERSHIP}', '${AGENCY}', '${FIRM}', 'direito-do-passageiro');
    `);
    // ONE answers as soon as the passenger wrote: a test is one moment, and the setting's wait is a few seconds.
    [{ debounce }] = await sql.unsafe(
      `select value -> 'debounce_seconds' as debounce from public.platform_settings where key = 'conversation_agent'`,
    );
    await sql.unsafe(
      `update public.platform_settings set value = jsonb_set(value, '{debounce_seconds}', '0') where key = 'conversation_agent'`,
    );
    const number = await call(backend(), "register_wa_number", {
      target_org: FIRM,
      target_connection: CONNECTION,
      target_provider: "test",
      target_phone_number_id: "test-number-agencia",
      target_waba_id: "test-waba-agencia",
      target_display_phone_number: "5500900000071",
      target_verified_name: "Souza Advogados",
      target_mode: "cloud",
    });
    expect(number.ok).toBe(true);
    const started = await call(backend(), "start_test_chat", {
      target_org: FIRM,
      target_number: number.number_id,
      target_token: CHAT_TOKEN,
      target_by: ANA,
    });
    expect(started.ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_PROVIDER;
    if (!sql) return;
    if (debounce !== null && debounce !== undefined) {
      await sql.unsafe(
        `update public.platform_settings set value = jsonb_set(value, '{debounce_seconds}', $1::jsonb) where key = 'conversation_agent'`,
        [JSON.stringify(debounce)],
      );
    }
    // Nothing of this file is left for another file's sweep to find.
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from public.partners where id = '${AGENCY}'`);
    await sql.unsafe(`delete from auth.users where id in ('${ANA}', '${DUDA}')`);
    await sql.end({ timeout: 5 });
  });

  it("registers the passenger, the trip and the identity, which ONE reads for the agency alone", async () => {
    const clause = await call(as(DUDA), "pax_save_consent_term", {
      target_partner: AGENCY,
      target_body: "Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.",
    });
    expect(clause.code).toBe("saved");
    const saved = await call(as(DUDA), "pax_save_traveler", {
      target_partnership: PARTNERSHIP,
      target_traveler: null,
      target_fields: { full_name: "Rafaela Teste", phone: "(00) 98888-0006", email: "rafaela@teste.invalid" },
      target_guardian: null,
    });
    traveler = String(saved.traveler_id);
    const trip = await call(as(DUDA), "pax_save_trip", {
      target_partnership: PARTNERSHIP,
      target_trip: null,
      target_holder: traveler,
      target_travelers: [],
      target_locator: "abc123",
      target_legs: [
        {
          flight_number: "LA3456",
          origin_iata: "GRU",
          destination_iata: "REC",
          departure: `${today()}T08:10`,
          arrival: `${today()}T11:25`,
        },
      ],
    });
    expect(trip.code).toBe("added");

    const bytes = await paper("Identidade de teste");
    const reserved = await call(as(DUDA), "pax_reserve_document", {
      target_traveler: traveler,
      target_kind: "identity",
      target_trip: null,
      target_name: "rg-rafaela.pdf",
      target_mime: "application/pdf",
      target_bytes: bytes.byteLength,
    });
    expect(reserved.code).toBe("reserved");
    fileId = String(reserved.file_id);
    bucket.set(String(reserved.storage_path), bytes);
    const { finishPaxUpload } = await import("@/modules/direito-do-passageiro/agency/uploads");
    expect(await finishPaxUpload(backend() as never, fileId, { partnerId: AGENCY })).toMatchObject({
      ok: true,
      code: "pending",
    });

    const { readPaxDocuments } = await import("@/modules/direito-do-passageiro/agency/reading-work");
    expect(await readPaxDocuments(backend() as never, 5)).toEqual({ done: 1, other: 0 });
    expect(model.asked.join(" ")).toContain("documento de identidade");

    const [record] = await sql.unsafe(
      `select full_name, cpf, birth_date::text as birth, nationality, read_fields from public.pax_travelers where id = $1`,
      [traveler],
    );
    expect(record).toMatchObject({
      full_name: "Rafaela Teste Lima",
      cpf: "52998224725",
      birth: "1990-04-12",
      nationality: "brasileira",
    });
    expect(Object.keys(record.read_fields as Row).sort()).toEqual(["birth_date", "cpf", "full_name", "nationality"]);

    // The firm never reads what ONE read for the agency.
    const runs = await as(ANA).from("ai_runs").select("id").eq("task", "parceiro.documento.leitura");
    expect(runs.data ?? []).toHaveLength(0);
  });

  it("follows the trip in the firm's test chat once the passenger agrees on the agency's link", async () => {
    const issued = await call(as(DUDA), "pax_issue_confirm_link", {
      target_traveler: traveler,
      target_token_hash: createHash("sha256").update(LINK_TOKEN, "utf8").digest("hex"),
    });
    expect(issued.code).toBe("issued");
    const { openAgreement } = await import("@/modules/direito-do-passageiro/agency/link");
    const view = await openAgreement(LINK_TOKEN);
    expect(view?.state).toBe("open");
    const wording = view && view.state === "open" ? (view.wording ?? "") : "";
    expect(wording).toContain("Viagens Sol");

    const { answerAgreement } = await import("@/modules/direito-do-passageiro/agency/link-actions");
    expect(await answerAgreement({ token: LINK_TOKEN, answer: "agreed", wording, phone: null })).toEqual({
      ok: true,
      code: "agreed",
      followed: 1,
    });

    const { readTestChat } = await import("@/lib/test-chat/actions");
    const read = await readTestChat(CHAT_TOKEN);
    expect(read.ok).toBe(true);
    const agencyTrip = read.ok ? read.view.trips.find((item) => item.label === "agencia") : undefined;
    expect(agencyTrip?.passengerName).toBe("Rafaela Teste Lima");
    tripId = agencyTrip?.id ?? "";
  });

  it("opens the case at the passenger's yes with the agency's record, the document now the firm's", async () => {
    const { runTestTool, sendTestMessage } = await import("@/lib/test-chat/actions");
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    expect(await runTestTool(CHAT_TOKEN, tripId, "cancel")).toEqual({ ok: true, code: "told" });
    expect(await sendTestMessage(CHAT_TOKEN, tripId, { reply: "SIM" })).toEqual({ ok: true, code: "delivered" });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, opened: 1 });

    const [opened] = await sql.unsafe(
      `select c.id, c.origin, c.partnership_id, p.full_name, p.cpf, p.birth_date::text as birth, p.nationality,
              p.email, p.phone, p.read_fields
       from public.cases c
       join public.case_parties cp on cp.case_id = c.id and cp.role = 'claimant'
       join public.people p on p.id = cp.person_id
       where c.org_id = $1`,
      [FIRM],
    );
    expect(opened).toMatchObject({
      origin: "agency",
      partnership_id: PARTNERSHIP,
      full_name: "Rafaela Teste Lima",
      cpf: "52998224725",
      birth: "1990-04-12",
      nationality: "brasileira",
      email: "rafaela@teste.invalid",
      phone: "5500988880006",
    });

    const documents = await sql.unsafe(
      `select d.id, d.source, d.status, d.processing, f.partner_id from public.case_documents d
       join public.files f on f.id = d.file_id where d.case_id = $1`,
      [opened.id],
    );
    expect(documents).toEqual([
      { id: expect.any(String), source: "partner", status: "received", processing: "pending", partner_id: null },
    ]);
    // What ONE read of the agency's identity is marked as read of the case's document.
    expect((opened.read_fields as Record<string, { document: string }>).nationality.document).toBe(documents[0].id);

    // The firm reads the file now, and the agency no longer.
    const firmReads = await as(ANA).from("files").select("id").eq("id", fileId);
    const agencyReads = await as(DUDA).from("files").select("id").eq("id", fileId);
    expect(firmReads.data ?? []).toHaveLength(1);
    expect(agencyReads.data ?? []).toHaveLength(0);

    // The agency reads that its passenger is with the firm, and changes nothing of them any more.
    const detail = await call(as(DUDA), "pax_traveler_detail", { target_traveler: traveler });
    expect((detail.traveler as Row).handed_over_at).not.toBeNull();
    expect(((detail.trips as Row[])[0] as Row).state).toBe("case_opened");
    const changed = await call(as(DUDA), "pax_save_traveler", {
      target_partnership: PARTNERSHIP,
      target_traveler: traveler,
      target_fields: { email: "outro@teste.invalid" },
      target_guardian: null,
    });
    expect(changed.code).toBe("handed_over");
  });
});
