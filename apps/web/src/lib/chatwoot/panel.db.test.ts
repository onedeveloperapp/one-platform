// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * The firm's panel of attendance (migration 0223), with the app's own code against a real database and the
 * panel's fake where Chatwoot stands: the firm's account made, a conversation written into it in order (the
 * client's, ONE's and the phone's messages, each as its author), a person of the firm entering signed in, what
 * they write there reserved in ONE's outbox as theirs and handing them the conversation, a flagged text held until
 * it is written again, a text past the window refused with why, the status of what went told to the panel, a
 * conversation resolved there given back to ONE, and a conversation taken out of ONE taken out of the panel.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped.
 *
 * Every person, firm and number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae223000-0000-4000-8000-000000000001";
const CAIO = "ae223000-0000-4000-8000-000000000002";
const FIRM = "be223000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "be223000-0000-4000-8000-00000000000b";
const CONVERSATION = "ce223000-0000-4000-8000-00000000000a";
const CLIENT = "5562999992233";

process.env.CHATWOOT_FAKE = "1";
delete process.env.VERCEL_ENV;

async function fake() {
  const { chatwootFake } = await import("@/lib/chatwoot/provider");
  const panel = chatwootFake();
  if (!panel) throw new Error("the panel's fake is off");
  return panel;
}

async function accountOf(firm: string): Promise<Row> {
  return (await sql.unsafe(`select * from public.chatwoot_accounts where org_id = $1`, [firm]))[0]!;
}

async function conversation(): Promise<Row> {
  return (await sql.unsafe(`select * from public.wa_conversations where id = $1`, [CONVERSATION]))[0]!;
}

/** A person of the firm writes in the panel, and the delivery reaches ONE's webhook. */
async function personWrites(content: string) {
  const panel = await fake();
  const account = await accountOf(FIRM);
  const ana = panel.userByEmail("ana@painel-app.invalid")!;
  const delivery = panel.personWrites({
    accountId: Number(account.account_id),
    conversationId: Number((await conversation()).chatwoot_conversation_id),
    userId: ana.id,
    content,
  });
  const { handleChatwootDelivery } = await import("@/lib/chatwoot/webhook");
  const outcome = await handleChatwootDelivery(delivery.rawBody, {
    timestamp: delivery.timestamp,
    signature: delivery.signature,
  });
  return { ...outcome, messageId: delivery.messageId, delivery };
}

describe.skipIf(!DB_URL)("the firm's panel of attendance", () => {
  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${CAIO}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@painel-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
        ('${CAIO}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'caio@painel-app.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-painel-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Rocha Advocacia', 'rocha-painel-app', '${CAIO}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'),
        ('${OTHER_FIRM}', '${CAIO}', 'owner', 'socio');
      insert into public.connections (id, org_id, provider, external_id, label, status) values
        ('de223000-0000-4000-8000-00000000000a', '${FIRM}', 'whatsapp', 'sessao-painel-a', 'WhatsApp', 'connected'),
        ('de223000-0000-4000-8000-00000000000b', '${OTHER_FIRM}', 'whatsapp', 'sessao-painel-b', 'WhatsApp', 'connected');
      insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
        ('fe223000-0000-4000-8000-00000000000a', '${FIRM}', 'de223000-0000-4000-8000-00000000000a', 'openwa', 'sessao-painel-a', 'sessao-painel-a', '5562900002233'),
        ('fe223000-0000-4000-8000-00000000000b', '${OTHER_FIRM}', 'de223000-0000-4000-8000-00000000000b', 'openwa', 'sessao-painel-b', 'sessao-painel-b', '5562900002234');
      insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, contact_name, last_inbound_at, last_message_at, last_message_direction)
      values ('${CONVERSATION}', '${FIRM}', 'fe223000-0000-4000-8000-00000000000a', '${CLIENT}', 'Cliente Teste', now(), now(), 'in');
      insert into public.wa_messages (org_id, conversation_id, number_id, direction, origin, kind, body, status, by_one, wa_message_id, created_at) values
        ('${FIRM}', '${CONVERSATION}', 'fe223000-0000-4000-8000-00000000000a', 'in', 'cloud', 'text', 'Meu voo foi cancelado', 'received', false, 'in-1', now() - interval '3 minutes'),
        ('${FIRM}', '${CONVERSATION}', 'fe223000-0000-4000-8000-00000000000a', 'out', 'cloud', 'text', 'Sinto muito. Qual era o voo?', 'delivered', true, 'out-1', now() - interval '2 minutes');
    `);
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    const accounts = await sql.unsafe(
      `select account_id from public.chatwoot_accounts where org_id in ('${FIRM}', '${OTHER_FIRM}')`,
    );
    await sql.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    // The firms' accounts queued to be taken out of the panel: the panel of this test is gone with it.
    for (const { account_id } of accounts)
      await sql.unsafe(`delete from public.chatwoot_deletions where account_id = $1`, [account_id]);
    await sql.unsafe(`delete from auth.users where id in ('${ANA}', '${CAIO}')`);
    await sql.end({ timeout: 5 });
  });

  it("makes the account of each firm with a real number, once", async () => {
    const { makeAccounts } = await import("@/lib/chatwoot/jobs");
    const made = await makeAccounts(backend(), Date.now() + 30_000);
    expect(made.failed).toBe(0);
    const panel = await fake();
    for (const firm of [FIRM, OTHER_FIRM]) {
      const account = await accountOf(firm);
      expect(account.status).toBe("ready");
      const inbox = panel.inboxes.get(Number(account.inbox_id))!;
      expect(inbox.webhookUrl).toMatch(/\/api\/webhooks\/chatwoot$/);
      expect(inbox.window).toBe(24);
    }
    const before = panel.accounts.size;
    await makeAccounts(backend(), Date.now() + 30_000);
    expect(panel.accounts.size).toBe(before);
  });

  it("writes the conversation in order, each message as its author, and pending while ONE answers", async () => {
    const { mirrorConversations } = await import("@/lib/chatwoot/mirror");
    const report = await mirrorConversations(backend(), { limit: 10 });
    expect(report.failed).toBe(0);
    const panel = await fake();
    const account = await accountOf(FIRM);
    const row = await conversation();
    const shown = panel.conversation(Number(account.account_id), Number(row.chatwoot_conversation_id))!;
    expect(shown.status).toBe("pending");
    expect(panel.contacts.get(shown.contactId)).toMatchObject({
      identifier: CLIENT,
      phone: `+${CLIENT}`,
      name: "Cliente Teste",
    });
    const messages = panel.messagesOf(Number(account.account_id), shown.id);
    expect(messages.map((item) => [item.type, item.content, item.senderId])).toEqual([
      ["incoming", "Meu voo foi cancelado", null],
      ["outgoing", "Sinto muito. Qual era o voo?", Number(account.service_user_id)],
    ]);
    expect(messages.every((item) => item.sourceId?.startsWith("one:"))).toBe(true);
    expect(messages[1]!.status).toBe("delivered");
    // Up to date: nothing more to write.
    expect((await mirrorConversations(backend(), { limit: 10 })).written).toBe(0);
  });

  it("writes what the firm typed on its phone as the phone, and the conversation is a person's", async () => {
    await sql.unsafe(
      `insert into public.wa_messages (org_id, conversation_id, number_id, direction, origin, kind, body, status, wa_message_id)
       values ($1, $2, 'fe223000-0000-4000-8000-00000000000a', 'out', 'app', 'text', 'Oi, aqui é do escritório', 'sent', 'out-2')`,
      [FIRM, CONVERSATION],
    );
    expect((await conversation()).agent).toBe("person");
    const { mirrorConversations } = await import("@/lib/chatwoot/mirror");
    await mirrorConversations(backend(), { limit: 10 });
    const panel = await fake();
    const account = await accountOf(FIRM);
    const row = await conversation();
    const shown = panel.conversation(Number(account.account_id), Number(row.chatwoot_conversation_id))!;
    expect(shown.status).toBe("open");
    expect(panel.messagesOf(Number(account.account_id), shown.id).at(-1)).toMatchObject({
      type: "outgoing",
      content: "Oi, aqui é do escritório",
      senderId: Number(account.phone_user_id),
    });
  });

  it("lets a person of the firm in, signed in, as an agent who sees every conversation", async () => {
    const { openPanel } = await import("@/lib/chatwoot/panel");
    const context = {
      supabase: clientAs("authenticated", { sub: ANA, role: "authenticated", email: "ana@painel-app.invalid" }),
      email: "ana@painel-app.invalid",
      profile: { displayName: "Ana Souza", timezone: null },
    } as unknown as Parameters<typeof openPanel>[0];
    const opened = await openPanel(context);
    expect(opened.ok).toBe(true);
    const panel = await fake();
    const ana = panel.userByEmail("ana@painel-app.invalid")!;
    const account = await accountOf(FIRM);
    expect(panel.accounts.get(Number(account.account_id))!.users.get(ana.id)).toBe("agent");
    expect(panel.inboxes.get(Number(account.inbox_id))!.members.has(ana.id)).toBe(true);
    expect(ana.uiSettings).toMatchObject({ conversations_filter_by: { status: "all" } });
    expect(
      await sql.unsafe(`select chatwoot_user_id from public.chatwoot_staff where org_id = $1 and user_id = $2`, [
        FIRM,
        ANA,
      ]),
    ).toEqual([{ chatwoot_user_id: ana.id }]);
    // Entering again makes nobody new.
    const people = panel.users.size;
    expect((await openPanel(context)).ok).toBe(true);
    expect(panel.users.size).toBe(people);
  });

  it("sends what the person wrote as theirs, once, and hands them the conversation", async () => {
    const written = await personWrites("Bom dia, pode mandar o cartão de embarque?");
    expect(written).toMatchObject({ status: 200, code: "queued" });
    const reserved = await sql.unsafe(
      `select sent_by, status, body from public.wa_messages where chatwoot_message_id = $1`,
      [written.messageId],
    );
    expect(reserved).toEqual([{ sent_by: ANA, status: "queued", body: "Bom dia, pode mandar o cartão de embarque?" }]);
    expect((await conversation()).agent).toBe("person");

    const { handleChatwootDelivery } = await import("@/lib/chatwoot/webhook");
    const again = await handleChatwootDelivery(written.delivery.rawBody, {
      timestamp: written.delivery.timestamp,
      signature: written.delivery.signature,
    });
    expect(again.code).toBe("duplicate");
    expect(
      await handleChatwootDelivery(written.delivery.rawBody, {
        timestamp: written.delivery.timestamp,
        signature: "sha256=00",
      }),
    ).toMatchObject({
      status: 401,
    });
  });

  it("tells the panel what went and who answers now", async () => {
    await sql.unsafe(`update public.wa_messages set status = 'delivered', wa_message_id = 'out-3' where sent_by = $1`, [
      ANA,
    ]);
    const { mirrorConversations } = await import("@/lib/chatwoot/mirror");
    await mirrorConversations(backend(), { limit: 10 });
    const panel = await fake();
    const account = await accountOf(FIRM);
    const row = await conversation();
    expect(panel.conversation(Number(account.account_id), Number(row.chatwoot_conversation_id))!.status).toBe("open");
    const mine = panel
      .messagesOf(Number(account.account_id), Number(row.chatwoot_conversation_id))
      .filter((item) => !item.sourceId);
    expect(mine.at(-1)!.status).toBe("delivered");
    // ONE's own message of it is not written a second time.
    expect(panel.messagesOf(Number(account.account_id), Number(row.chatwoot_conversation_id))).toHaveLength(4);
  });

  it("holds a text the bar's rules flag until the same text is written again within ten minutes", async () => {
    const first = await personWrites("Garantimos 100% de ganho na sua causa");
    expect(first.code).toBe("flagged");
    const panel = await fake();
    const failed = panel.messages.find((item) => item.id === first.messageId)!;
    expect(failed.status).toBe("failed");
    expect(failed.externalError).toContain("10 minutos");
    expect(panel.messages.some((item) => item.private && item.content.includes("publicidade da OAB"))).toBe(true);
    expect(
      await sql.unsafe(`select 1 from public.wa_messages where chatwoot_message_id = $1`, [first.messageId]),
    ).toEqual([]);

    const second = await personWrites("Garantimos 100% de ganho na sua causa");
    expect(second.code).toBe("queued");
    const audit = await sql.unsafe(
      `select metadata from public.audit_events where org_id = $1 and action = 'whatsapp.message_flagged_sent'`,
      [FIRM],
    );
    expect(audit).toHaveLength(1);
  });

  it("refuses with why what goes past the 24-hour window", async () => {
    await sql.unsafe(`update public.wa_conversations set last_inbound_at = now() - interval '2 days' where id = $1`, [
      CONVERSATION,
    ]);
    const late = await personWrites("Ainda está aí?");
    expect(late.code).toBe("window_closed");
    const panel = await fake();
    expect(panel.messages.find((item) => item.id === late.messageId)!.externalError).toContain("24 horas");
    await sql.unsafe(`update public.wa_conversations set last_inbound_at = now() where id = $1`, [CONVERSATION]);
  });

  it("gives the conversation back to ONE when the panel resolves it, and shows it pending", async () => {
    const panel = await fake();
    const account = await accountOf(FIRM);
    const row = await conversation();
    const delivery = panel.personSetsStatus({
      accountId: Number(account.account_id),
      conversationId: Number(row.chatwoot_conversation_id),
      status: "resolved",
    });
    const { handleChatwootDelivery } = await import("@/lib/chatwoot/webhook");
    expect(
      await handleChatwootDelivery(delivery.rawBody, { timestamp: delivery.timestamp, signature: delivery.signature }),
    ).toMatchObject({
      status: 200,
      code: "changed",
    });
    expect((await conversation()).agent).toBe("one");
    const { mirrorConversations } = await import("@/lib/chatwoot/mirror");
    await mirrorConversations(backend(), { limit: 10 });
    expect(panel.conversation(Number(account.account_id), Number(row.chatwoot_conversation_id))!.status).toBe(
      "pending",
    );
  });

  it("reaches nothing of a firm from another firm's panel", async () => {
    const panel = await fake();
    const other = await accountOf(OTHER_FIRM);
    const row = await conversation();
    const delivery = panel.delivery(Number(other.inbox_id), {
      event: "conversation_status_changed",
      id: Number(row.chatwoot_conversation_id),
      inbox_id: Number(other.inbox_id),
      status: "open",
      account: { id: Number(other.account_id) },
    });
    const { handleChatwootDelivery } = await import("@/lib/chatwoot/webhook");
    const outcome = await handleChatwootDelivery(delivery.rawBody, {
      timestamp: delivery.timestamp,
      signature: delivery.signature,
    });
    expect(outcome.code).toBe("not_found");
    expect((await conversation()).agent).toBe("one");
  });

  it("writes the conversation again when the panel lost it, its messages with it", async () => {
    const panel = await fake();
    const account = await accountOf(FIRM);
    const before = await conversation();
    // Somebody took the contact out in the panel: its conversations went with it.
    const token = (await panel.platform.user(Number(account.service_user_id))).accessToken!;
    await panel.account(Number(account.account_id), token).deleteContact(Number(before.chatwoot_contact_id));
    // What waited in the outbox goes, as the outbox would send it: its status reaches a panel that lost the conversation.
    await sql.unsafe(`update public.wa_messages set status = 'sent' where conversation_id = $1 and status = 'queued'`, [
      CONVERSATION,
    ]);
    const { mirrorConversations } = await import("@/lib/chatwoot/mirror");
    const report = await mirrorConversations(backend(), { limit: 10 });
    expect(report.failed).toBe(0);
    const after = await conversation();
    expect(after.chatwoot_conversation_id).not.toBe(before.chatwoot_conversation_id);
    const shown = panel.conversation(Number(account.account_id), Number(after.chatwoot_conversation_id))!;
    expect(shown).toBeTruthy();
    expect(panel.messagesOf(Number(account.account_id), shown.id).map((item) => item.content)).toContain(
      "Meu voo foi cancelado",
    );
  });

  it("takes out of the panel a conversation taken out of ONE", async () => {
    const panel = await fake();
    const contactId = Number((await conversation()).chatwoot_contact_id);
    await sql.unsafe(`delete from public.wa_conversations where id = $1`, [CONVERSATION]);
    const { workDeletions } = await import("@/lib/chatwoot/jobs");
    const worked = await workDeletions(backend(), Date.now() + 30_000);
    expect(worked.failed).toBe(0);
    expect(panel.contacts.has(contactId)).toBe(false);
  });
});
