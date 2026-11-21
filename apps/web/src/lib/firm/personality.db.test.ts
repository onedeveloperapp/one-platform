import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * The firm's profile (migration 0272), with the app's own worker against a real database and the model told what to
 * answer: who manages the firm asks ONE to write it, ONE writes the draft (a dash and an exclamation mark of the
 * model's kept out by the rules), the person approves it, and ONE attends for the new firm from then on, with the
 * profile in hand. It runs only when a migrated database is at hand (`npm run test:db:roundtrip`).
 *
 * Every person and firm here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const model = vi.hoisted(() => ({ briefings: [] as string[] }));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (_output, messages) => {
        model.briefings.push(messages.map((message) => String(message.content ?? "")).join("\n"));
        return {
          apresentacao: { nome: "Souza Advogados", sobre: "Cuidamos de problemas com voos — rápido!", cidades: ["Goiânia"] },
          tratamento: "senhor",
          tom: "formal",
          tamanho: "curtas",
          areas: [],
          fora_do_horario: "Respondemos no próximo horário de atendimento.",
          honorarios: "",
          duvidas: "",
          evitar: [],
          exemplos: [
            { situacao: "Primeira resposta", mensagem: "Bom dia. Como podemos ajudar o senhor?" },
            { situacao: "Pedido de documento", mensagem: "O senhor pode enviar a foto do documento?" },
            { situacao: "Quanto custa", mensagem: "Os honorários estão no contrato, que o senhor lê antes de assinar." },
          ],
        };
      });
    }
  }
  return { ...real, FakeChatProvider: ToldProvider };
});

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "a2720000-0000-4000-8000-0000000000a1";
const FIRM = "b2720000-0000-4000-8000-0000000000a1";

async function call(who: "backend" | "ana", name: string, args: Row): Promise<Row> {
  const client = who === "backend" ? backend() : clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Row;
}

describe.skipIf(!DB_URL)("the firm's profile, written by ONE and approved by the firm", () => {
  beforeAll(async () => {
    process.env.AI_FAKE_PROVIDER = "1";
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@perfil.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-perfil-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      update public.organizations set operation_answered_at = now(), office_city = 'Goiânia' where id = '${FIRM}';
    `);
  });

  afterAll(async () => {
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end();
  });

  it("is asked, written, kept within the rules, approved, and then ONE attends", async () => {
    const { writePersonalities } = await import("@/lib/firm/personality-work");
    expect(await call("ana", "request_firm_personality", { target_org: FIRM, target_change: null, target_site: null })).toMatchObject({
      ok: true,
    });
    expect((await call("backend", "firm_attendance", { target_org: FIRM })).attends).toBe(false);

    expect(await writePersonalities(backend() as never)).toMatchObject({ claimed: 1, drafted: 1 });
    // What ONE was handed: the firm's name and place, and its module's area.
    expect(model.briefings.at(-1)).toContain("Souza Advogados");
    expect(model.briefings.at(-1)).toContain("Goiânia");
    expect(model.briefings.at(-1)).toContain("Direito do Passageiro");

    const [draft] = await sql.unsafe(
      `select id, status, profile from public.firm_personalities where org_id = '${FIRM}' order by version desc limit 1`,
    );
    expect(draft!.status).toBe("draft");
    expect((draft!.profile as Row).tratamento).toBe("senhor");
    expect(((draft!.profile as Row).apresentacao as Row).sobre).toBe("Cuidamos de problemas com voos, rápido.");

    expect(await call("ana", "approve_firm_personality", { target_org: FIRM, target_personality: draft!.id })).toMatchObject({
      ok: true,
      code: "approved",
    });
    const attendance = await call("backend", "firm_attendance", { target_org: FIRM });
    expect(attendance.attends).toBe(true);
    expect(((attendance.personality as Row).profile as Row).tom).toBe("formal");
  });

  it("writes again with the person's words, from the profile in force", async () => {
    const { writePersonalities } = await import("@/lib/firm/personality-work");
    await call("ana", "request_firm_personality", { target_org: FIRM, target_change: "Trate por você", target_site: null });
    expect(await writePersonalities(backend() as never)).toMatchObject({ drafted: 1 });
    expect(model.briefings.at(-1)).toContain("Trate por você");
    expect(model.briefings.at(-1)).toContain("perfil_anterior");
    const rows = await sql.unsafe(
      `select status from public.firm_personalities where org_id = '${FIRM}' order by version`,
    );
    expect(rows.map((row) => row.status)).toEqual(["approved", "draft"]);
  });
});
