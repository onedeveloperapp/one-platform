// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * The firm's books from a bank's statement (migration 0126), with the app's own code against a real database: Ana, a
 * partner, opens the books and an account; a statement in OFX is read as the browser reads it (never uploaded), its
 * lines sent and finished; ONE sets the court's release apart as a client's money and joins the bill to the entry Ana
 * wrote by hand; the fees wait for her; and the home the screen reads says the balance, the month's numbers and the
 * lines that wait. Caio, who reads only the costs of the cases, reads nothing of it.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped. Every
 * person, firm and number here is invented.
 */

vi.mock("server-only", () => ({}));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;

const ANA = "ae950000-0000-4000-8000-000000000001";
const CAIO = "ae950000-0000-4000-8000-000000000002";
const FIRM = "be950000-0000-4000-8000-00000000000a";

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });

async function ok(result: { data: unknown; error: { message: string } | null }): Promise<Row> {
  expect(result.error).toBeNull();
  const answer = result.data as Row;
  expect(answer.ok, JSON.stringify(answer)).toBe(true);
  return answer;
}

const day = (shift: number) => {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  today.setDate(today.getDate() + shift);
  return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
};
const iso = (ofx: string) => `${ofx.slice(0, 4)}-${ofx.slice(4, 6)}-${ofx.slice(6, 8)}`;

const OFX = () => `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0341<ACCTID>99999-1</BANKACCTFROM>
<BANKTRANLIST><DTSTART>${day(-30)}<DTEND>${day(-1)}
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${day(-20)}<TRNAMT>2500.00<FITID>R1<MEMO>TED ALVARA JUDICIAL TJGO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${day(-10)}<TRNAMT>-189.90<FITID>R2<MEMO>PAG BOLETO ENERGIA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${day(-5)}<TRNAMT>3000.00<FITID>R3<MEMO>PIX RECEBIDO HONORÁRIOS</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>6310.10<DTASOF>${day(-1)}</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe.skipIf(!DB_URL)("the books from a bank's statement", () => {
  let account = "";

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id in ('${ANA}', '${CAIO}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@livros-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
        ('${CAIO}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'caio@livros-app.invalid', '', now(), '{}', '{"display_name":"Caio Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-livros-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${FIRM}', '${CAIO}', 'member', 'advogado');
    `);
    await ok(await as(ANA).rpc("open_finance_books", { target_org: FIRM, target_first_day: iso(day(-60)) }));
    const saved = await ok(
      await as(ANA).rpc("save_finance_account", {
        target_org: FIRM,
        target_account: null,
        fields: { kind: "bank", name: "Itaú PJ", institution: "Itaú", number_tail: "9991", opening_cents: "100000" },
      }),
    );
    account = String(saved.account_id);
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id in ('${ANA}', '${CAIO}')`);
    await sql.end({ timeout: 5 });
  });

  it("reads the statement as the browser does, and ONE decides what its rules decide", async () => {
    const [category] = await sql.unsafe(
      `select id from public.finance_categories where org_id = $1 and code = 'despesa.utilidades'`,
      [FIRM],
    );
    await ok(
      await as(ANA).rpc("save_finance_entry", {
        target_org: FIRM,
        fields: {
          kind: "expense",
          account_id: account,
          cents: "-18990",
          category_id: category.id,
          counterparty: "Energia Teste",
          occurred_on: iso(day(-12)),
        },
      }),
    );

    const { readStatementFile } = await import("@/lib/finance/statement-file");
    // A file of an OFX 1 bank, in Windows-1252 as its header says: its accent read as written.
    const latin = await readStatementFile(new File([Buffer.from(OFX(), "latin1")], "latin.ofx"));
    expect(latin.ok && latin.statement.lines[2].memo).toBe("PIX RECEBIDO HONORÁRIOS");
    // And one whose header says 1252 over UTF-8 bytes, as some banks write it.
    const bytes = new TextEncoder().encode(OFX());
    const read = await readStatementFile(new File([bytes], "itau.ofx"));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.statement.lines.map((line) => [line.cents, line.memo])).toEqual([
      [250000, "TED ALVARA JUDICIAL TJGO"],
      [-18990, "PAG BOLETO ENERGIA"],
      [300000, "PIX RECEBIDO HONORÁRIOS"],
    ]);

    const begun = await ok(
      await as(ANA).rpc("begin_finance_statement", {
        target_org: FIRM,
        target_account: account,
        fields: {
          file_name: read.fileName,
          sha256: read.sha256,
          starts_on: read.statement.startsOn,
          ends_on: read.statement.endsOn,
          balance_cents: String(read.statement.balance?.cents),
          balance_on: read.statement.balance?.on,
        },
      }),
    );
    const sent = await ok(
      await as(ANA).rpc("add_finance_statement_lines", {
        target_org: FIRM,
        target_statement: begun.statement_id,
        target_lines: read.statement.lines.map((line) => ({
          bank_id: line.bankId,
          posted_on: line.postedOn,
          cents: String(line.cents),
          memo: line.memo,
        })),
      }),
    );
    expect(sent).toMatchObject({ added: 3, known: 0, repeated: 0 });
    const finished = await ok(
      await as(ANA).rpc("finish_finance_statement", { target_org: FIRM, target_statement: begun.statement_id }),
    );
    expect(finished).toMatchObject({ decided: 2, pending: 1 });
    // The books lack the fees still to decide: 100000 + 250000 - 18990 = 331010, the bank 631010.
    expect(finished.balance_gap_cents).toBe(-300000);

    const again = await as(ANA).rpc("begin_finance_statement", {
      target_org: FIRM,
      target_account: account,
      fields: { file_name: "de-novo.ofx", sha256: read.sha256 },
    });
    expect(again.data).toMatchObject({ ok: false, code: "already_imported" });
  });

  it("gives the screen the home of the books, and nothing to who reads only the costs of the cases", async () => {
    const { readFinanceHome, readFinanceAccess } = await import("@/lib/finance/read");
    const home = await readFinanceHome(as(ANA) as never, FIRM);
    expect(home).not.toBe("error");
    if (!home || home === "error") return;
    expect(home.level).toBe("configure");
    expect(home.accounts.map((item) => [item.name, item.balanceCents, item.pending, item.balanceGapCents])).toEqual([
      ["Itaú PJ", 331010, 1, -300000],
    ]);
    expect(home.numbers.clientMoney.now).toBe(250000);
    expect(home.pendingLines).toBe(1);

    expect(await readFinanceHome(as(CAIO) as never, FIRM)).toBeNull();
    expect(await readFinanceAccess(as(CAIO) as never, FIRM)).toEqual({ level: "costs", opened: true, decides: false });
  });

  it("reads a statement in CSV as the browser does, and says what waits only to who reads the books (0127)", async () => {
    const saved = await ok(
      await as(ANA).rpc("save_finance_account", {
        target_org: FIRM,
        target_account: null,
        fields: { kind: "bank", name: "Banco do Brasil", opening_cents: "0" },
      }),
    );
    const { readStatementFile } = await import("@/lib/finance/statement-file");
    const br = (ofx: string) => `${ofx.slice(6, 8)}/${ofx.slice(4, 6)}/${ofx.slice(0, 4)}`;
    const text = [
      "Data;Lançamento;Detalhes;Valor;Tipo Lançamento",
      `${br(day(-15))};Pix - Recebido;LEVANTAMENTO JUDICIAL;1.200,00;Entrada`,
      `${br(day(-14))};Tarifa;Pacote de serviços;15,00;Saída`,
      `${br(day(-14))};Tarifa;Pacote de serviços;15,00;Saída`,
      `${br(day(-1))};Saldo do dia;;;`,
    ].join("\n");
    const read = await readStatementFile(new File([new TextEncoder().encode(text)], "bb.csv"));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.format).toBe("csv");
    expect(read.statement.lines.map((line) => line.cents)).toEqual([120000, -1500, -1500]);
    expect(new Set(read.statement.lines.map((line) => line.bankId)).size).toBe(3);

    const begun = await ok(
      await as(ANA).rpc("begin_finance_statement", {
        target_org: FIRM,
        target_account: saved.account_id,
        fields: { file_name: read.fileName, sha256: read.sha256, format: read.format },
      }),
    );
    const sent = await ok(
      await as(ANA).rpc("add_finance_statement_lines", {
        target_org: FIRM,
        target_statement: begun.statement_id,
        target_lines: read.statement.lines.map((line) => ({
          bank_id: line.bankId,
          posted_on: line.postedOn,
          cents: String(line.cents),
          memo: line.memo,
        })),
      }),
    );
    expect(sent).toMatchObject({ added: 3, repeated: 1 });
    await ok(await as(ANA).rpc("finish_finance_statement", { target_org: FIRM, target_statement: begun.statement_id }));

    const { readFinanceAttention } = await import("@/lib/finance/attention");
    const { data } = await as(ANA).rpc("firm_finance_attention", { target_org: FIRM });
    const attention = readFinanceAttention(data);
    // The court's release of the OFX and the judicial withdrawal of the CSV, both to set apart.
    expect(attention?.apart.count).toBe(2);
    expect(attention?.lines.count).toBe(3);
    const { data: caio } = await as(CAIO).rpc("firm_finance_attention", { target_org: FIRM });
    expect(readFinanceAttention(caio)).toBeNull();
  });

  it("settles a bill to receive when the statement shows it, as ONE's, and gives the screen the bill paid (0129)", async () => {
    const { data: accounts } = await as(ANA)
      .from("finance_accounts")
      .select("id")
      .eq("org_id", FIRM)
      .eq("name", "Itaú PJ");
    const account = String((accounts ?? [])[0]?.id);
    const [category] = await sql.unsafe(
      `select id from public.finance_categories where org_id = $1 and code = 'receita.contratuais'`,
      [FIRM],
    );
    const { readBoleto, arrecadacaoBarcode, arrecadacaoLine } = await import("@flyee/rules/boleto");
    // A typed line the browser checks before the bill is written (an arrecadação, here, carrying its value).
    const line = arrecadacaoLine(arrecadacaoBarcode("846" + "00000080000" + "0048" + "20261120" + "12345678901234567"));
    const read = readBoleto(line, iso(day(0)));
    expect(read.ok && read.boleto.cents).toBe(80000);
    await ok(
      await as(ANA).rpc("save_finance_bill", {
        target_org: FIRM,
        target_bill: null,
        fields: {
          direction: "receive",
          counterparty: "Maria Teste",
          category_id: category.id,
          cents: "80000",
          due_on: iso(day(-3)),
          typed_line: read.ok ? read.boleto.line : "",
          barcode: read.ok ? read.boleto.barcode : "",
        },
      }),
    );
    const begun = await ok(
      await as(ANA).rpc("begin_finance_statement", {
        target_org: FIRM,
        target_account: account,
        fields: { file_name: "itau-2.ofx", sha256: "c".repeat(64) },
      }),
    );
    await ok(
      await as(ANA).rpc("add_finance_statement_lines", {
        target_org: FIRM,
        target_statement: begun.statement_id,
        target_lines: [{ bank_id: "BILL1", posted_on: iso(day(-2)), cents: "80000", memo: "PIX RECEBIDO" }],
      }),
    );
    const finished = await ok(
      await as(ANA).rpc("finish_finance_statement", { target_org: FIRM, target_statement: begun.statement_id }),
    );
    expect(finished.decided).toBe(1);

    const { readFinanceBills } = await import("@/lib/finance/read");
    const bills = await readFinanceBills(as(ANA) as never, FIRM);
    expect(bills?.map((item) => [item.counterparty, item.status, item.byOne, item.paidCents])).toEqual([
      ["Maria Teste", "paid", true, 80000],
    ]);
    expect(await readFinanceBills(as(CAIO) as never, FIRM)).toEqual([]);
  });
});
