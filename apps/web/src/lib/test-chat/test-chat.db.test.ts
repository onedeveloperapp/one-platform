// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * The firm's test chat (migration 0047), with the app's own actions against
 * a real database and the test chat's provider where the vendor stands: the
 * tools of the page make a trip's problem happen, the rule reads it, and ONE
 * writes its first word once, as the firm's template, through the outbox; a
 * delay under the setting is told nothing; the passenger's reply goes in
 * through the inbox as a real one would; and the page reads the
 * conversation by its link only.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, as the same database roles with the same claims.
 *
 * Every person, firm and number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae930000-0000-4000-8000-000000000001";
const FIRM = "be930000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "be930000-0000-4000-8000-00000000000b";
const CONNECTION = "de930000-0000-4000-8000-00000000000a";
const OTHER_CONNECTION = "de930000-0000-4000-8000-00000000000b";
const TOKEN = "t".repeat(43);
const OTHER_TOKEN = "o".repeat(43);

async function ok(result: { data: unknown; error: { message: string } | null }): Promise<Row> {
  expect(result.error).toBeNull();
  const answer = result.data as Row;
  expect(answer.ok, JSON.stringify(answer)).toBe(true);
  return answer;
}

const tripOf = async (firm: string, label: string): Promise<string> =>
  String(
    (await sql.unsafe(`select id from public.tracked_trips where org_id = $1 and label = $2`, [firm, label]))[0].id,
  );

/** What the firm sent a passenger of its test chat, oldest first. */
const sentTo = (phone: string) =>
  sql.unsafe(
    `select m.kind, m.body, m.status, m.template_name from public.wa_messages m
     join public.wa_conversations c on c.id = m.conversation_id
     where m.org_id = $1 and c.contact_wa_id = $2 and m.direction = 'out' order by m.created_at`,
    [FIRM, phone],
  );

describe.skipIf(!DB_URL)("the test chat, where a passenger's phone stands", () => {
  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@teste-chat-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-teste-chat-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Rocha Advocacia', 'rocha-teste-chat-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
        ('${CONNECTION}', '${FIRM}', 'whatsapp', 'test-waba-app', 'Chat de teste', 'connected', '${ANA}', now()),
        ('${OTHER_CONNECTION}', '${OTHER_FIRM}', 'whatsapp', 'test-waba-app-b', 'Chat de teste', 'connected', '${ANA}', now());
    `);
    // The backend's half of "Ligar o chat de teste": the number recorded, then the chat with its link and its trips.
    const number = await ok(
      await backend().rpc("register_wa_number", {
        target_org: FIRM,
        target_connection: CONNECTION,
        target_provider: "test",
        target_phone_number_id: "test-number-app",
        target_waba_id: "test-waba-app",
        target_display_phone_number: "5500900000093",
        target_verified_name: "Souza Advogados",
        target_mode: "cloud",
      }),
    );
    await ok(
      await backend().rpc("start_test_chat", {
        target_org: FIRM,
        target_number: number.number_id,
        target_token: TOKEN,
        target_by: ANA,
      }),
    );
    // Another firm, with a test chat of its own (its owner is a member of it for this purpose only).
    await sql
      .unsafe(
        `insert into public.memberships (org_id, user_id, role, firm_function) values ('${OTHER_FIRM}', '${ANA}', 'member', 'atendimento')
                      on conflict do nothing`,
      )
      .catch(() => undefined);
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("opens by its link only, with the four trips ready", async () => {
    const { readTestChat } = await import("@/lib/test-chat/actions");
    const read = await readTestChat(TOKEN);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.view.firm).toBe("Souza Advogados");
    expect(read.view.trips.map((trip) => trip.label)).toEqual(["cancelamento", "familia", "conexao", "internacional"]);
    expect(await readTestChat(OTHER_TOKEN)).toEqual({ ok: false, code: "missing" });
    expect(await readTestChat("curto")).toEqual({ ok: false, code: "missing" });
  });

  it("tells nothing of a delay under the setting", async () => {
    const { runTestTool } = await import("@/lib/test-chat/actions");
    const trip = await tripOf(FIRM, "cancelamento");
    expect(await runTestTool(TOKEN, trip, "late_short")).toEqual({ ok: true, code: "quiet" });
    expect(await sentTo("5500988880001")).toEqual([]);
  });

  it("tells a cancellation once, as the firm's template, delivered to the page", async () => {
    const { runTestTool } = await import("@/lib/test-chat/actions");
    const trip = await tripOf(FIRM, "cancelamento");
    expect(await runTestTool(TOKEN, trip, "cancel")).toEqual({ ok: true, code: "told" });
    expect(await runTestTool(TOKEN, trip, "cancel")).toEqual({ ok: true, code: "already" });
    const sent = await sentTo("5500988880001");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "template", status: "delivered", template_name: "one_aviso_voo_1" });
    const body = String(sent[0].body);
    expect(body).toMatch(
      /^Olá, Mariana\. Aqui é o assistente automático do escritório Souza Advogados\. O seu voo LA 3456 de São Paulo \(GRU\) para Recife \(REC\), de \d{2}\/\d{2}\/\d{4} foi cancelado\. Pelas regras da ANAC, a companhia aérea deve oferecer outro voo, o reembolso ou outro meio de transporte/,
    );
    expect(body).toContain("Responda SIM para seguir ou NÃO se não quiser.");
  });

  it("draws the conversation for the page, read as read, and takes the passenger's reply as a real one", async () => {
    const { readTestThread, sendTestMessage } = await import("@/lib/test-chat/actions");
    const trip = await tripOf(FIRM, "cancelamento");
    const first = await readTestThread(TOKEN, trip, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.messages).toHaveLength(1);
    expect((await sentTo("5500988880001"))[0].status).toBe("read");

    expect(await sendTestMessage(TOKEN, trip, { reply: "SIM" })).toEqual({ ok: true, code: "delivered" });
    const [answer] = await sql.unsafe(
      `select m.kind, m.body, c.last_inbound_at is not null as window from public.wa_messages m
       join public.wa_conversations c on c.id = m.conversation_id
       where m.org_id = $1 and c.contact_wa_id = '5500988880001' and m.direction = 'in'`,
      [FIRM],
    );
    expect(answer).toEqual({ kind: "button", body: "SIM", window: true });
    const after = await readTestThread(TOKEN, trip, first.messages[0].at);
    expect(after.ok && after.messages.map((message) => message.body)).toEqual(["SIM"]);
    // Text the passenger types goes in as text; nothing reaches a trip of another chat.
    expect(await sendTestMessage(TOKEN, trip, { text: "  Meu voo foi cancelado no portão.  " })).toEqual({
      ok: true,
      code: "delivered",
    });
    expect(await sendTestMessage(OTHER_TOKEN, trip, { text: "Oi" })).toEqual({ ok: false, code: "missing" });
    expect(await sendTestMessage(TOKEN, trip, { text: "   " })).toEqual({ ok: false, code: "invalid_message" });
  });

  it("tells the family's delay of six hours, and starts a trip over", async () => {
    const { runTestTool } = await import("@/lib/test-chat/actions");
    const family = await tripOf(FIRM, "familia");
    expect(await runTestTool(TOKEN, family, "late_6h")).toEqual({ ok: true, code: "told" });
    const [message] = await sentTo("5500988880002");
    expect(String(message.body)).toContain("está previsto para chegar ao destino com 6 horas de atraso");
    expect(String(message.body)).toContain("dar meios de comunicação, alimentação e hospedagem");

    expect(await runTestTool(TOKEN, family, "reset")).toEqual({ ok: true, code: "reset" });
    const [alerts] = await sql.unsafe(`select count(*)::int as n from public.flight_alerts where trip_id = $1`, [
      family,
    ]);
    expect(alerts.n).toBe(0);
    expect(await runTestTool(TOKEN, family, "no_such_tool")).toEqual({ ok: false, code: "invalid_tool" });
  });
});
