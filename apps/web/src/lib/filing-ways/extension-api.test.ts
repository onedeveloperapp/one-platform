// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notices/work", () => ({ settleFirmNotices: async () => undefined }));
vi.mock("@/lib/court-robot/planner", () => ({ aiScreenPlanner: () => async () => null }));

const { handleExtensionCall, hashOf, mintToken, receiptBlocks, tokenOf } = await import(
  "@/lib/filing-ways/extension-api"
);
const { TOKEN_PATTERN } = await import("@/lib/filing-ways/extension-protocol");

type Row = Record<string, unknown>;

/** A stand-in of the service client: the functions answer what each test says, the tables hold the rows given. */
function standIn(rpcs: Record<string, (args: Row) => unknown>, tables: Record<string, Row[]> = {}) {
  const called: { name: string; args: Row }[] = [];
  const client = {
    called,
    async rpc(name: string, args: Row) {
      called.push({ name, args });
      const answer = rpcs[name];
      return answer ? { data: answer(args), error: null } : { data: null, error: { message: `no ${name}` } };
    },
    from(table: string) {
      let rows = (tables[table] ?? []).slice();
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null; count: number }) => unknown) =>
          resolve({ data: rows, error: null, count: rows.length }),
      };
      return builder;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.invalid/${path}` },
          error: null,
        }),
      }),
    },
  };
  return client;
}

const TOKEN = `onex_${"a".repeat(43)}`;
const ORG = "b2670000-0000-4000-8000-00000000000a";
const ANA = "a2670000-0000-4000-8000-000000000001";
const CAIO = "a2670000-0000-4000-8000-000000000002";
const BATCH = "c2670000-0000-4000-8000-0000000000aa";

const linked = () => ({ ok: true, link_id: "d2670000-0000-4000-8000-000000000001", org_id: ORG, user_id: ANA });

describe("the backend of the lawyer's extension", () => {
  it("knows a call by the token of its link, and refuses one with none or another", async () => {
    expect(tokenOf(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(tokenOf(`Bearer one_${"a".repeat(43)}`)).toBeNull();
    expect(tokenOf(null)).toBeNull();
    expect(TOKEN_PATTERN.test(mintToken())).toBe(true);
    expect(mintToken()).not.toBe(mintToken());

    const service = standIn({ extension_link_of: () => ({ ok: false, code: "invalid" }) });
    const none = await handleExtensionCall(
      { method: "GET", path: ["situacao"], authorization: null, body: null },
      { service: service as never },
    );
    expect(none).toEqual({ status: 401, body: { ok: false, error: "missing_token" } });
    const other = await handleExtensionCall(
      { method: "GET", path: ["situacao"], authorization: `Bearer ${TOKEN}`, body: null },
      { service: service as never },
    );
    expect(other).toEqual({ status: 401, body: { ok: false, error: "invalid_token" } });
    // Only the token's hash goes to the database.
    expect(service.called[0]?.args).toEqual({ target_token_hash: hashOf(TOKEN) });
  });

  it("links an extension by the code ONE showed the lawyer, and answers its token once", async () => {
    const service = standIn(
      { claim_extension_link: () => ({ ok: true, code: "linked", link_id: "x", org_id: ORG, user_id: ANA }) },
      { profiles: [{ id: ANA, display_name: "Ana Lima" }], organizations: [{ id: ORG, name: "Lima Advogados" }] },
    );
    const bad = await handleExtensionCall(
      { method: "POST", path: ["vincular"], authorization: null, body: { code: "ABC" } },
      { service: service as never },
    );
    expect(bad.status).toBe(400);
    expect(service.called).toHaveLength(0);

    const done = await handleExtensionCall(
      {
        method: "POST",
        path: ["vincular"],
        authorization: null,
        body: { code: "abc-defg", label: "Chrome do escritório" },
      },
      { service: service as never },
    );
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, lawyer: "Ana Lima", firm: "Lima Advogados" });
    const token = String(done.body.token);
    expect(TOKEN_PATTERN.test(token)).toBe(true);
    expect(service.called[0]?.args).toEqual({
      target_code_hash: hashOf("ABCDEFG"),
      target_token_hash: hashOf(token),
      target_label: "Chrome do escritório",
    });
  });

  it("never reaches a batch of another lawyer, nor one filed another way", async () => {
    const service = standIn(
      { extension_link_of: linked, claim_filing_batch: () => ({ claim: 1, learning: true }) },
      {
        filing_batches: [
          {
            id: BATCH,
            org_id: ORG,
            person_id: CAIO,
            system_key: "eproc-tjsp",
            way: "extension",
            status: "approved",
            claims: 0,
          },
        ],
      },
    );
    const call = (path: string[]) =>
      handleExtensionCall(
        { method: "POST", path, authorization: `Bearer ${TOKEN}`, body: { claim: 1 } },
        { service: service as never },
      );
    expect((await call(["lotes", BATCH, "iniciar"])).body).toEqual({ ok: false, error: "not_found" });
    expect((await call(["lotes", BATCH, "proximo"])).body).toEqual({ ok: false, error: "not_found" });
    expect((await call(["lotes", "nao-e-um-id", "iniciar"])).body).toEqual({ ok: false, error: "not_found" });
    expect(service.called.map((call) => call.name)).not.toContain("claim_filing_batch");
  });

  it("does not take a batch another run left in the middle: it only stops", async () => {
    const service = standIn(
      { extension_link_of: linked, claim_filing_batch: () => ({ claim: 2, learning: true }) },
      {
        filing_batches: [
          {
            id: BATCH,
            org_id: ORG,
            person_id: ANA,
            system_key: "eproc-tjsp",
            way: "extension",
            status: "running",
            claims: 1,
          },
        ],
        filing_submissions: [{ id: "s1", batch_id: BATCH, status: "claimed" }],
      },
    );
    const answer = await handleExtensionCall(
      { method: "POST", path: ["lotes", BATCH, "iniciar"], authorization: `Bearer ${TOKEN}`, body: {} },
      { service: service as never },
    );
    expect(answer).toEqual({ status: 409, body: { ok: false, error: "interrupted" } });
    expect(service.called.map((call) => call.name)).not.toContain("claim_filing_batch");
  });

  it("writes the receipt the court's screen showed, with the lawsuit's number as the CNJ writes it", () => {
    const blocks = receiptBlocks({
      system: "eproc do TJSP",
      number: "10001230720998260100",
      at: new Date("2026-11-21T18:30:00Z"),
      text: "Processo distribuído\n\nChave de consulta: abc",
    });
    expect(blocks[0]).toEqual({ kind: "title", text: "Recibo de protocolo" });
    expect(JSON.stringify(blocks)).toContain("1000123-07.2099.8.26.0100");
    expect(JSON.stringify(blocks)).toContain("21/11/2026");
    expect(blocks.filter((block) => block.kind === "paragraph")).toHaveLength(2);
  });
});
