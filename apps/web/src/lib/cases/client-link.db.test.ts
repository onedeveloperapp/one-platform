// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * ONE sends the client's link by itself (migration 0046), with the app's own
 * worker against a real database and the simulator where the vendor stands:
 * a person opens a case for a client who never wrote to the firm, and ONE
 * waits, saying why; the client writes to the firm's WhatsApp, which wakes
 * the case, and ONE makes the link and sends it in that conversation, once.
 * The link the message carries is the one the database keeps (its token's
 * SHA-256), and it opens the client's page.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, as the same database roles with the same claims.
 *
 * Every person, firm and number here is invented: the phones are of an area
 * code no carrier has.
 */

vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae920000-0000-4000-8000-000000000001";
const FIRM = "be920000-0000-4000-8000-00000000000a";
const CONNECTION = "de920000-0000-4000-8000-00000000000a";
const NUMBER = { wabaId: "sim-waba-link", phoneNumberId: "sim-phone-link", displayPhoneNumber: "5500900000092" };
const MARIA = { name: "Maria Teste da Silva", phone: "5500999990192" };

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });

async function ok(result: { data: unknown; error: { message: string } | null }): Promise<Row> {
  expect(result.error).toBeNull();
  const answer = result.data as Row;
  expect(answer.ok, JSON.stringify(answer)).toBe(true);
  return answer;
}

/** What ONE carries of the case now: the worker of the jobs, with no job runner (what it asks for is done here). */
async function carry(caseId: string) {
  const { advanceCases, followByJobs } = await import("@/lib/cases/advance-work");
  return advanceCases(backend() as never, 1, caseId, followByJobs);
}

/** The messages the firm sent Maria, with what became of each. */
async function sentToMaria(): Promise<Row[]> {
  return sql.unsafe(
    `select m.kind, m.body, m.status, m.sent_by from public.wa_messages m
     join public.wa_conversations c on c.id = m.conversation_id
     where m.org_id = $1 and c.contact_wa_id = $2 and m.direction = 'out'
     order by m.created_at`,
    [FIRM, MARIA.phone],
  );
}

describe.skipIf(!DB_URL)("the client's link, sent by ONE", () => {
  let caseId = "";

  beforeAll(async () => {
    // Set on the process itself: a stubbed variable is taken back before each test.
    process.env.WHATSAPP_SIMULATOR = "1";
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@link-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-link-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at)
      values ('${CONNECTION}', '${FIRM}', 'whatsapp', '${NUMBER.wabaId}', 'WhatsApp', 'connected', '${ANA}', now());
    `);
    await ok(
      await backend().rpc("register_wa_number", {
        target_org: FIRM,
        target_connection: CONNECTION,
        target_provider: "simulator",
        target_phone_number_id: NUMBER.phoneNumberId,
        target_waba_id: NUMBER.wabaId,
        target_display_phone_number: NUMBER.displayPhoneNumber,
        target_verified_name: null,
        target_mode: "coexistence",
      }),
    );
    const opened = await as(ANA).rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-01-10",
      target_client: { full_name: MARIA.name, birth_date: "1985-04-02", phone: MARIA.phone },
    });
    expect(opened.error).toBeNull();
    caseId = String((opened.data as Row).case_id);
  }, 120_000);

  afterAll(async () => {
    delete process.env.WHATSAPP_SIMULATOR;
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("waits for a client who never wrote to the firm, and says why", async () => {
    await carry(caseId);
    expect(await sentToMaria()).toEqual([]);
    const owed = await as(ANA).rpc("case_links_owed", { target_case: caseId });
    expect(owed.error).toBeNull();
    expect(owed.data).toEqual([expect.objectContaining({ reason: "no_conversation" })]);
  });

  it("sends the link in the conversation once the client writes, and the link opens the client's page", async () => {
    const { handleDelivery } = await import("@/lib/whatsapp/inbox");
    const { simulatorSecret } = await import("@/lib/whatsapp/config");
    const { inboundTextDelivery, signedDelivery } = await import("@flyee/whatsapp/simulator");
    const number = {
      wabaId: NUMBER.wabaId,
      phoneNumberId: NUMBER.phoneNumberId,
      displayPhoneNumber: NUMBER.displayPhoneNumber,
    };
    const delivery = signedDelivery(
      inboundTextDelivery(number, { phone: MARIA.phone, name: "Maria" }, "Oi, meu voo atrasou."),
      simulatorSecret(),
    );
    expect(await handleDelivery(delivery.rawBody, delivery.signature)).toMatchObject({ ok: true });

    // The client wrote: the database woke the case for ONE.
    const [advance] = await sql.unsafe(`select after, woken_at from public.case_advances where case_id = $1`, [caseId]);
    expect(advance.after).toBeNull();
    expect(advance.woken_at).not.toBeNull();

    const outcomes = await carry(caseId);
    expect(outcomes.acted).toBe(1);

    const sent = await sentToMaria();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "text", sent_by: null });
    expect(["sent", "delivered", "read"]).toContain(sent[0].status);
    const body = String(sent[0].body);
    expect(body).toContain("Olá, Maria.");
    expect(body).toContain("Souza Advogados");

    // The token the message carries is the link the database keeps, and it opens the client's page.
    const token = /\/c\/([A-Za-z0-9_-]{32,128})/.exec(body)?.[1] ?? "";
    expect(token).not.toBe("");
    const [link] = await sql.unsafe(
      `select token_hash, created_by, revoked_at from public.client_links where case_id = $1`,
      [caseId],
    );
    expect(link).toEqual({
      token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
      created_by: null,
      revoked_at: null,
    });
    const opened = await clientAs("anon", { role: "anon" }).rpc("client_link_open", { target_token: token });
    expect(opened.error).toBeNull();
    expect(opened.data).toMatchObject({ found: true, status: "open", firm: "Souza Advogados" });

    // The timeline says ONE sent it; what the client wrote still waits for the firm's answer.
    const [event] = await sql.unsafe(
      `select actor_type, actor_id from public.case_events where case_id = $1 and kind = 'client_link_created'`,
      [caseId],
    );
    expect(event).toEqual({ actor_type: "system", actor_id: null });
    const [conversation] = await sql.unsafe(
      `select last_message_direction, unread_count from public.wa_conversations where org_id = $1 and contact_wa_id = $2`,
      [FIRM, MARIA.phone],
    );
    expect(conversation).toEqual({ last_message_direction: "in", unread_count: 1 });
    const owed = await as(ANA).rpc("case_links_owed", { target_case: caseId });
    expect(owed.data).toEqual([]);
  });

  it("never sends a second link, whatever runs again", async () => {
    await carry(caseId);
    await carry(caseId);
    expect(await sentToMaria()).toHaveLength(1);
    const [count] = await sql.unsafe(`select count(*)::int as n from public.client_links where case_id = $1`, [caseId]);
    expect(count.n).toBe(1);
  });
});
