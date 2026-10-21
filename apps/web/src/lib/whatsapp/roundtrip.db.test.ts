// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The round trip of a conversation, with the app's own code against a real
 * database: a person writes, somebody of the firm answers, the message is
 * delivered, the firm's phone writes too, and the number leaves.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`: an embedded PostgreSQL with every migration
 * applied, its address in `ONE_EMBEDDED_DB_URL`); otherwise it is skipped.
 * Nothing here is a mock of the platform: the deliveries are the simulator's,
 * in the vendor's shapes and signed; they enter by `handleDelivery`; the
 * answer is reserved by `reserve_wa_send` under a person's claims and sent by
 * `deliverOutbox`; and every write is a function of migration 0019. What
 * stands in is only the transport: a client that calls the same functions
 * with the same named arguments PostgREST would, as the same database roles.
 *
 * Every person, firm and number here is invented.
 */

vi.mock("server-only", () => ({}));

const DB_URL = process.env.ONE_EMBEDDED_DB_URL ?? "";

type Sql = {
  unsafe: (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  begin: <T>(run: (transaction: Sql) => Promise<T>) => Promise<T>;
  end: (options?: { timeout?: number }) => Promise<void>;
};

let sql: Sql;

type Claims = Record<string, unknown>;

/** The argument types of a function, read from the catalog once: what PostgREST also coerces its JSON arguments to. */
const signatures = new Map<string, Map<string, string>>();
async function signatureOf(name: string): Promise<Map<string, string>> {
  const known = signatures.get(name);
  if (known) return known;
  const rows = await sql.unsafe(
    `select a.name, format_type(a.type, null) as type
     from pg_proc p
     cross join lateral unnest(p.proargnames, p.proargtypes::oid[]) as a (name, type)
     where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
    [name],
  );
  const signature = new Map(rows.map((row) => [String(row.name), String(row.type)]));
  signatures.set(name, signature);
  return signature;
}

const asText = (value: unknown): string | null =>
  value === null || value === undefined ? null : typeof value === "object" ? JSON.stringify(value) : String(value);

/**
 * A stand-in for the Supabase client, as far as the WhatsApp code uses one:
 * `rpc` with named arguments, and the one read of `platform_settings`. Each
 * call runs as the database role and with the JWT claims PostgREST would set.
 */
function clientAs(role: "service_role" | "authenticated", claims: Claims) {
  const run = <T>(work: (transaction: Sql) => Promise<T>) =>
    sql.begin(async (transaction) => {
      await transaction.unsafe("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await transaction.unsafe(`set local role ${role}`);
      return work(transaction);
    });

  return {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      try {
        const signature = await signatureOf(name);
        const keys = Object.keys(args).filter((key) => args[key] !== undefined);
        for (const key of keys) if (!signature.has(key)) throw new Error(`${name} has no argument ${key}`);
        // Every argument travels as text and is cast in the database, as a JSON body is: declaring
        // a parameter's own type would have the driver encode the text by that type's rules
        // (the text "true" as a boolean becomes false).
        const call = keys.map((key, index) => `${key} => $${index + 1}::text::${signature.get(key)}`).join(", ");
        const rows = await run((transaction) =>
          transaction.unsafe(
            `select public.${name}(${call}) as result`,
            keys.map((key) => asText(args[key])),
          ),
        );
        return { data: rows[0]?.result ?? null, error: null };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        return { data: null, error: { code: failure.code, message: failure.message ?? "failed" } };
      }
    },
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: unknown) {
              return {
                async maybeSingle() {
                  const rows = await run((transaction) =>
                    transaction.unsafe(`select ${columns} from public.${table} where ${column} = $1 limit 1`, [value]),
                  );
                  return { data: rows[0] ?? null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const backendClient = () => clientAs("service_role", { role: "service_role" });

// The backend's client, wherever the code under test asks for one.
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backendClient() }));
// No job runner here: a pending media is simply left for the sweep.
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

const ANA = "ab000000-0000-4000-8000-000000000001";
const DAVI = "ab000000-0000-4000-8000-000000000004";
const FIRM_A = "bb000000-0000-4000-8000-00000000000a";
const FIRM_B = "bb000000-0000-4000-8000-00000000000b";
const CONNECTION_A = "db000000-0000-4000-8000-00000000000a";
const CONNECTION_B = "db000000-0000-4000-8000-00000000000b";
const NUMBER_A = { wabaId: "sim-waba-a", phoneNumberId: "sim-phone-a", displayPhoneNumber: "5500900000001" };
const NUMBER_B = { wabaId: "sim-waba-b", phoneNumberId: "sim-phone-b", displayPhoneNumber: "5500900000002" };
const MARIA = { phone: "5562999990001", name: "Maria Teste" };

const asPerson = (user: string) => clientAs("authenticated", { sub: user, role: "authenticated", aal: "aal2" });

const one = async (query: string, params: unknown[] = []) => (await sql.unsafe(query, params))[0] ?? null;

describe.skipIf(!DB_URL)("a conversation, in and out, against the database", () => {
  beforeAll(async () => {
    // Set on the process itself: a stubbed variable is taken back before each test.
    process.env.WHATSAPP_SIMULATOR = "1";
    const root = path.resolve(process.cwd(), "..", "..");
    const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
    const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
    sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });

    // Two firms, each with a simulated number already connected (the vault has its own tests).
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM_A}', '${FIRM_B}');
      delete from auth.users where id in ('${ANA}', '${DAVI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@roundtrip.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
        ('${DAVI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'davi@roundtrip.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM_A}', 'Souza Advogados', 'souza-roundtrip', '${ANA}'),
        ('${FIRM_B}', 'Rocha Advocacia', 'rocha-roundtrip', '${DAVI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM_A}', '${ANA}', 'owner', 'socio'),
        ('${FIRM_B}', '${DAVI}', 'owner', 'advogado');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
        ('${CONNECTION_A}', '${FIRM_A}', 'whatsapp', '${NUMBER_A.wabaId}', 'WhatsApp A', 'connected', '${ANA}', now()),
        ('${CONNECTION_B}', '${FIRM_B}', 'whatsapp', '${NUMBER_B.wabaId}', 'WhatsApp B', 'connected', '${DAVI}', now());
    `);
    for (const [firm, connection, number] of [
      [FIRM_A, CONNECTION_A, NUMBER_A],
      [FIRM_B, CONNECTION_B, NUMBER_B],
    ] as const) {
      const { data, error } = await backendClient().rpc("register_wa_number", {
        target_org: firm,
        target_connection: connection,
        target_provider: "simulator",
        target_phone_number_id: number.phoneNumberId,
        target_waba_id: number.wabaId,
        target_display_phone_number: number.displayPhoneNumber,
        target_verified_name: null,
        target_mode: "coexistence",
      });
      expect(error).toBeNull();
      expect((data as { ok?: boolean }).ok).toBe(true);
    }
  });

  afterAll(async () => {
    delete process.env.WHATSAPP_SIMULATOR;
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id in ('${FIRM_A}', '${FIRM_B}')`);
    await sql.unsafe(`delete from auth.users where id in ('${ANA}', '${DAVI}')`);
    await sql.end({ timeout: 5 });
  });

  it("takes a person's message through the webhook door into the firm of the number, once", async () => {
    const { handleDelivery } = await import("@/lib/whatsapp/inbox");
    const { simulatorSecret } = await import("@/lib/whatsapp/config");
    const { inboundTextDelivery, signedDelivery } = await import("@flyee/whatsapp/simulator");

    const delivery = signedDelivery(
      inboundTextDelivery(NUMBER_A, MARIA, "Oi, perdi meu voo ontem."),
      simulatorSecret(),
    );
    const outcome = await handleDelivery(delivery.rawBody, delivery.signature);
    expect(outcome).toMatchObject({
      ok: true,
      provider: "simulator",
      report: { events: 1, applied: 1, unrouted: 0, failed: 0 },
    });

    // The vendor delivers again whatever it is unsure of: the same delivery changes nothing twice.
    await handleDelivery(delivery.rawBody, delivery.signature);

    const conversation = await one(
      `select c.org_id, c.contact_name, c.unread_count, c.last_message_direction, c.last_inbound_at is not null as window,
              (select count(*)::int from public.wa_messages m where m.conversation_id = c.id) as messages
       from public.wa_conversations c where c.contact_wa_id = $1`,
      [MARIA.phone],
    );
    expect(conversation).toEqual({
      org_id: FIRM_A,
      contact_name: "Maria Teste",
      unread_count: 1,
      last_message_direction: "in",
      window: true,
      messages: 1,
    });
    // Nothing of it reached the other firm.
    expect(await one(`select count(*)::int as n from public.wa_conversations where org_id = $1`, [FIRM_B])).toEqual({
      n: 0,
    });
  });

  it("refuses a delivery nobody signed, or signed with another secret, and writes nothing", async () => {
    const { handleDelivery } = await import("@/lib/whatsapp/inbox");
    const { inboundTextDelivery, signedDelivery } = await import("@flyee/whatsapp/simulator");

    const forged = signedDelivery(
      inboundTextDelivery(NUMBER_A, { phone: "5562911110000", name: "Ninguém" }, "Entrei?"),
      "outro-segredo",
    );
    expect(await handleDelivery(forged.rawBody, forged.signature)).toEqual({
      ok: false,
      status: 401,
      code: "invalid_signature",
    });
    expect(await handleDelivery(forged.rawBody, null)).toEqual({ ok: false, status: 401, code: "invalid_signature" });
    expect(
      await one(`select count(*)::int as n from public.wa_conversations where contact_wa_id = '5562911110000'`),
    ).toEqual({ n: 0 });
  });

  it("sends the firm's answer once, and records that it reached the person", async () => {
    const { deliverOutbox } = await import("@/lib/whatsapp/send");
    const conversation = await one(`select id from public.wa_conversations where contact_wa_id = $1`, [MARIA.phone]);

    // Reserved by a person of the firm, under her own claims: the database decides whether it may go.
    const reserved = await asPerson(ANA).rpc("reserve_wa_send", {
      target_conversation: conversation?.id,
      target_kind: "text",
      target_body: "Olá, Maria. Vamos ver o seu caso.",
      target_template: null,
      target_template_params: null,
      target_media_file: null,
    });
    expect(reserved.error).toBeNull();
    const messageId = (reserved.data as { message_id?: string }).message_id as string;
    expect(reserved.data).toMatchObject({ ok: true, code: "queued" });

    // Somebody of another firm reserves nothing in this conversation.
    const stranger = await asPerson(DAVI).rpc("reserve_wa_send", {
      target_conversation: conversation?.id,
      target_kind: "text",
      target_body: "De outro escritório.",
    });
    expect(stranger.data).toMatchObject({ ok: false, code: "not_found" });

    const report = await deliverOutbox(backendClient() as never, { messageId });
    expect(report).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    // Claimed once: a second pass finds nothing to send.
    expect(await deliverOutbox(backendClient() as never, { messageId })).toMatchObject({ claimed: 0, sent: 0 });

    const message = await one(
      `select direction, origin, status, error_code, body, sent_by, wa_message_id like 'wamid.SIM%' as accepted, pricing_type, attempts
       from public.wa_messages where id = $1`,
      [messageId],
    );
    // `delivered` is the simulator's own status, which came back through the same door a real one does.
    expect(message).toEqual({
      direction: "out",
      origin: "cloud",
      status: "delivered",
      error_code: null,
      body: "Olá, Maria. Vamos ver o seu caso.",
      sent_by: ANA,
      accepted: true,
      pricing_type: "free_customer_service",
      attempts: 1,
    });
    expect(
      await one(`select unread_count, last_message_direction from public.wa_conversations where id = $1`, [
        conversation?.id,
      ]),
    ).toEqual({ unread_count: 0, last_message_direction: "out" });
  });

  it("mirrors what the firm types on its own phone, without opening the window or counting as unread", async () => {
    const { handleDelivery } = await import("@/lib/whatsapp/inbox");
    const { simulatorSecret } = await import("@/lib/whatsapp/config");
    const { echoDelivery, signedDelivery } = await import("@flyee/whatsapp/simulator");

    const echo = signedDelivery(echoDelivery(NUMBER_A, "5562977770003", "Mandei pelo celular."), simulatorSecret());
    expect(await handleDelivery(echo.rawBody, echo.signature)).toMatchObject({ ok: true, report: { applied: 1 } });
    expect(
      await one(
        `select c.unread_count, c.last_inbound_at is null as closed, m.origin, m.direction, m.status, m.body
         from public.wa_conversations c join public.wa_messages m on m.conversation_id = c.id
         where c.contact_wa_id = '5562977770003'`,
      ),
    ).toEqual({
      unread_count: 0,
      closed: true,
      origin: "app",
      direction: "out",
      status: "sent",
      body: "Mandei pelo celular.",
    });
  });

  it("closes only the number of the account the firm disconnected on its phone", async () => {
    const { handleDelivery } = await import("@/lib/whatsapp/inbox");
    const { simulatorSecret } = await import("@/lib/whatsapp/config");
    const { disconnectionDelivery, inboundTextDelivery, signedDelivery } = await import("@flyee/whatsapp/simulator");

    const left = signedDelivery(disconnectionDelivery(NUMBER_A, "PRIMARY_INACTIVITY"), simulatorSecret());
    expect(await handleDelivery(left.rawBody, left.signature)).toMatchObject({ ok: true, report: { applied: 1 } });

    expect(
      await sql.unsafe(
        `select n.org_id, n.status, n.disconnect_reason, c.status as connection
         from public.wa_numbers n join public.connections c on c.id = n.connection_id
         where n.org_id in ($1, $2) order by n.org_id`,
        [FIRM_A, FIRM_B],
      ),
    ).toEqual([
      { org_id: FIRM_A, status: "disconnected", disconnect_reason: "primary_inactivity", connection: "error" },
      { org_id: FIRM_B, status: "active", disconnect_reason: null, connection: "connected" },
    ]);

    // What arrives for a number that left is for nobody, and nothing is sent from it.
    const late = signedDelivery(inboundTextDelivery(NUMBER_A, MARIA, "Ainda tem alguém aí?"), simulatorSecret());
    expect(await handleDelivery(late.rawBody, late.signature)).toMatchObject({
      ok: true,
      report: { applied: 0, unrouted: 1 },
    });
    const conversation = await one(`select id from public.wa_conversations where contact_wa_id = $1`, [MARIA.phone]);
    const refused = await asPerson(ANA).rpc("reserve_wa_send", {
      target_conversation: conversation?.id,
      target_kind: "text",
      target_body: "Depois de desconectado.",
    });
    expect(refused.data).toMatchObject({ ok: false, code: "number_disconnected" });
  });

  it("says what needs somebody today from the same facts", async () => {
    const { handleDelivery } = await import("@/lib/whatsapp/inbox");
    const { simulatorSecret } = await import("@/lib/whatsapp/config");
    const { inboundTextDelivery, signedDelivery } = await import("@flyee/whatsapp/simulator");
    const { readFirmToday, todayNeeds } = await import("@/lib/firm/today");

    // Somebody writes to the other firm, whose number is still connected.
    const hello = signedDelivery(
      inboundTextDelivery(NUMBER_B, { phone: "5562988880002", name: "João Teste" }, "Boa tarde."),
      simulatorSecret(),
    );
    expect(await handleDelivery(hello.rawBody, hello.signature)).toMatchObject({ ok: true, report: { applied: 1 } });

    // The history of that number arrives too, from before it was connected: two old conversations,
    // each ending on the person's word. They are kept, and they wait for nobody.
    const old = (day: number) => String(Math.floor(Date.parse(`2026-0${day}-15T12:00:00Z`) / 1000));
    const history = signedDelivery(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            id: NUMBER_B.wabaId,
            changes: [
              {
                field: "history",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: NUMBER_B.displayPhoneNumber,
                    phone_number_id: NUMBER_B.phoneNumberId,
                  },
                  history: [
                    {
                      metadata: { phase: 0, chunk_order: 1, progress: 100 },
                      threads: [
                        {
                          id: "5562955550001",
                          messages: [
                            {
                              from: NUMBER_B.displayPhoneNumber,
                              to: "5562955550001",
                              id: "wamid.HIST1",
                              timestamp: old(6),
                              type: "text",
                              text: { body: "Bom dia." },
                              history_context: { status: "READ" },
                            },
                            {
                              from: "5562955550001",
                              id: "wamid.HIST2",
                              timestamp: old(7),
                              type: "text",
                              text: { body: "Obrigada, doutor." },
                              history_context: { status: "READ" },
                            },
                          ],
                        },
                        {
                          id: "5562955550002",
                          messages: [
                            {
                              from: "5562955550002",
                              id: "wamid.HIST3",
                              timestamp: old(8),
                              type: "text",
                              text: { body: "Ainda atendem?" },
                              history_context: { status: "READ" },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      simulatorSecret(),
    );
    expect(await handleDelivery(history.rawBody, history.signature)).toMatchObject({
      ok: true,
      report: { applied: 1, failed: 0 },
    });
    expect(
      await sql.unsafe(
        `select c.contact_wa_id, c.last_message_direction, c.last_inbound_at is null as never_opened, c.unread_count,
                (select count(*)::int from public.wa_messages m where m.conversation_id = c.id and m.origin = 'history') as imported
         from public.wa_conversations c where c.contact_wa_id in ('5562955550001', '5562955550002') order by c.contact_wa_id`,
      ),
    ).toEqual([
      {
        contact_wa_id: "5562955550001",
        last_message_direction: "in",
        never_opened: true,
        unread_count: 0,
        imported: 2,
      },
      {
        contact_wa_id: "5562955550002",
        last_message_direction: "in",
        never_opened: true,
        unread_count: 0,
        imported: 1,
      },
    ]);
    expect(
      await one(`select history_progress from public.wa_numbers where phone_number_id = $1`, [NUMBER_B.phoneNumberId]),
    ).toEqual({
      history_progress: 100,
    });

    const theirs = readFirmToday((await asPerson(DAVI).rpc("firm_today", { target_org: FIRM_B })).data);
    expect(theirs).toMatchObject({ conversationsWaiting: 1, conversationsClosing: 0, whatsapp: "active" });
    expect(theirs ? todayNeeds(theirs).map((need) => [need.key, need.count]) : null).toEqual([["waiting", 1]]);

    // The firm whose number left is told so, and has nothing it can answer.
    const ours = readFirmToday((await asPerson(ANA).rpc("firm_today", { target_org: FIRM_A })).data);
    expect(ours).toMatchObject({ conversationsWaiting: 0, whatsapp: "disconnected" });
    // And nobody asks for a firm that is not theirs.
    expect((await asPerson(DAVI).rpc("firm_today", { target_org: FIRM_A })).error?.code).toBe("42501");
  });
});
