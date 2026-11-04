// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * ONE in the conversation (migration 0048), with the app's own worker
 * against a real database, the test chat's provider where the vendor stands
 * and the model told what to answer: ONE's first word on a cancelled flight,
 * the passenger's "SIM" opening the case with the flight and the link with
 * the next steps, a question answered as ONE's with nothing of the passenger
 * handed to the model, a passenger who asks for a lawyer told that a person
 * continues and listed for the firm, a firm that keeps ONE's answers to a
 * person sending one once it is approved, and a "NÃO" ended kindly. A photo
 * of an identity and an audio the passenger sends join the case (0050): the
 * photo read for what paper it is, checked as one sent through the link and
 * told in the conversation, the audio as the passenger's account.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport and the model, as the same database roles with the same
 * claims.
 *
 * Every person, firm and number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

/** The model, told what to answer; and what it was handed. */
const model = vi.hoisted(() => ({
  answer: ((): unknown => ({})) as (briefing: string) => unknown,
  briefings: [] as string[],
}));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (_output, messages) => {
        const briefing = messages.map((message) => String(message.content ?? "")).join("\n");
        model.briefings.push(briefing);
        return model.answer(briefing);
      });
    }
  }
  return { ...real, FakeChatProvider: ToldProvider };
});

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
/** The bucket, in memory: where the test chat's page leaves a file, and the firm's files. */
const bucket = new Map<string, Uint8Array>();
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae950000-0000-4000-8000-000000000001";
const BIA = "ae950000-0000-4000-8000-000000000002";
const FIRM = "be950000-0000-4000-8000-00000000000a";
const CONNECTION = "de950000-0000-4000-8000-00000000000a";
const TOKEN = "u".repeat(43);
const MARIANA = "5500988880001";
const RAFAEL = "5500988880002";

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });

async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Row> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Row;
}

const tripOf = async (label: string): Promise<string> =>
  String(
    (await sql.unsafe(`select id from public.tracked_trips where org_id = $1 and label = $2`, [FIRM, label]))[0].id,
  );

const conversationOf = async (phone: string): Promise<Row> =>
  (
    await sql.unsafe(
      `select id, agent, called_reason, one_through from public.wa_conversations where org_id = $1 and contact_wa_id = $2`,
      [FIRM, phone],
    )
  )[0];

/** What the firm sent a passenger, oldest first. */
const sentTo = (phone: string) =>
  sql.unsafe(
    `select m.kind, m.body, m.status, m.by_one, m.ai_run_id is not null as model, m.sent_by from public.wa_messages m
     join public.wa_conversations c on c.id = m.conversation_id
     where m.org_id = $1 and c.contact_wa_id = $2 and m.direction = 'out' order by m.created_at, m.id`,
    [FIRM, phone],
  );

describe.skipIf(!DB_URL)("ONE in the conversation, from the first word on a flight to a person called", () => {
  let debounce: unknown = null;

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    process.env.AI_FAKE_PROVIDER = "1";
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id in ('${ANA}', '${BIA}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@one-conversa.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${BIA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bia@one-conversa.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-one-conversa', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${FIRM}', '${BIA}', 'member', 'atendimento');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
        ('${CONNECTION}', '${FIRM}', 'whatsapp', 'test-waba-conversa', 'Chat de teste', 'connected', '${ANA}', now());
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
      target_phone_number_id: "test-number-conversa",
      target_waba_id: "test-waba-conversa",
      target_display_phone_number: "5500900000095",
      target_verified_name: "Souza Advogados",
      target_mode: "cloud",
    });
    expect(number.ok).toBe(true);
    const started = await call(backend(), "start_test_chat", {
      target_org: FIRM,
      target_number: number.number_id,
      target_token: TOKEN,
      target_by: ANA,
    });
    expect(started.ok).toBe(true);
    // A test chat brings no passenger of its own since 0087: the ready trips this test acts on are made here.
    await sql.unsafe(`select public.seed_test_trips('${FIRM}')`);
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
    await sql.unsafe(`delete from auth.users where id in ('${ANA}', '${BIA}')`);
    await sql.end({ timeout: 5 });
  });

  it("opens the case at the passenger's yes, with the flight, and sends the link with the next steps", async () => {
    const { runTestTool, sendTestMessage } = await import("@/lib/test-chat/actions");
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const trip = await tripOf("cancelamento");
    expect(await runTestTool(TOKEN, trip, "cancel")).toEqual({ ok: true, code: "told" });
    expect(await sendTestMessage(TOKEN, trip, { reply: "SIM" })).toEqual({ ok: true, code: "delivered" });

    const report = await takeConversationTurns(backend() as never);
    expect(report).toMatchObject({ claimed: 1, opened: 1, failed: 0 });
    // The plain answer is the database's to read: no model was asked.
    expect(model.briefings).toEqual([]);

    const [opened] = await sql.unsafe(
      `select t.status, k.seq, k.incident, k.airline_iata, p.full_name, p.phone,
              (select count(*)::int from public.flight_segments s where s.case_id = k.id) as legs,
              (select count(*)::int from public.flight_segments s where s.case_id = k.id and s.affected) as affected,
              (select count(*)::int from public.client_links l where l.case_id = k.id) as links
       from public.tracked_trips t join public.cases k on k.id = t.case_id
       join public.case_parties cp on cp.case_id = k.id and cp.role = 'claimant'
       join public.people p on p.id = cp.person_id
       where t.id = $1`,
      [trip],
    );
    expect(opened).toMatchObject({
      status: "case_opened",
      incident: "cancellation",
      airline_iata: "LA",
      full_name: "Mariana Teste",
      legs: 1,
      affected: 1,
      links: 1,
    });

    const sent = await sentTo(MARIANA);
    expect(sent.map((message) => message.kind)).toEqual(["template", "text"]);
    const steps = sent[1];
    expect(steps).toMatchObject({ by_one: true, model: false, sent_by: null });
    expect(["sent", "delivered"]).toContain(steps.status);
    expect(String(steps.body)).toContain(`Pronto, Mariana. O escritório abriu o seu caso, número ${opened.seq}.`);
    expect(String(steps.body)).toMatch(/1\. Abra o seu link: \S+\/c\/[A-Za-z0-9_-]{43}/);
    expect(String(steps.body)).not.toMatch(/[–—!]/);

    const conversation = await conversationOf(MARIANA);
    const events = await sql.unsafe(
      `select kind from public.wa_conversation_events where conversation_id = $1 order by created_at, kind`,
      [conversation.id],
    );
    expect(events.map((event) => event.kind)).toEqual(["case_opened", "link_sent"]);
    // Done: the same yes is never taken twice.
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 0 });
  });

  it("joins a photo of the identity and an audio to the case, checks the photo and tells the passenger", async () => {
    const { sendTestMedia, startTestMedia } = await import("@/lib/test-chat/actions");
    const { fetchPendingMedia } = await import("@/lib/whatsapp/media");
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const sharp = (await import("sharp")).default;
    const trip = await tripOf("cancelamento");
    model.answer = (briefing) =>
      briefing.includes("Que papel é este arquivo?")
        ? { tipo: "identity", nome: "MARIANA TESTE" }
        : briefing.includes("Documento dito:")
          ? {
              decisao: "aceitar",
              motivo: "",
              tipo_identificado: "RG",
              legivel: true,
              nome_no_documento: "MARIANA TESTE",
              confere_com_a_pessoa: "sim",
              // What the identity says of its person (0063): the name on record already, and nothing else.
              dados_lidos: {
                nome_completo: "Mariana Teste",
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
              },
              observacoes: "",
              trechos: [],
            }
          : {};

    // The page sends each file where the vendor would keep it, then as the passenger's message.
    const send = async (bytes: Uint8Array, mime: string, name: string) => {
      const started = await startTestMedia(TOKEN, trip, { mime, bytes: bytes.byteLength });
      expect(started.ok).toBe(true);
      if (!started.ok) return "";
      bucket.set(started.storagePath, bytes);
      expect(await sendTestMedia(TOKEN, trip, { mediaId: started.mediaId, mime, name })).toEqual({
        ok: true,
        code: "delivered",
      });
      return started.storagePath;
    };
    const photo = new Uint8Array(
      await sharp({ create: { width: 900, height: 600, channels: 3, background: "#f4f1ea" } })
        .composite([
          {
            input: Buffer.from(
              '<svg width="900" height="600"><rect x="60" y="60" width="780" height="480" fill="none" stroke="#123" stroke-width="6"/><text x="120" y="300" font-size="56" fill="#123">REGISTRO GERAL</text></svg>',
            ),
          },
        ])
        .png()
        .toBuffer(),
    );
    const staged = await send(photo, "image/png", "rg.png");
    await send(new Uint8Array([...Buffer.from("OggS"), 0, 2, ...new Array(60).fill(0)]), "audio/ogg", "relato.ogg");
    expect(await startTestMedia(TOKEN, trip, { mime: "video/mp4", bytes: 1000 })).toEqual({
      ok: false,
      code: "type_not_allowed",
    });

    // The turn waits for the files on their way; the backend brings them into the firm's files.
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 0 });
    expect(await fetchPendingMedia(backend() as never)).toMatchObject({ stored: 2, failed: 0 });
    expect(bucket.has(staged)).toBe(false);

    const asked = model.briefings.length;
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, failed: 0 });
    // The paper was read and then checked; the audio waits for its transcription.
    expect(model.briefings.slice(asked).some((briefing) => briefing.includes("Que papel é este arquivo?"))).toBe(true);
    expect(
      model.briefings.slice(asked).some((briefing) => briefing.includes("Documento dito: documento de identidade")),
    ).toBe(true);

    const [paper] = await sql.unsafe(
      `select d.kind, d.source, d.status, p.full_name from public.case_documents d
       join public.case_parties cp on cp.id = d.party_id join public.people p on p.id = cp.person_id
       join public.tracked_trips t on t.case_id = d.case_id where t.id = $1`,
      [trip],
    );
    expect(paper).toEqual({ kind: "identity", source: "whatsapp", status: "accepted", full_name: "Mariana Teste" });
    const [account] = await sql.unsafe(
      `select s.source from public.case_statements s join public.tracked_trips t on t.case_id = s.case_id where t.id = $1`,
      [trip],
    );
    expect(account).toEqual({ source: "whatsapp" });

    const told = (await sentTo(MARIANA)).at(-1);
    expect(told).toMatchObject({ by_one: true, model: false });
    expect(String(told?.body)).toBe(
      [
        "Recebi o documento de identidade e já juntei ao seu caso. Está tudo certo.",
        "Recebi o seu áudio e juntei ao seu caso como o relato do que aconteceu. Depois você vai ver os fatos em ordem no seu link, para confirmar.",
      ].join("\n"),
    );
    const events = await sql.unsafe(
      `select e.kind from public.wa_conversation_events e
       join public.wa_conversations c on c.id = e.conversation_id
       where c.org_id = $1 and c.contact_wa_id = $2 and e.kind in ('document_joined', 'statement_joined') order by e.kind`,
      [FIRM, MARIANA],
    );
    expect(events.map((event) => event.kind)).toEqual(["document_joined", "statement_joined"]);
  });

  it("answers a question with the model's words, as ONE's, and hands the model no identifier", async () => {
    const { sendTestMessage } = await import("@/lib/test-chat/actions");
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    model.answer = () => ({
      intencao: "pergunta",
      resposta: "O escritório vai avaliar o seu caso e te escreve por aqui!",
      chamar_pessoa: null,
    });
    const trip = await tripOf("cancelamento");
    expect(
      await sendTestMessage(TOKEN, trip, {
        text: "Quanto tempo demora? Meu CPF é 123.456.789-09 e o e-mail mariana@teste.invalid",
      }),
    ).toEqual({ ok: true, code: "delivered" });

    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 1, called: 0 });
    const briefing = model.briefings.at(-1) ?? "";
    expect(briefing).toContain("Quanto tempo demora?");
    expect(briefing).not.toContain("123.456.789-09");
    expect(briefing).not.toContain("mariana@teste.invalid");

    const last = (await sentTo(MARIANA)).at(-1);
    // The firm's rules of copy, kept on the model's words too: no exclamation goes to a passenger.
    expect(last).toMatchObject({
      body: "O escritório vai avaliar o seu caso e te escreve por aqui.",
      by_one: true,
      model: true,
      sent_by: null,
    });
    const [run] = await sql.unsafe(
      `select r.status, r.task from public.ai_runs r join public.wa_messages m on m.ai_run_id = r.id
       where m.org_id = $1 order by m.created_at desc limit 1`,
      [FIRM],
    );
    expect(run).toEqual({ status: "succeeded", task: "atendimento.conversa" });
  });

  it("calls a person when the passenger asks for a lawyer, and the firm finds the conversation waiting", async () => {
    const { sendTestMessage } = await import("@/lib/test-chat/actions");
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    model.answer = () => ({
      intencao: "pergunta",
      resposta: "Uma pessoa do escritório vai falar com você por aqui.",
      chamar_pessoa: "A passageira quer falar com um advogado.",
    });
    const trip = await tripOf("cancelamento");
    await sendTestMessage(TOKEN, trip, { text: "Quero falar com um advogado." });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 1, called: 1 });

    const conversation = await conversationOf(MARIANA);
    expect(conversation).toMatchObject({ agent: "person", called_reason: "A passageira quer falar com um advogado." });
    const pending = await call(as(BIA), "firm_pending", { target_org: FIRM });
    expect(pending.conversations_called).toEqual([
      expect.objectContaining({ conversation_id: conversation.id, contact: expect.any(String), late: false }),
    ]);

    // While a person has it, ONE answers nothing there.
    const asked = model.briefings.length;
    await sendTestMessage(TOKEN, trip, { text: "Alguém aí?" });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 0 });
    expect(model.briefings).toHaveLength(asked);
  });

  it("given back to a firm that keeps ONE's answers to a person, an answer waits and goes once approved", async () => {
    const { sendTestMessage } = await import("@/lib/test-chat/actions");
    const { sendApprovedReply, takeConversationTurns } = await import("@/lib/conversations/agent-work");
    expect(
      await call(as(ANA), "set_firm_autonomy", {
        target_org: FIRM,
        target_decision: "reply_client",
        target_mode: "approval",
      }),
    ).toMatchObject({ ok: true });
    const conversation = await conversationOf(MARIANA);
    expect(
      await call(as(BIA), "set_conversation_agent", { target_conversation: conversation.id, target_agent: "one" }),
    ).toMatchObject({ ok: true, code: "changed" });
    // Given back with the passenger's last words unanswered: they are ONE's to answer.
    model.answer = () => ({
      intencao: "documentos",
      resposta: "Pode enviar as fotos pelo link do caso.",
      chamar_pessoa: null,
    });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 0 });
    const before = (await sentTo(MARIANA)).length;

    const [waiting] = await sql.unsafe(
      `select a.id, a.status from public.approvals a join public.ai_runs r on r.id = a.run_id
       where a.org_id = $1 and a.task = 'atendimento.conversa' and r.subject_id = $2 and a.status = 'pending'`,
      [FIRM, conversation.id],
    );
    expect(waiting).toBeDefined();

    // A newer answer takes its place: the passenger wrote again before anybody approved.
    model.answer = () => ({ intencao: "documentos", resposta: "As fotos vão pelo link do caso.", chamar_pessoa: null });
    await sendTestMessage(TOKEN, await tripOf("cancelamento"), { text: "Posso mandar as fotos por aqui?" });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, answered: 0 });
    const answers = await sql.unsafe(
      `select a.id, a.status from public.approvals a join public.ai_runs r on r.id = a.run_id
       where a.org_id = $1 and a.task = 'atendimento.conversa' and r.subject_id = $2 order by a.created_at`,
      [FIRM, conversation.id],
    );
    expect(answers.map((answer) => answer.status)).toEqual(["withdrawn", "pending"]);
    expect((await sentTo(MARIANA)).length).toBe(before);

    const decided = await call(as(BIA), "decide_approval", {
      target_approval: answers[1].id,
      target_decision: "approved",
      target_final_output: {
        intencao: "documentos",
        resposta: "As fotos vão pelo link do caso, Mariana.",
        chamar_pessoa: null,
      },
      target_note: null,
    });
    expect(decided).toMatchObject({ ok: true, edited: true });
    expect(await sendApprovedReply(String(answers[1].id))).toBe("queued");
    expect(await sendApprovedReply(String(answers[1].id))).toBe("already_sent");
    const last = (await sentTo(MARIANA)).at(-1);
    expect(last).toMatchObject({
      body: "As fotos vão pelo link do caso, Mariana.",
      by_one: true,
      model: true,
      sent_by: BIA,
    });
    // Still ONE's conversation: an answer of ONE a person approved takes nothing over.
    expect((await conversationOf(MARIANA)).agent).toBe("one");
  });

  it("ends a no kindly, and answers nothing more about that trip", async () => {
    const { runTestTool, sendTestMessage } = await import("@/lib/test-chat/actions");
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const family = await tripOf("familia");
    expect(await runTestTool(TOKEN, family, "late_6h")).toEqual({ ok: true, code: "told" });
    await sendTestMessage(TOKEN, family, { reply: "NÃO" });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, opened: 0, failed: 0 });
    const last = (await sentTo(RAFAEL)).at(-1);
    expect(last).toMatchObject({
      body: "Tudo bem, Rafael. O escritório não vai seguir com este caso. Se mudar de ideia, é só escrever aqui.",
      by_one: true,
    });
    const [trip] = await sql.unsafe(`select status, case_id from public.tracked_trips where id = $1`, [family]);
    expect(trip).toEqual({ status: "declined", case_id: null });
  });
});
