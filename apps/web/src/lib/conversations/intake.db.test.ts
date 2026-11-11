// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * Any passenger on the firm's WhatsApp (migration 0176), with the app's own worker against a real database, the test
 * number where the vendor stands and the model told what to answer: somebody who writes with no alert and no case
 * about a delay is asked what is missing, one question at a time; once nothing is, the rule qualifies it and ONE opens
 * the case with the client's link; a delay too short is told kindly and kept as not qualified; and a word that is no
 * problem with a flight goes to ONE's usual answer.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped.
 *
 * Every person, firm and number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

/** The model, told what to answer for the intake and for the conversation; and what it was handed. */
const model = vi.hoisted(() => ({
  intake: ((): unknown => ({})) as (briefing: string) => unknown,
  conversation: ((): unknown => ({})) as (briefing: string) => unknown,
  briefings: [] as string[],
}));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (_output, messages) => {
        const briefing = messages.map((message) => String(message.content ?? "")).join("\n");
        model.briefings.push(briefing);
        return briefing.includes("fatos_anotados") ? model.intake(briefing) : model.conversation(briefing);
      });
    }
  }
  return { ...real, FakeChatProvider: ToldProvider };
});

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae976000-0000-4000-8000-000000000001";
const FIRM = "be976000-0000-4000-8000-00000000000a";
const CONNECTION = "de976000-0000-4000-8000-00000000000a";
const LUCAS = "5500988880007";
const RITA = "5500988880008";
const BETO = "5500988880009";
let numberId = "";

async function call(name: string, args: Row): Promise<Row> {
  const { data, error } = await backend().rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Row;
}

/** The passenger writes, as the inbox takes a message. */
const writes = (phone: string, body: string) =>
  call("wa_ingest_inbound", {
    target_org: FIRM,
    target_number: numberId,
    target_contact: phone,
    target_contact_name: "Passageiro",
    target_wa_message_id: `test.in.${crypto.randomUUID()}`,
    target_kind: "text",
    target_body: body,
  });

/** What the firm sent a passenger, oldest first. */
const sentTo = async (phone: string) =>
  (
    await sql.unsafe(
      `select m.body from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
       where m.org_id = $1 and c.contact_wa_id = $2 and m.direction = 'out' order by m.created_at, m.id`,
      [FIRM, phone],
    )
  ).map((row) => String(row.body));

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

describe.skipIf(!DB_URL)("any passenger on the firm's WhatsApp", () => {
  let debounce: unknown = null;

  beforeAll(async () => {
    process.env.AI_FAKE_PROVIDER = "1";
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@entrada.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-entrada-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
        ('${CONNECTION}', '${FIRM}', 'whatsapp', 'test-waba-entrada', 'Chat de teste', 'connected', '${ANA}', now());
    `);
    [{ debounce }] = await sql.unsafe(
      `select value -> 'debounce_seconds' as debounce from public.platform_settings where key = 'conversation_agent'`,
    );
    await sql.unsafe(
      `update public.platform_settings set value = jsonb_set(value, '{debounce_seconds}', '0') where key = 'conversation_agent'`,
    );
    const number = await call("register_wa_number", {
      target_org: FIRM,
      target_connection: CONNECTION,
      target_provider: "test",
      target_phone_number_id: "test-number-entrada",
      target_waba_id: "test-waba-entrada",
      target_display_phone_number: "5500900000076",
      target_verified_name: "Souza Advogados",
      target_mode: "cloud",
    });
    numberId = String(number.number_id);
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
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("asks what is missing of a delay one question at a time, and opens the case once nothing is", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const { INTAKE_OPENING } = await import("@/lib/conversations/intake");
    const empty = {
      companhia: "",
      voo: "",
      data: "",
      origem: "",
      destino: "",
      atraso_horas: "",
      aviso: "",
      nome: "",
      // Who referred the person (0183): the task's second version answers it, empty when nobody did.
      indicado_por: "",
    };
    model.intake = () => ({ assunto: "problema_voo", problema: "delay", ...empty });
    await writes(LUCAS, "Oi, meu voo atrasou muito ontem");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 1, failed: 0 });
    const first = await sentTo(LUCAS);
    expect(first).toHaveLength(1);
    expect(first[0].startsWith(INTAKE_OPENING)).toBe(true);
    expect(first[0]).toContain("Qual era o número do voo e a companhia aérea?");

    model.intake = () => ({
      assunto: "problema_voo",
      problema: "delay",
      ...empty,
      companhia: "LA",
      voo: "LA 3456",
      data: day(-1),
      origem: "GRU",
      destino: "REC",
      atraso_horas: "6",
      nome: "Lucas Teste Lima",
    });
    await writes(LUCAS, "Era o LA 3456 de Guarulhos para Recife, cheguei seis horas depois. Sou o Lucas Teste Lima");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ opened: 1, failed: 0 });
    const [opened] = await sql.unsafe(
      `select c.incident, c.airline_iata, c.flight_date::text as day, c.origin, p.full_name, p.phone,
              exists (select 1 from public.client_links l where l.case_id = c.id) as linked
       from public.cases c join public.case_parties cp on cp.case_id = c.id and cp.role = 'claimant'
       join public.people p on p.id = cp.person_id where c.org_id = $1`,
      [FIRM],
    );
    expect(opened).toEqual({
      incident: "delay",
      airline_iata: "LA",
      day: day(-1),
      origin: "organic",
      full_name: "Lucas Teste Lima",
      phone: LUCAS,
      linked: true,
    });
    const after = await sentTo(LUCAS);
    expect(after.some((body) => body.includes("/c/"))).toBe(true);
  });

  it("tells a delay too short kindly, and keeps the person as not qualified", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    model.intake = () => ({
      assunto: "problema_voo",
      problema: "delay",
      companhia: "G3",
      voo: "G3 1450",
      data: day(-2),
      origem: "BSB",
      destino: "GIG",
      atraso_horas: "2",
      aviso: "",
      nome: "Rita Teste",
      indicado_por: "",
    });
    await writes(RITA, "Meu voo G3 1450 de Brasília para o Rio atrasou duas horas anteontem. Rita Teste");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, opened: 0, failed: 0 });
    const [kept] = await sql.unsafe(
      `select f.point from public.people p join public.people_funnel($1) f on f.person_id = p.id
       where p.org_id = $1 and p.full_name = 'Rita Teste'`,
      [FIRM],
    );
    expect(kept).toEqual({ point: "nao_qualificado" });
    expect(await sentTo(RITA)).toHaveLength(1);
    const [cases] = await sql.unsafe(`select count(*)::int as n from public.cases where org_id = $1`, [FIRM]);
    expect(cases.n).toBe(1);
  });

  it("leaves what is no problem with a flight to ONE's usual answer", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    model.intake = () => ({
      assunto: "outro",
      problema: "",
      companhia: "",
      voo: "",
      data: "",
      origem: "",
      destino: "",
      atraso_horas: "",
      aviso: "",
      nome: "",
      indicado_por: "",
    });
    model.conversation = () => ({
      intencao: "pergunta",
      resposta: "Bom dia. Em que o escritório pode ajudar?",
      chamar_pessoa: null,
    });
    await writes(BETO, "Bom dia");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 1, failed: 0 });
    expect(await sentTo(BETO)).toEqual(["Bom dia. Em que o escritório pode ajudar?"]);
  });
});
