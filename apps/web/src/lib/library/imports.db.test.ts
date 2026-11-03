// @vitest-environment node
import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName, ChatAttachment } from "@flyee/ai/types";

/**
 * The firm's own model made from a document it already uses, with the app's
 * own code against a real database (migrations 0067 and 0079): a lawyer sends
 * a Word file, the backend reads it word for word and forgets the file, the
 * marking checks it and says which paragraphs were of the original case, and
 * the screen writes the model from the paragraphs and the changes, with what
 * still looks like the original case. A firm that keeps the models to a
 * person has the lawyer save it; otherwise ONE saves it by itself when there
 * is nothing to look at. A PDF is transcribed by the model first. A document
 * that is no model ONE uses, or that is not what it was sent as, is refused
 * with why; what only the firm knows is asked, and the answer is in the
 * model ONE saves. Another firm reads nothing of it.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, the bucket (in memory) and the model (the fake provider of
 * `@flyee/ai`, told here what to answer).
 *
 * Every person, firm, name and fact here is invented; the CPF is one manuals
 * use as an example.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

/** The model, told what to answer, and what it was handed. */
const model = vi.hoisted(() => ({
  asked: [] as { task: string; text: string; attachments: ChatAttachment[] }[],
}));

/** An answer of the marking, the parts a scenario does not say filled in. */
const marking = (fields: Record<string, unknown>) => ({
  documento: "peca",
  o_que_e: "",
  faltas: [],
  perguntas: [],
  tipo_de_processo: "ambos",
  nome: "",
  trocas: [],
  pessoas: [],
  observacoes: [],
  ...fields,
});

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (output, messages) => {
        const text = messages.map((message) => message.content).join(" ");
        const attachments = messages.flatMap((message) => message.attachments ?? []);
        const properties = (output.schema.properties ?? {}) as Record<string, unknown>;
        if ("paragrafos" in properties) {
          model.asked.push({ task: "transcricao", text, attachments });
          return {
            legivel: true,
            paragrafos: [
              "PROCURAÇÃO",
              "OUTORGANTE: MARIA TESTE DE SOUZA, brasileira, solteira.",
              "Goiânia, 10 de maio de 2099.",
            ],
          };
        }
        model.asked.push({ task: "marcacao", text, attachments });
        if (text.includes("CONTESTAÇÃO")) {
          return marking({ documento: "outro", o_que_e: "uma contestação" });
        }
        if (text.includes("CONTRATO DE HONORÁRIOS")) {
          // The contract leaves its fee blank: asked first, and written with the firm's answer.
          if (!text.includes("Resposta: 30% do proveito econômico")) {
            return marking({
              documento: "contrato",
              o_que_e: "um contrato de honorários",
              perguntas: [{ pergunta: "Qual é o percentual dos honorários?", motivo: "O contrato o deixa em branco." }],
            });
          }
          return marking({
            documento: "contrato",
            o_que_e: "um contrato de honorários",
            nome: "Contrato de honorários do escritório",
            trocas: [
              { de: 2, ate: 2, motivo: "o cliente", texto: "CONTRATANTE: [[CONTRATANTE]]." },
              {
                de: 3,
                ate: 3,
                motivo: "o percentual dos honorários, como o escritório respondeu",
                texto: "HONORÁRIOS: 30% do proveito econômico.",
              },
              { de: 4, ate: 4, motivo: "o local e a data", texto: "[[LOCAL_DATA]]." },
            ],
            pessoas: ["MARIA TESTE DE SOUZA"],
          });
        }
        if (text.includes("PROCURAÇÃO")) {
          return marking({
            documento: "procuracao",
            o_que_e: "uma procuração",
            nome: "Procuração do escritório",
            trocas: [
              { de: 2, ate: 2, motivo: "o cliente", texto: "OUTORGANTE: [[OUTORGANTE]]." },
              { de: 3, ate: 3, motivo: "o local e a data", texto: "[[LOCAL_DATA]]." },
            ],
            pessoas: ["MARIA TESTE DE SOUZA"],
          });
        }
        return marking({
          documento: "peca",
          o_que_e: "uma petição inicial",
          tipo_de_processo: "juizado",
          nome: "Inicial do juizado: cancelamento",
          trocas: [
            { de: 1, ate: 1, motivo: "o juízo", texto: "EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO DO [[JUIZO]]" },
            {
              de: 2,
              ate: 2,
              motivo: "a qualificação das partes",
              texto: "[[PARTES]], vem propor AÇÃO DE INDENIZAÇÃO em face de [[RE]], pelos fatos a seguir.",
            },
            { de: 4, ate: 4, motivo: "os fatos do caso", texto: "[COMPLETAR: narrar os fatos do caso]" },
            { de: 7, ate: 7, motivo: "o valor da causa", texto: "Dá-se à causa o valor de [[VALOR_DA_CAUSA]]." },
            { de: 8, ate: 9, motivo: "a data e quem assina", texto: "[[ADVOGADOS]]" },
          ],
          pessoas: ["MARIA TESTE DE SOUZA", "Maria"],
          observacoes: ["Confira o pedido de danos morais."],
        });
      });
    }
  }
  return { ...real, FakeChatProvider: ToldProvider };
});

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const bucket = new Map<string, Uint8Array>();

const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ad710000-0000-4000-8000-000000000001";
const DAVI = "ad710000-0000-4000-8000-000000000004";
const FIRM = "bd710000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "bd710000-0000-4000-8000-00000000000b";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const asAna = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
const asDavi = () => clientAs("authenticated", { sub: DAVI, role: "authenticated", aal: "aal2" });

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

/** A Word file of the given paragraphs, as a word processor writes it. */
function wordFile(paragraphs: string[]): Uint8Array {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = paragraphs
    .map(
      (text) =>
        `<w:p>${text
          .split("\n")
          .map((line) => `<w:r><w:t>${escape(line)}</w:t></w:r>`)
          .join("<w:r><w:br/></w:r>")}</w:p>`,
    )
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "word/document.xml": strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
  });
}

async function onePagePdf(words: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]).drawText(words, { x: 60, y: 760 });
  return pdf.save();
}

const PETITION = [
  "EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO DO JUIZADO ESPECIAL CÍVEL DA COMARCA DE GOIÂNIA",
  "MARIA TESTE DE SOUZA, brasileira, solteira, CPF 529.982.247-25, residente na Rua das Flores, 10, Goiânia, vem propor AÇÃO DE INDENIZAÇÃO em face de AÉREA EXEMPLO S.A., pelos fatos a seguir.",
  "DOS FATOS",
  "No dia 3 de maio de 2099, a autora embarcaria no voo XX 1234, que foi cancelado.",
  "DO DIREITO",
  "A responsabilidade da ré é objetiva, nos termos do art. 14 da Lei nº 8.078. Maria sofreu dano.",
  "Dá-se à causa o valor de R$ 10.000,00.",
  "Goiânia, 10 de maio de 2099.",
  "Fulano de Tal\nOAB/XX 00.000",
];

const CONTRACT = [
  "CONTRATO DE HONORÁRIOS",
  "CONTRATANTE: MARIA TESTE DE SOUZA.",
  "HONORÁRIOS: ____% do proveito econômico.",
  "Goiânia, 10 de maio de 2099.",
];

describe.skipIf(!DB_URL)("the firm's own model made from a document it already uses", () => {
  /**
   * A lawyer sends a document and asks for its model, as the library's own actions do: reserved, the bytes, kept;
   * sent as a paper when the setup's step sends it.
   */
  async function send(
    name: string,
    mime: string,
    bytes: Uint8Array,
    expected: string | null = null,
  ): Promise<{ importId: string; path: string }> {
    const reserved = await call(asAna(), "reserve_file_upload", {
      target_org: FIRM,
      target_purpose: "model_source",
      target_name: name,
      target_mime: mime,
      target_bytes: bytes.byteLength,
    });
    expect(reserved.code).toBe("reserved");
    const path = String(reserved.storage_path);
    bucket.set(path, bytes);
    const { supabaseFileStore } = await import("@/lib/files/store");
    const { measureFile } = await import("@flyee/documents/measure");
    const kept = await supabaseFileStore(backend() as never).confirm(
      String(reserved.file_id),
      await measureFile(bytes),
    );
    expect(kept.ok).toBe(true);
    const asked = await call(asAna(), "request_template_import", {
      target_org: FIRM,
      target_file: reserved.file_id,
      target_expected: expected,
      target_default: expected !== null,
    });
    expect(asked.code).toBe("requested");
    return { importId: String(asked.import_id), path };
  }

  /** What the dialog reads of a request, under the lawyer's own session. */
  async function view(importId: string) {
    const { importView, IMPORT_VIEW_COLUMNS } = await import("@/lib/library/import-read");
    const { data } = await asAna()
      .from("template_imports")
      .select(IMPORT_VIEW_COLUMNS)
      .eq("id", importId)
      .maybeSingle();
    expect(data).not.toBeNull();
    return importView(data as never);
  }

  /** The firm keeps the models ONE prepares to a person, or lets ONE save them (its default). */
  async function keepToPerson(kept: boolean) {
    await sql.unsafe(`delete from public.firm_autonomy where org_id = '${FIRM}' and decision = 'model_from_document'`);
    if (kept) {
      await sql.unsafe(
        `insert into public.firm_autonomy (org_id, decision, mode) values ('${FIRM}', 'model_from_document', 'approval')`,
      );
    }
  }

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    process.env.AI_FAKE_PROVIDER = "1";
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${DAVI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@modelos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${DAVI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'davi@modelos.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-modelos-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Rocha Advocacia', 'rocha-modelos-app', '${DAVI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${DAVI}', 'owner', 'advogado');
    `);
  }, 120_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_PROVIDER;
    // Nothing of this file is left for another file's sweep to find.
    await sql?.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    await sql?.unsafe(`delete from auth.users where id in ('${ANA}', '${DAVI}')`);
    await sql?.end({ timeout: 5 });
  });

  it("reads a Word file word for word, marks what was of the original case, and the lawyer saves the model", async () => {
    await keepToPerson(true);
    const { importNext } = await import("@/lib/library/import-work");
    const sent = await send("Inicial Maria Teste.docx", DOCX, wordFile(PETITION));

    // Its text, read by the backend itself: the file is forgotten, its bytes with it.
    expect(await importNext(backend() as never, sent.importId)).toBe("read");
    expect(bucket.has(sent.path)).toBe(false);
    expect(model.asked).toHaveLength(0);

    // The marking reads the paragraphs by their numbers, the CPF taken out, and never the file's name.
    expect(await importNext(backend() as never, sent.importId)).toBe("ready");
    const marked = model.asked.at(-1);
    expect(marked?.task).toBe("marcacao");
    expect(marked?.text).toContain("O escritório mandou este documento para virar um modelo, sem dizer qual.");
    expect(marked?.text).toContain("§2\nMARIA TESTE DE SOUZA, brasileira, solteira, CPF [CPF]");
    expect(marked?.text).not.toContain("529.982.247-25");
    expect(marked?.text).not.toContain("Inicial Maria Teste");

    const read = await view(sent.importId);
    expect(read.status).toBe("ready");
    expect(read.heldReason).toBe("autonomy");
    expect(read.prepared?.documentKind).toBe("piece");
    expect(read.prepared?.proceedingKind).toBe("juizado");
    expect(read.prepared?.body).toBe(
      [
        "EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO DO [[JUIZO]]",
        "[[PARTES]], vem propor AÇÃO DE INDENIZAÇÃO em face de [[RE]], pelos fatos a seguir.",
        "DOS FATOS",
        "[COMPLETAR: narrar os fatos do caso]",
        "DO DIREITO",
        "A responsabilidade da ré é objetiva, nos termos do art. 14 da Lei nº 8.078. Maria sofreu dano.",
        "Dá-se à causa o valor de [[VALOR_DA_CAUSA]].",
        "[[ADVOGADOS]]",
      ].join("\n\n"),
    );
    expect(read.prepared?.changes.map((change) => [change.from, change.to])).toEqual([
      [1, 1],
      [2, 2],
      [4, 4],
      [7, 7],
      [8, 9],
    ]);
    expect(read.prepared?.changes[1].before).toBe(PETITION[1]);
    // A name of the original case the marking left in a paragraph of the firm is pointed out.
    expect(read.prepared?.checks).toEqual([{ kind: "person", name: "Maria", count: 1 }]);
    expect(read.prepared?.notes).toEqual(["Confira o pedido de danos morais."]);

    const saved = await call(asAna(), "save_imported_template", {
      target_import: sent.importId,
      fields: {
        name: "Inicial do juizado: cancelamento",
        document_kind: "piece",
        proceeding_kind: "juizado",
        is_default: false,
        body: read.prepared?.body,
      },
    });
    expect(saved.code).toBe("saved");
    const [template] = await sql.unsafe(
      `select body, org_id, prepared_by_one from public.draft_templates where id = $1`,
      [String(saved.template_id)],
    );
    expect(template?.org_id).toBe(FIRM);
    expect(template?.body).toBe(read.prepared?.body);
    expect(template?.prepared_by_one).toBe(false);
    const left = await sql.unsafe(`select id from public.template_imports where id = $1`, [sent.importId]);
    expect(left).toHaveLength(0);
    await keepToPerson(false);
  });

  it("has a PDF transcribed first, and ONE saves the power of attorney by itself as the firm's, the one it sends", async () => {
    const { importNext } = await import("@/lib/library/import-work");
    const sent = await send(
      "Procuracao.pdf",
      "application/pdf",
      await onePagePdf("PROCURACAO de exemplo"),
      "procuracao",
    );

    expect(await importNext(backend() as never, sent.importId)).toBe("read");
    const transcription = model.asked.at(-1);
    expect(transcription?.task).toBe("transcricao");
    expect(transcription?.attachments.map((attachment) => [attachment.kind, attachment.mime])).toEqual([
      ["document", "application/pdf"],
    ]);
    expect(bucket.has(sent.path)).toBe(false);

    // Nothing to look at, and the firm lets ONE: the marking owes the save, and the save is ONE's.
    expect(await importNext(backend() as never, sent.importId)).toBe("saving");
    expect(model.asked.at(-1)?.text).toContain(
      "O escritório mandou este documento como a procuração que o escritório usa.",
    );
    expect(await importNext(backend() as never, sent.importId)).toBe("saved");

    const read = await view(sent.importId);
    expect(read.status).toBe("saved");
    expect(read.source).toBe("pdf");
    expect(read.prepared?.documentKind).toBe("procuracao");
    expect(read.prepared?.checks).toEqual([]);
    const [request] = await sql.unsafe(`select saved_template_id from public.template_imports where id = $1`, [
      sent.importId,
    ]);
    const [template] = await sql.unsafe(
      `select name, body, document_kind, is_default, prepared_by_one, created_by from public.draft_templates where id = $1`,
      [String(request?.saved_template_id)],
    );
    expect(template).toEqual({
      name: "Procuração do escritório",
      body: ["PROCURAÇÃO", "OUTORGANTE: [[OUTORGANTE]].", "[[LOCAL_DATA]]."].join("\n\n"),
      document_kind: "procuracao",
      is_default: true,
      prepared_by_one: true,
      created_by: ANA,
    });
    // It is the paper ONE sends now, as `paper_template_for` decides it among the firm's and the platform's models.
    const { paperModelFor } = await import("@/lib/library/facts");
    const rows = await sql.unsafe(
      `select id, org_id, document_kind, proceeding_kind, is_default from public.draft_templates
       where org_id = $1 or org_id is null`,
      [FIRM],
    );
    expect(paperModelFor(rows as never, FIRM, "procuracao")).toBe(String(request?.saved_template_id));
  });

  it("refuses a contract sent as the power of attorney, saying what it is", async () => {
    const { importNext } = await import("@/lib/library/import-work");
    const sent = await send("Contrato.docx", DOCX, wordFile(CONTRACT), "procuracao");
    expect(await importNext(backend() as never, sent.importId)).toBe("read");
    expect(await importNext(backend() as never, sent.importId)).toBe("refused");
    const read = await view(sent.importId);
    expect([read.status, read.refusal, read.prepared]).toEqual([
      "refused",
      { code: "wrong_kind", found: "contrato", what: "um contrato de honorários", missing: [] },
      null,
    ]);
    const { readPaperImports } = await import("@/lib/library/import-read");
    const papers = await readPaperImports(asAna() as never, FIRM);
    expect(papers.procuracao).toMatchObject({ id: sent.importId, status: "refused" });
  });

  it("asks the firm what only it knows, and saves the contract with the answer in it", async () => {
    const { importNext } = await import("@/lib/library/import-work");
    const sent = await send("Contrato do escritorio.docx", DOCX, wordFile(CONTRACT), "contrato");
    expect(await importNext(backend() as never, sent.importId)).toBe("read");
    expect(await importNext(backend() as never, sent.importId)).toBe("asking");
    const asking = await view(sent.importId);
    expect([asking.status, asking.round, asking.questions]).toEqual([
      "asking",
      1,
      [{ question: "Qual é o percentual dos honorários?", why: "O contrato o deixa em branco." }],
    ]);
    // Nothing is owed while the firm has not answered.
    expect(await importNext(backend() as never, sent.importId)).toBe("none");

    expect(
      (
        await call(asAna(), "answer_template_import", {
          target_import: sent.importId,
          target_answers: ["30% do proveito econômico"],
        })
      ).code,
    ).toBe("answered");
    expect(await importNext(backend() as never, sent.importId)).toBe("saving");
    expect(model.asked.at(-1)?.text).toContain(
      "Pergunta: Qual é o percentual dos honorários?\nResposta: 30% do proveito econômico",
    );
    expect(await importNext(backend() as never, sent.importId)).toBe("saved");
    const [template] = await sql.unsafe(
      `select t.body, t.is_default from public.draft_templates t
       join public.template_imports i on i.saved_template_id = t.id where i.id = $1`,
      [sent.importId],
    );
    expect(template?.body).toContain("HONORÁRIOS: 30% do proveito econômico.");
    expect(template?.is_default).toBe(true);
  });

  it("refuses a document that is no model ONE uses, and another firm reads nothing of what ONE does", async () => {
    const { importNext } = await import("@/lib/library/import-work");
    const sent = await send("Contestacao.docx", DOCX, wordFile(["CONTESTAÇÃO", "A ré contesta o pedido."]));
    expect(await importNext(backend() as never, sent.importId)).toBe("read");
    expect(await importNext(backend() as never, sent.importId)).toBe("refused");
    const read = await view(sent.importId);
    expect([read.status, read.refusal?.code, read.refusal?.what, read.prepared]).toEqual([
      "refused",
      "other_document",
      "uma contestação",
      null,
    ]);

    const { data } = await asDavi().from("template_imports").select("id").eq("org_id", FIRM);
    expect(data ?? []).toEqual([]);
    // Nothing is owed any more: the sweep finds no work.
    expect(await importNext(backend() as never, null)).toBe("none");
  });
});
