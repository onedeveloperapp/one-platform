import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * The script of an area of the firm (migration 0273), with the app's own worker against a real database and the model
 * told what to answer: who manages the firm asks ONE to write the script of its family area, ONE writes the draft
 * (a dash and an exclamation mark of the model's kept out by the rules, and an option with no criterion of the firm's
 * read as "a person decides"), the person publishes it, and the setup's facts say every area has its script. It runs
 * only when a migrated database is at hand (`npm run test:db:roundtrip`).
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
          tipos: [
            {
              chave: "divorcio",
              nome: "Divórcio consensual",
              documentos: [
                { chave: "rg", nome: "RG ou CNH", tipo: "identity", por: "pessoa", essencial: true },
                { chave: "certidao", nome: "Certidão de casamento", tipo: "other", por: "caso", essencial: true },
              ],
              pecas: ["Petição inicial de divórcio"],
            },
          ],
          perguntas: [
            {
              chave: "bens",
              texto: "Há bens a dividir?",
              tipos: [],
              opcoes: [
                { chave: "nao", texto: "Não", criterio: "segue" },
                { chave: "exterior", texto: "Sim, no exterior", criterio: "talvez" },
              ],
            },
          ],
          etapas: [{ chave: "cejusc", nome: "Audiência no CEJUSC", fase: "processo" }],
          tarefas: [],
          honorarios: "Os honorários estão no contrato — leia antes de assinar!",
          duvidas: "",
          recusa: "",
          tribunais: [{ tribunal: "TJGO", sistema: "Projudi" }],
          sensiveis: [{ dado: "criancas", nome: "Dados dos filhos", guarda_anos: 5 }],
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

const ANA = "a2730000-0000-4000-8000-0000000000a1";
const FIRM = "b2730000-0000-4000-8000-0000000000a1";
const AREA = "c2730000-0000-4000-8000-0000000000a1";

async function call(who: "backend" | "ana", name: string, args: Row): Promise<Row> {
  const client =
    who === "backend" ? backend() : clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Row;
}

describe.skipIf(!DB_URL)("the script of an area, written by ONE and published by the firm", () => {
  beforeAll(async () => {
    process.env.AI_FAKE_PROVIDER = "1";
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@roteiro.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-roteiro-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      update public.organizations set operation_answered_at = now(), office_city = 'Goiânia' where id = '${FIRM}';
      insert into public.firm_areas (id, org_id, law_area, name, source)
      values ('${AREA}', '${FIRM}', 'familia', 'Família e sucessões', 'person');
    `);
  });

  afterAll(async () => {
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end();
  });

  it("is asked, written within the rules, published, and the setup says the area has its script", async () => {
    const { writeAreaScripts } = await import("@/lib/areas/script-work");
    expect(
      await call("ana", "request_area_script", {
        target_org: FIRM,
        target_area: AREA,
        target_change: null,
        target_files: [],
      }),
    ).toMatchObject({ ok: true });

    expect(await writeAreaScripts(backend() as never)).toMatchObject({ claimed: 1, drafted: 1 });
    // What ONE was handed: the area and the firm.
    expect(model.briefings.at(-1)).toContain("Família e sucessões");
    expect(model.briefings.at(-1)).toContain("Souza Advogados");

    const [draft] = await sql.unsafe(
      `select id, status, script from public.firm_area_scripts where area_id = '${AREA}' order by version desc limit 1`,
    );
    expect(draft!.status).toBe("draft");
    const script = draft!.script as Row;
    expect(script.honorarios).toBe("Os honorários estão no contrato, leia antes de assinar.");
    // An option with no criterion of the firm's is one a person decides.
    expect(((script.perguntas as Row[])[0]!.opcoes as Row[])[1]!.criterio).toBe("pessoa");

    expect(await call("ana", "firm_setup_facts", { target_org: FIRM })).toMatchObject({ area_scripts: false });
    expect(await call("ana", "publish_area_script", { target_org: FIRM, target_script: draft!.id })).toMatchObject({
      ok: true,
      code: "published",
    });
    expect(await call("ana", "firm_setup_facts", { target_org: FIRM })).toMatchObject({ area_scripts: true });
  });

  it("writes again with the person's words, from the script in force", async () => {
    const { writeAreaScripts } = await import("@/lib/areas/script-work");
    await call("ana", "request_area_script", {
      target_org: FIRM,
      target_area: AREA,
      target_change: "Inclua a guarda dos filhos",
      target_files: [],
    });
    expect(await writeAreaScripts(backend() as never)).toMatchObject({ drafted: 1 });
    expect(model.briefings.at(-1)).toContain("Inclua a guarda dos filhos");
    expect(model.briefings.at(-1)).toContain("roteiro_anterior");
    const rows = await sql.unsafe(
      `select status from public.firm_area_scripts where area_id = '${AREA}' order by version`,
    );
    expect(rows.map((row) => row.status)).toEqual(["published", "draft"]);
  });
});
