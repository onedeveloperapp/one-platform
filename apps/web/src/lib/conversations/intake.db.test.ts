// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * Any passenger on the firm's WhatsApp (migrations 0176 and 0227), with the app's own worker against a real database,
 * the test number where the vendor stands and the model told what to answer: somebody who writes with no alert and no
 * case about a delay is asked what is missing, one question at a time, the name first; once nothing is, ONE sums it up,
 * the person confirms, the rule qualifies it, ONE offers to go on, and the case opens with the client's link only at
 * their yes; a no is kept kindly and a later word brings the offer back; a delay too short is told kindly and kept as
 * not qualified; and a word that is no problem with a flight goes to ONE's usual answer.
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
const DORA = "5500988880010";
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

  it("asks what is missing one question at a time, sums it up, and opens the case only at the person's yes", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const { intakeOpening } = await import("@/lib/conversations/intake");
    const empty = {
      companhia: "",
      voo: "",
      data: "",
      origem: "",
      destino: "",
      atraso_horas: "",
      aviso: "",
      nome: "",
      // Who referred the person (0183) and who travelled along (0227), empty when not told.
      indicado_por: "",
      acompanhantes: "",
    };
    const countCases = async () =>
      Number((await sql.unsafe(`select count(*)::int as n from public.cases where org_id = $1`, [FIRM]))[0].n);
    model.intake = () => ({ assunto: "problema_voo", problema: "delay", ...empty });
    await writes(LUCAS, "Oi, meu voo atrasou muito ontem");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 1, failed: 0 });
    const first = await sentTo(LUCAS);
    expect(first).toHaveLength(1);
    expect(first[0].startsWith(intakeOpening("Souza Advogados"))).toBe(true);
    expect(first[0]).toContain("Sinto muito pelo atraso. Como posso te chamar?");

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
      acompanhantes: "nenhum",
    });
    await writes(
      LUCAS,
      "Sou o Lucas Teste Lima. Era o LA 3456 de Guarulhos para Recife, cheguei seis horas depois, sozinho",
    );
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ answered: 1, opened: 0, failed: 0 });
    const summary = (await sentTo(LUCAS)).at(-1) ?? "";
    expect(summary).toContain("Confere, Lucas.");
    expect(summary).toContain("Só você viajou. Está certo?\n1. Está certo\n2. Corrigir");
    expect(await countCases()).toBe(0);

    await writes(LUCAS, "1");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ answered: 1, opened: 0, failed: 0 });
    expect((await sentTo(LUCAS)).at(-1)).toContain("Quer que o escritório siga com o seu caso?\n1. Quero seguir");
    expect(await countCases()).toBe(0);

    await writes(LUCAS, "Quero seguir");
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
    const steps = (await sentTo(LUCAS)).find((body) => body.includes("O seu caso está aberto")) ?? "";
    expect(steps).toContain("Pronto, Lucas. O seu caso está aberto no escritório Souza Advogados.");
    expect(steps).toContain("Agora mande aqui a foto do seu documento de identidade");
    // No link and no case number while ONE asks the first document (0236).
    expect(steps).not.toMatch(/\/c\/|número \d/);
  });

  it("has Lucas check his data in the chat once his documents were accepted, and asks what no document gives", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const { startOwedDataChecks } = await import("@/lib/conversations/data-check-work");
    // His identity and proof of address were accepted, and ONE read what they say (0063).
    await sql.unsafe(
      `with c as (select cp.case_id, cp.id as party_id, cp.person_id from public.case_parties cp
                  join public.cases k on k.id = cp.case_id where k.org_id = $1),
            f as (insert into public.files (org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
                  select $1, 'whatsapp', 'org/' || $1 || '/whatsapp/' || x.kind, x.kind || '.jpg', 'image/jpeg', 100, 'stored', x.sha, 100, 'image/jpeg', now() + interval '1 hour', now()
                  from (values ('identity', repeat('7', 64)), ('address_proof', repeat('8', 64))) as x (kind, sha)
                  returning id, name)
       insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, decided_at)
       select $1, c.case_id, c.party_id, f.id, replace(f.name, '.jpg', ''), 'whatsapp', 'accepted', now() from c, f`,
      [FIRM],
    );
    await sql.unsafe(
      `update public.people set cpf = '52998224725', birth_date = '1990-03-14', nationality = 'brasileira',
         postal_code = '74000000', street = 'Rua Exemplo', address_number = '100', district = 'Setor Teste',
         city = 'Goiânia', uf = 'GO', read_fields = '{"cpf": {"kind": "identity"}}'::jsonb
       where org_id = $1 and full_name = 'Lucas Teste Lima'`,
      [FIRM],
    );
    expect(await startOwedDataChecks(backend() as never)).toEqual({ started: 1 });
    const summary = (await sentTo(LUCAS)).at(-1) ?? "";
    expect(summary).toContain("Confira os seus dados, Lucas, que li nos documentos:");
    expect(summary).toContain("CPF: 529.982.247-25");

    await writes(LUCAS, "1");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ answered: 1, failed: 0 });
    expect((await sentTo(LUCAS)).at(-1)).toContain("Qual é o seu estado civil?\n1. Solteiro(a)");
    await writes(LUCAS, "casado");
    await takeConversationTurns(backend() as never);
    expect((await sentTo(LUCAS)).at(-1)).toBe("Qual é a sua profissão?");
    await writes(LUCAS, "Professor");
    await takeConversationTurns(backend() as never);
    expect((await sentTo(LUCAS)).at(-1)).toContain("Obrigado, Lucas. Os seus dados estão completos.");
    const [person] = await sql.unsafe(
      `select marital_status, profession, read_fields from public.people where org_id = $1 and full_name = 'Lucas Teste Lima'`,
      [FIRM],
    );
    expect(person).toEqual({ marital_status: "casado", profession: "Professor", read_fields: {} });
  });

  it("asks what Lucas's account misses one question at a time, and joins the answers to it (0235)", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const { askAccountQuestions } = await import("@/lib/cases/statements-work");
    // His account, ordered by ONE, misses two points.
    const [statement] = await sql.unsafe(
      `insert into public.case_statements (org_id, case_id, party_id, source, chronology, chronology_status, missing_topics, questions)
       select c.org_id, c.id, cp.id, 'client', '22/10: o voo atrasou seis horas.', 'approved',
              array['gastos', 'consequencias'],
              array['Você teve algum gasto por causa do atraso?', 'O que você perdeu por causa do atraso?']
       from public.cases c join public.case_parties cp on cp.case_id = c.id and cp.role = 'claimant'
       where c.org_id = $1 limit 1
       returning id`,
      [FIRM],
    );
    expect(await askAccountQuestions(backend() as never, String(statement.id))).toBe(1);
    expect((await sentTo(LUCAS)).at(-1)).toContain("Pergunta 1 de 2: Você teve algum gasto por causa do atraso?");

    await writes(LUCAS, "Um Uber de 60 reais");
    await takeConversationTurns(backend() as never);
    expect((await sentTo(LUCAS)).at(-1)).toBe("Pergunta 2 de 2: O que você perdeu por causa do atraso?");
    await writes(LUCAS, "Perdi uma reunião de trabalho");
    await takeConversationTurns(backend() as never);
    expect((await sentTo(LUCAS)).at(-1)).toContain("Recebi as suas respostas");
    const [kept] = await sql.unsafe(`select client_added from public.case_statements where id = $1`, [statement.id]);
    expect(String(kept.client_added)).toBe(
      "Você teve algum gasto por causa do atraso?\nUm Uber de 60 reais\n\nO que você perdeu por causa do atraso?\nPerdi uma reunião de trabalho",
    );
  });

  it("keeps a no kindly, and opens the case when the person comes back to go on", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    model.intake = () => ({
      assunto: "problema_voo",
      problema: "cancellation",
      companhia: "AD",
      voo: "AD 4040",
      data: day(-3),
      origem: "VCP",
      destino: "BSB",
      atraso_horas: "",
      aviso: "late",
      nome: "Dora",
      indicado_por: "",
      acompanhantes: "nenhum",
    });
    await writes(DORA, "Oi, sou a Dora. O AD 4040 de Viracopos para Brasília foi cancelado 10 horas antes, viajei só");
    await takeConversationTurns(backend() as never);
    await writes(DORA, "Está certo");
    await takeConversationTurns(backend() as never);
    await writes(DORA, "3");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ opened: 0, failed: 0 });
    expect((await sentTo(DORA)).at(-1)).toBe(
      "Tudo bem, Dora. O escritório não vai seguir com este caso. Se mudar de ideia, é só escrever aqui.",
    );
    await writes(DORA, "Oi de novo");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ opened: 0, failed: 0 });
    expect((await sentTo(DORA)).at(-1)).toContain("Quer que o escritório siga com o seu caso?");
    await writes(DORA, "1");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ opened: 1, failed: 0 });
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
      acompanhantes: "nenhum",
    });
    await writes(RITA, "Meu voo G3 1450 de Brasília para o Rio atrasou duas horas anteontem. Rita Teste, viajei só");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, opened: 0, failed: 0 });
    await writes(RITA, "sim");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, opened: 0, failed: 0 });
    const [kept] = await sql.unsafe(
      `select f.point from public.people p join public.people_funnel($1) f on f.person_id = p.id
       where p.org_id = $1 and p.full_name = 'Rita Teste'`,
      [FIRM],
    );
    expect(kept).toEqual({ point: "nao_qualificado" });
    expect(await sentTo(RITA)).toHaveLength(2);
    const [cases] = await sql.unsafe(`select count(*)::int as n from public.cases where org_id = $1`, [FIRM]);
    expect(cases.n).toBe(2);
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
      acompanhantes: "",
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
