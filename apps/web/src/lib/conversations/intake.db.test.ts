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
 * not qualified; and a word that is no problem with a flight goes the way of its subject (0257): a greeting is
 * greeted with the firm's areas, an area of the firm goes to a person with what the person needs, an area the firm
 * does not work in is refused kindly and set aside, what is nothing of a client is set aside unanswered, and nobody new
 * is answered by ONE while the firm never said its areas.
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
  route: ((): unknown => ({})) as (briefing: string) => unknown,
  // The answer to a doubt of who still decides (0249).
  doubt: ((): unknown => ({ resposta: "", chamar_pessoa: false })) as (briefing: string) => unknown,
  briefings: [] as string[],
}));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (_output, messages) => {
        const briefing = messages.map((message) => String(message.content ?? "")).join("\n");
        model.briefings.push(briefing);
        if (briefing.includes("areas_do_direito")) return model.route(briefing);
        if (briefing.includes("fatos_anotados")) return model.intake(briefing);
        return briefing.includes("regra_ate_agora") ? model.doubt(briefing) : model.conversation(briefing);
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
const EVA = "5500988880011";
const FABIO = "5500988880012";
const GIL = "5500988880013";
const HELO = "5500988880014";
const IVO = "5500988880015";
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
      -- The firm said how it works and its areas (0256): ONE attends for it, Família among them.
      update public.organizations set operation_answered_at = now() where id = '${FIRM}';
      insert into public.firm_areas (org_id, law_area, name, source) values ('${FIRM}', 'familia', 'Família e sucessões', 'person');
      -- And approved its profile (0272): ONE attends for it.
      insert into public.firm_personalities (org_id, version, profile, examples, status) values
        ('${FIRM}', 1, '{"tratamento": "voce", "tom": "proximo", "tamanho": "curtas"}', '[]', 'approved');
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
    await sql.unsafe(`delete from public.market_decisions where key like 'entrada-duvida-%'`);
    await sql.end({ timeout: 5 });
  });

  it("asks first what decides the right, sums it up, and asks the person only after their yes (0239)", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const { intakeOpening } = await import("@/lib/conversations/intake");
    const empty = {
      companhia: "",
      voo: "",
      data: "",
      origem: "",
      destino: "",
      atraso_horas: "",
      // The arrival at the final destination, and whether the passenger travelled after a cancellation (0239).
      chegada_prevista: "",
      chegada_real: "",
      viajou: "",
      aviso: "",
      nome: "",
      // Who referred the person (0183) and who travelled along (0227), empty when not told.
      indicado_por: "",
      pergunta: "",
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
    // The day of the flight first: the airline and the flight's number are never asked (0239).
    expect(first[0]).toContain("Sinto muito pelo atraso. Em que dia era o voo?");

    model.intake = () => ({ assunto: "problema_voo", problema: "delay", ...empty, data: day(-1) });
    await writes(LUCAS, "Foi ontem");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ answered: 1, failed: 0 });
    expect((await sentTo(LUCAS)).at(-1)).toBe(
      "O atraso foi de quanto tempo até você chegar ao destino final?\n1. Menos de quatro horas\n2. Mais de quatro horas",
    );

    model.intake = () => ({
      assunto: "problema_voo",
      problema: "delay",
      ...empty,
      companhia: "LA",
      voo: "LA 3456",
      data: day(-1),
      chegada_prevista: "14:00",
      chegada_real: "20:00",
    });
    await writes(LUCAS, "Era o LA 3456, devia chegar às 14h e cheguei às 20h");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ answered: 1, opened: 0, failed: 0 });
    const summary = (await sentTo(LUCAS)).at(-1) ?? "";
    expect(summary).toContain("Confere o que eu entendi.");
    expect(summary).toContain("atrasou e você chegou ao destino final 6 horas depois do previsto.");
    expect(summary).toContain("Está certo?\n1. Está certo\n2. Corrigir");
    expect(summary).not.toMatch(/Lucas|viajou/);
    expect(await countCases()).toBe(0);

    await writes(LUCAS, "1");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ answered: 1, opened: 0, failed: 0 });
    expect((await sentTo(LUCAS)).at(-1)).toContain("Quer que o escritório siga com o seu caso?\n1. Quero seguir");
    expect(await countCases()).toBe(0);

    // Only after the yes: how to call him, then who travelled along, and the case opens.
    await writes(LUCAS, "Quero seguir");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ opened: 0, failed: 0 });
    expect((await sentTo(LUCAS)).at(-1)).toBe("Combinado. Como posso te chamar?");
    model.intake = () => ({
      assunto: "problema_voo",
      problema: "delay",
      ...empty,
      companhia: "LA",
      voo: "LA 3456",
      data: day(-1),
      chegada_prevista: "14:00",
      chegada_real: "20:00",
      nome: "Lucas Teste Lima",
    });
    await writes(LUCAS, "Lucas Teste Lima");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ opened: 0, failed: 0 });
    expect((await sentTo(LUCAS)).at(-1)).toContain(
      "Obrigado, Lucas. Mais alguém viajou com você nessa reserva?\n1. Só eu",
    );
    await writes(LUCAS, "1");
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
      chegada_prevista: "10:00",
      chegada_real: "18:00",
      viajou: "sim",
      aviso: "late",
      nome: "Dora",
      indicado_por: "",
      pergunta: "",
      acompanhantes: "nenhum",
    });
    await writes(
      DORA,
      "Oi, sou a Dora. O AD 4040 de Viracopos para Brasília foi cancelado 10 horas antes. Devia chegar às 10h e cheguei às 18h, viajei só",
    );
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

  it("answers a doubt on the way and at the offer, with the market's forecast and no promise, and goes on (0249)", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const { intakeOpening } = await import("@/lib/conversations/intake");
    // Decisions of the market on cancellations, invented, for the forecast to read.
    await sql.unsafe(
      `insert into public.market_decisions (key, source, court, party, day, instance, result, moral_cents, problem)
       select 'entrada-duvida-' || n, 'fake', 'TJGO', 'Companhia Teste', current_date - 10, 'first', 'procedente', 300000, 'cancellation'
       from generate_series(1, 6) n on conflict (key) do nothing`,
    );
    const blank = {
      companhia: "",
      voo: "",
      origem: "",
      destino: "",
      atraso_horas: "",
      chegada_prevista: "",
      chegada_real: "",
      viajou: "",
      aviso: "",
      nome: "",
      indicado_por: "",
      pergunta: "",
      acompanhantes: "",
    };
    const cost = "Quanto eu posso ganhar com isso?";
    model.intake = () => ({
      assunto: "problema_voo",
      problema: "cancellation",
      ...blank,
      data: day(-3),
      pergunta: cost,
    });
    model.doubt = () => ({
      resposta:
        "Em decisões recentes do TJGO sobre cancelamento, o valor mais comum ficou perto de R$ 3.000. Não é uma promessa: cada caso depende do juiz e das provas.",
      chamar_pessoa: false,
    });
    model.briefings = [];
    await writes(EVA, "Meu voo foi cancelado anteontem, quanto eu posso ganhar com isso?");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 1, failed: 0 });
    const opening = intakeOpening("Souza Advogados");
    expect(await sentTo(EVA)).toEqual([
      `${opening}\n\nEm decisões recentes do TJGO sobre cancelamento, o valor mais comum ficou perto de R$ 3.000. Não é uma promessa: cada caso depende do juiz e das provas.\n\nSinto muito pelo cancelamento. Quando a companhia avisou do cancelamento?\n1. No aeroporto\n2. Menos de 72 horas antes\n3. Com mais antecedência`,
    ]);
    // The task was handed the doubt and the market's median, with where it was read.
    const briefing = model.briefings.find((text) => text.includes("regra_ate_agora")) ?? "";
    expect(briefing).toContain(cost);
    expect(briefing).toContain("mediana_do_dano_moral");
    expect(briefing).toContain("TJGO");

    // What decides the right, in the options; then the summary, confirmed, and the offer.
    await writes(EVA, "1");
    await takeConversationTurns(backend() as never);
    await writes(EVA, "2");
    await takeConversationTurns(backend() as never);
    expect((await sentTo(EVA)).at(-1)).toContain("Confere o que eu entendi.");
    await writes(EVA, "1");
    await takeConversationTurns(backend() as never);
    expect((await sentTo(EVA)).at(-1)).toContain("Quer que o escritório siga com o seu caso?");

    // A doubt in her own words at the offer: answered, and the offer again with a person one choice away.
    model.doubt = () => ({
      resposta:
        "Você não paga nada agora. No juizado, se perder na primeira instância, você não paga custas nem o advogado da companhia.",
      chamar_pessoa: false,
    });
    await writes(EVA, "E se eu perder, pago alguma coisa?");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ answered: 1, called: 0, failed: 0 });
    expect((await sentTo(EVA)).at(-1)).toBe(
      "Você não paga nada agora. No juizado, se perder na primeira instância, você não paga custas nem o advogado da companhia.\n\nQuer seguir com o seu caso?\n1. Quero seguir\n2. Falar com uma pessoa\n3. Agora não",
    );

    // One only a person answers: ONE says so and hands the conversation to the firm.
    model.doubt = () => ({ resposta: "Sobre isso, uma pessoa do escritório responde aqui.", chamar_pessoa: true });
    await writes(EVA, "Vocês também cuidam de problema com hotel?");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ called: 1, failed: 0 });
    expect((await sentTo(EVA)).at(-1)).toBe("Sobre isso, uma pessoa do escritório responde aqui.");
    const [conversation] = await sql.unsafe(
      `select agent from public.wa_conversations where org_id = $1 and contact_wa_id = $2`,
      [FIRM, EVA],
    );
    expect(conversation).toEqual({ agent: "person" });
    model.doubt = () => ({ resposta: "", chamar_pessoa: false });
  });

  it("tells a delay too short kindly at once, and keeps the person as not qualified (0239)", async () => {
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
      chegada_prevista: "",
      chegada_real: "",
      viajou: "",
      aviso: "",
      nome: "Rita Teste",
      indicado_por: "",
      pergunta: "",
      acompanhantes: "nenhum",
    });
    await writes(RITA, "Meu voo G3 1450 de Brasília para o Rio atrasou duas horas anteontem. Rita Teste, viajei só");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, opened: 0, failed: 0 });
    // The answer that rules the right out ends the intake there, with no summary and no other question.
    expect(await sentTo(RITA)).toEqual([
      "Obrigado por responder, Rita. Pelo que vimos deste voo, o escritório não vai abrir um caso agora. Se quiser falar com uma pessoa do escritório, é só escrever aqui.",
    ]);
    const [kept] = await sql.unsafe(
      `select f.point from public.people p join public.people_funnel($1) f on f.person_id = p.id
       where p.org_id = $1 and p.full_name = 'Rita Teste'`,
      [FIRM],
    );
    expect(kept).toEqual({ point: "nao_qualificado" });
    const [cases] = await sql.unsafe(`select count(*)::int as n from public.cases where org_id = $1`, [FIRM]);
    expect(cases.n).toBe(2);
  });

  it("goes the way of a subject that is no problem with a flight (0257)", async () => {
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const notFlight = {
      assunto: "outro",
      problema: "",
      companhia: "",
      voo: "",
      data: "",
      origem: "",
      destino: "",
      atraso_horas: "",
      chegada_prevista: "",
      chegada_real: "",
      viajou: "",
      aviso: "",
      nome: "",
      indicado_por: "",
      pergunta: "",
      acompanhantes: "",
    };
    model.intake = () => notFlight;
    const state = async (phone: string) =>
      (
        await sql.unsafe(
          `select agent, called_at is not null as called, called_reason, route from public.wa_conversations
           where org_id = $1 and contact_wa_id = $2`,
          [FIRM, phone],
        )
      )[0];

    // Only a greeting: ONE says who it is and the firm's areas, once.
    model.route = () => ({ assunto: "cumprimento", area: "", resumo: "", certeza: "alta" });
    await writes(BETO, "Bom dia");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 1, failed: 0 });
    expect(await sentTo(BETO)).toEqual([
      "Oi, aqui é o assistente virtual do escritório Souza Advogados. O escritório cuida de Direito do Passageiro e Família e sucessões. Me conta em poucas palavras como posso ajudar.",
    ]);
    expect((await state(BETO)).route).toEqual({ greeted: true });

    // An area of the firm, told: a person continues with what the person needs.
    model.route = () => ({
      assunto: "area",
      area: "familia",
      resumo: "Quer se divorciar e tem um filho.",
      certeza: "alta",
    });
    await writes(FABIO, "Quero me divorciar, tenho um filho de 5 anos");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, called: 1, failed: 0 });
    expect(await sentTo(FABIO)).toEqual(["Uma pessoa do escritório vai continuar esta conversa com você."]);
    expect(await state(FABIO)).toMatchObject({
      agent: "person",
      called: true,
      called_reason: "Contato novo de Família e sucessões. O que a pessoa precisa: Quer se divorciar e tem um filho.",
    });

    // An area the firm does not work in: refused kindly, pointing nowhere, and set aside with no urgency.
    model.route = () => ({ assunto: "area", area: "trabalhista", resumo: "Foi demitido.", certeza: "alta" });
    await writes(GIL, "Fui demitido sem receber nada");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 1, failed: 0 });
    expect(await sentTo(GIL)).toEqual([
      "Obrigado por escrever. O escritório não atende casos de Trabalhista, por isso não vamos poder ajudar com este assunto. Se tiver outra questão, é só escrever aqui.",
    ]);
    expect(await state(GIL)).toMatchObject({ agent: "person", called: false });

    // Nothing of a client: no answer, and the team sees it with no urgency.
    model.route = () => ({ assunto: "nao_juridico", area: "", resumo: "", certeza: "alta" });
    await writes(HELO, "Promoção de cartões de visita para escritórios");
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 0, failed: 0 });
    expect(await sentTo(HELO)).toEqual([]);
    expect(await state(HELO)).toMatchObject({ agent: "person", called: false });

    // While the firm never said its areas, and ONE never attended for it, a person answers anybody new.
    await sql.unsafe(`update public.organizations set operation_answered_at = null where id = '${FIRM}'`);
    try {
      await writes(IVO, "Meu voo foi cancelado ontem");
      expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, called: 1, failed: 0 });
      expect(await sentTo(IVO)).toEqual([]);
      expect(await state(IVO)).toMatchObject({ agent: "person", called: true });
    } finally {
      await sql.unsafe(`update public.organizations set operation_answered_at = now() where id = '${FIRM}'`);
    }
  });
});
