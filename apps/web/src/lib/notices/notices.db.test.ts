// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { composeCnj } from "@flyee/rules/cnj";
import { SimulatorProvider } from "@flyee/whatsapp/simulator";

/**
 * The notices a firm's clients get on WhatsApp by themselves, with the app's
 * own worker against a real database and the simulator where the vendor
 * stands: the firm submits a kind's text (the database names the template,
 * the simulator takes it, the platform keeps what it answered) and switches
 * it on, and the sweep reserves each client's reminder of a hearing and
 * sends it through the outbox, with nobody asked to agree first (0088).
 * Sweeps that run at the same time, on two connections, and sweeps that run
 * again send nobody anything twice: the acceptance of the notices (S10). A
 * hearing that moves is told once, the change standing for the reminder of
 * its new moment; a client who asked to stop is told nothing until they ask
 * to be told again.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, as the same database roles with the same claims.
 *
 * Every person, firm, number and lawsuit here is invented: the lawsuits are
 * of a year to come, the phones of an area code no carrier has.
 */

vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let second: Sql;
let clientAs: ReturnType<typeof standIn>;
let secondAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae910000-0000-4000-8000-000000000001";
const FIRM = "be910000-0000-4000-8000-00000000000a";
const CONNECTION = "de910000-0000-4000-8000-00000000000a";
const NUMBER = { wabaId: "sim-waba-avisos", phoneNumberId: "sim-phone-avisos", displayPhoneNumber: "5500900000091" };
const CLIENTS = [
  { name: "Maria Teste da Silva", phone: "5500999990091", sequence: 5910101, time: "14:00" },
  { name: "Joana Teste Lima", phone: "5500999990092", sequence: 5910102, time: "10:00" },
];

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });

/** The day a number of days from today, in Brasília: the day of a hearing. */
const brasiliaDay = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

let settingsBefore: unknown = null;

async function ok(result: { data: unknown; error: { message: string } | null }): Promise<Row> {
  expect(result.error).toBeNull();
  const answer = result.data as Row;
  expect(answer.ok, JSON.stringify(answer)).toBe(true);
  return answer;
}

/** The firm submits a kind's text, the simulator takes it as the vendor would, and the firm switches it on. */
async function switchOn(kind: string) {
  const proposed = await sql.unsafe(`select body from public.notice_kinds where kind = $1`, [kind]);
  const begun = await ok(
    await as(ANA).rpc("begin_notice_template", { target_org: FIRM, target_kind: kind, target_body: proposed[0].body }),
  );
  const created = await new SimulatorProvider().createTemplate({
    name: String(begun.name),
    language: String(begun.language),
    category: "utility",
    body: String(begun.body),
    footer: String(begun.footer),
    examples: (begun.examples as string[]).map(String),
  });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  await ok(
    await backend().rpc("record_notice_template", {
      target_org: FIRM,
      target_kind: kind,
      target_waba: NUMBER.wabaId,
      target_name: begun.name,
      target_status: created.status,
      target_category: created.category,
      target_body: begun.body,
      target_footer: begun.footer,
      target_by: ANA,
    }),
  );
  await ok(await as(ANA).rpc("set_notice_kind", { target_org: FIRM, target_kind: kind, target_enabled: true }));
}

/** What each client of the firm was sent, as templates, by phone. */
async function sentTo(): Promise<Record<string, number>> {
  const rows = await sql.unsafe(
    `select c.contact_wa_id as phone, count(*)::int as n
     from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
     where m.org_id = $1 and m.kind = 'template' and m.status in ('sent', 'delivered', 'read')
     group by c.contact_wa_id`,
    [FIRM],
  );
  return Object.fromEntries(rows.map((row) => [String(row.phone), Number(row.n)]));
}

describe.skipIf(!DB_URL)("the notices to clients, reserved and sent once", () => {
  const hearings: string[] = [];
  // Each client's person and case, as the tests below write to them.
  const people: string[] = [];
  const cases: string[] = [];

  beforeAll(async () => {
    // Set on the process itself: a stubbed variable is taken back before each test.
    process.env.WHATSAPP_SIMULATOR = "1";
    sql = connect();
    second = connect();
    clientAs = standIn(sql);
    secondAs = standIn(second);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@avisos-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-avisos-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at)
      values ('${CONNECTION}', '${FIRM}', 'whatsapp', '${NUMBER.wabaId}', 'WhatsApp', 'connected', '${ANA}', now());
    `);
    // Notices go at any hour here, and with no wait after a write: the hours of the day and the wait are settings.
    const [setting] = await sql.unsafe(`select value from public.platform_settings where key = 'notices'`);
    settingsBefore = setting?.value ?? null;
    await sql.unsafe(
      `update public.platform_settings
       set value = value || '{"send_from_hour": 0, "send_until_hour": 24, "settle_minutes": 0}'::jsonb
       where key = 'notices'`,
    );
    // The other files' messages left in the outbox are theirs: the outbox here sends this firm's.
    await sql.unsafe(
      `update public.wa_messages set status = 'failed', error_code = 'not_attempted' where status = 'queued' and org_id <> $1`,
      [FIRM],
    );

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
    await switchOn("hearing_reminder");

    // Two clients, each with a lawsuit the court has and a hearing in six days. Neither is asked to agree (0088).
    for (const client of CLIENTS) {
      const opened = await as(ANA).rpc("create_case", {
        target_org: FIRM,
        target_incident: "delay",
        target_airline: "G3",
        target_flight_date: "2026-01-10",
        target_client: { full_name: client.name, phone: client.phone },
      });
      expect(opened.error).toBeNull();
      const created = opened.data as Row;
      const filed = await ok(
        await as(ANA).rpc("save_proceeding", {
          target_case: created.case_id,
          target_proceeding: null,
          target_fields: {
            kind: "juizado",
            court: "TJGO",
            system: "projudi",
            comarca: "Goiânia",
            status: "filed",
            cnj: composeCnj({ sequence: client.sequence, year: 2099, court: "09", origin: 51 }),
            filed_at: brasiliaDay(-3),
          },
          target_parties: [created.party_id],
        }),
      );
      const hearing = await ok(
        await as(ANA).rpc("save_hearing", {
          target_hearing: null,
          target_proceeding: filed.proceeding_id,
          target_fields: {
            kind: "conciliacao",
            mode: "videoconferencia",
            day: brasiliaDay(6),
            time: client.time,
            link: "https://sala.invalid/avisos",
          },
        }),
      );
      hearings.push(String(hearing.id));
      people.push(String(created.person_id));
      cases.push(String(created.case_id));
    }
  }, 120_000);

  afterAll(async () => {
    delete process.env.WHATSAPP_SIMULATOR;
    if (!sql) return;
    if (settingsBefore !== null) {
      await sql.unsafe(`update public.platform_settings set value = $1::jsonb where key = 'notices'`, [
        JSON.stringify(settingsBefore),
      ]);
    }
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
    await second.end({ timeout: 5 });
  });

  it("sends each client the reminder of their hearing once, whatever sweeps run at the same time", async () => {
    const { sweepNotices } = await import("@/lib/notices/work");
    // Two sweeps at once, on two connections: one firm's reservations take turns, and the second finds them made.
    const [first, other] = await Promise.all([
      sweepNotices(backend() as never),
      sweepNotices(secondAs("service_role", { role: "service_role" }) as never),
    ]);
    expect(first.reserved + other.reserved).toBe(2);
    expect(first.sent + other.sent).toBe(2);
    expect(await sentTo()).toEqual({ [CLIENTS[0].phone]: 1, [CLIENTS[1].phone]: 1 });

    const [reminder] = await sql.unsafe(
      `select m.body, m.status, n.kind, n.attempts from public.client_notices n
       join public.wa_messages m on m.id = n.message_id
       join public.people p on p.id = n.person_id
       where n.org_id = $1 and p.phone = $2`,
      [FIRM, CLIENTS[0].phone],
    );
    expect(reminder).toMatchObject({ kind: "hearing_reminder", attempts: 1, status: "delivered" });
    expect(String(reminder.body)).toMatch(
      /^Olá, Maria\. O escritório Souza Advogados lembra que a audiência de conciliação do seu processo nº 5910101-\d{2}\.2099\.8\.09\.0051 está marcada para .+, às 14:00, horário de Brasília\. Ela será por videoconferência, pelo link https:\/\/sala\.invalid\/avisos\./,
    );

    // A sweep that runs again finds nothing due.
    const again = await sweepNotices(backend() as never);
    expect(again.reserved).toBe(0);
    expect(await sentTo()).toEqual({ [CLIENTS[0].phone]: 1, [CLIENTS[1].phone]: 1 });
  });

  it("tells a client once that their hearing moved, and does not remind them of the new moment besides", async () => {
    const { sweepNotices } = await import("@/lib/notices/work");
    await switchOn("hearing_change");
    await ok(
      await as(ANA).rpc("save_hearing", {
        target_hearing: hearings[0],
        target_proceeding: null,
        target_fields: {
          kind: "conciliacao",
          mode: "videoconferencia",
          day: brasiliaDay(6),
          time: "16:00",
          link: "https://sala.invalid/avisos",
        },
      }),
    );
    const [moved, other] = await Promise.all([
      sweepNotices(backend() as never),
      sweepNotices(secondAs("service_role", { role: "service_role" }) as never),
    ]);
    expect(moved.reserved + other.reserved).toBe(1);
    expect(await sentTo()).toEqual({ [CLIENTS[0].phone]: 2, [CLIENTS[1].phone]: 1 });
    const [change] = await sql.unsafe(
      `select m.body from public.client_notices n join public.wa_messages m on m.id = n.message_id
       where n.org_id = $1 and n.kind = 'hearing_change'`,
      [FIRM],
    );
    expect(String(change.body)).toMatch(/ela foi remarcada para .+, às 16:00, horário de Brasília\./);

    expect((await sweepNotices(backend() as never)).reserved).toBe(0);
    expect(await sentTo()).toEqual({ [CLIENTS[0].phone]: 2, [CLIENTS[1].phone]: 1 });
  });

  it("asks a client again for a paper ONE refused, with the reason, once", async () => {
    const { sweepNotices } = await import("@/lib/notices/work");
    await switchOn("document_refused");
    // A case still gathering papers, of a client who never answered anything about the notices.
    const opened = await as(ANA).rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-02-10",
      target_client: { full_name: "Rita Teste", phone: "5500999990093" },
    });
    expect(opened.error).toBeNull();
    const created = opened.data as Row;
    // Her proof of address arrived, and ONE's check refused it.
    const file = await ok(
      await backend().rpc("reserve_file", {
        target_org: FIRM,
        target_purpose: "client",
        target_name: "endereco.jpg",
        target_mime: "image/jpeg",
        target_bytes: 3000,
        target_requested_by: null,
      }),
    );
    await ok(
      await backend().rpc("confirm_file", {
        target_file: file.file_id,
        target_sha256: "9".repeat(64),
        target_bytes: 3000,
        target_detected_mime: "image/jpeg",
        target_pages: null,
      }),
    );
    await sql.unsafe(
      `insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, rejected_reason, decided_at)
       values ($1, $2, $3, $4, 'address_proof', 'client', 'rejected', 'A foto ficou desfocada.', now())`,
      [FIRM, created.case_id, created.party_id, file.file_id],
    );

    const swept = await sweepNotices(backend() as never);
    expect(swept.reserved).toBe(1);
    expect((await sentTo())["5500999990093"]).toBe(1);
    const [asked] = await sql.unsafe(
      `select m.body, m.status from public.client_notices n join public.wa_messages m on m.id = n.message_id
       where n.org_id = $1 and n.kind = 'document_refused'`,
      [FIRM],
    );
    expect(asked.status).toBe("delivered");
    const [year, month, day] = brasiliaDay(0).split("-");
    expect(String(asked.body)).toBe(
      `Olá, Rita. O escritório Souza Advogados precisa que você envie de novo o comprovante de endereço, enviado em ${day}/${month}/${year}. ` +
        "Motivo: A foto ficou desfocada. Você pode enviar pelo link do seu caso ou responder a esta mensagem com o arquivo.",
    );

    expect((await sweepNotices(backend() as never)).reserved).toBe(0);
    expect((await sentTo())["5500999990093"]).toBe(1);
  });

  it("tells a client who asked to stop nothing, and tells them again once they ask", async () => {
    const { sweepNotices } = await import("@/lib/notices/work");
    // Joana asked the firm by phone to stop; then her hearing moves.
    const stopped = await ok(
      await as(ANA).rpc("record_notice_optin", {
        target_case: cases[1],
        target_person: people[1],
        target_agreed: false,
        target_note: "Pediu por telefone para não receber.",
      }),
    );
    expect(stopped.code).toBe("stopped");
    await ok(
      await as(ANA).rpc("save_hearing", {
        target_hearing: hearings[1],
        target_proceeding: null,
        target_fields: {
          kind: "conciliacao",
          mode: "videoconferencia",
          day: brasiliaDay(6),
          time: "17:00",
          link: "https://sala.invalid/avisos",
        },
      }),
    );
    expect((await sweepNotices(backend() as never)).reserved).toBe(0);
    expect((await sentTo())[CLIENTS[1].phone]).toBe(1);

    // She asks to be told again: the change she was not told of goes now, once.
    const resumed = await ok(
      await as(ANA).rpc("record_notice_optin", {
        target_case: cases[1],
        target_person: people[1],
        target_agreed: true,
        target_note: "Pediu na reunião para voltar a receber.",
      }),
    );
    expect(resumed.code).toBe("resumed");
    expect((await sweepNotices(backend() as never)).reserved).toBe(1);
    expect((await sentTo())[CLIENTS[1].phone]).toBe(2);
    expect((await sweepNotices(backend() as never)).reserved).toBe(0);
  });
});
