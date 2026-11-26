import { beforeEach, describe, expect, it, vi } from "vitest";

import { accessHref, accessKey, accessOwedOf, accessParams } from "@/lib/filing-ways/access-asks";

vi.mock("server-only", () => ({}));

const sent: { to: string[]; key: string | undefined; href: string | undefined; text: unknown }[] = [];
const delivered: string[] = [];
const copy = {
  filingAccessAsk: (what: unknown, system: unknown) => ({ title: `acesso ${what} ${system}` }),
};
vi.mock("@/lib/notifications", () => ({
  notifyLocalized: async (
    to: string[],
    write: (words: typeof copy) => unknown,
    options: { sourceKey?: string; href?: string },
  ) => {
    sent.push({ to, key: options.sourceKey, href: options.href, text: write(copy) });
    return { sent: true, created: to.length, createdFor: to };
  },
}));
vi.mock("@/lib/whatsapp/send", () => ({
  deliverOutbox: async (_service: unknown, input: { messageId: string }) => {
    delivered.push(input.messageId);
  },
}));

const { askFilingAccess } = await import("@/lib/filing-ways/access-asks-work");

const row = (extra: Record<string, unknown> = {}) => ({
  package_id: "p1",
  org_id: "f1",
  case_id: "c1",
  seq: 19,
  proceeding_id: "l1",
  system_key: "pje-tjrj",
  system_name: "PJe do TJRJ",
  user_id: "u1",
  ...extra,
});

/** A backend that answers what is owed, the names, and each reservation, and keeps what it was asked. */
function backend(rows: unknown[], reserve: (args: Record<string, unknown>) => unknown) {
  const asked: { rpc: [string, unknown][]; names: number } = { rpc: [], names: 0 };
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      asked.rpc.push([name, args]);
      return { data: name === "filing_access_owed" ? rows : reserve(args), error: null };
    },
    from: () => ({
      select: () => ({
        in: async () => (asked.names++, { data: [{ id: "u1", display_name: "Ana Lima" }], error: null }),
      }),
    }),
  };
  return { service: service as never, asked };
}

describe("ONE asking a lawyer's access at a court's screen (0304)", () => {
  beforeEach(() => {
    sent.length = 0;
    delivered.length = 0;
  });

  it("reads what the database answers and says the ask in the firm's template's words", () => {
    expect(accessOwedOf([row(), { package_id: "p2" }, null])).toEqual([
      {
        packageId: "p1",
        caseId: "c1",
        seq: 19,
        proceedingId: "l1",
        systemKey: "pje-tjrj",
        systemName: "PJe do TJRJ",
        userId: "u1",
      },
    ]);
    expect(accessParams("Ana Lima", { seq: 19, systemName: "PJe do TJRJ" })).toEqual([
      "Ana",
      "PJe do TJRJ",
      "a ação do caso nº 19 está pronta, e falta você escolher como o ONE protocola por você",
    ]);
    expect(accessKey({ proceedingId: "l1", systemKey: "pje-tjrj" })).toBe("filing-access:l1:pje-tjrj");
    expect(accessHref({ caseId: "c1", systemKey: "pje-tjrj" })).toBe("/casos/c1?acesso=pje-tjrj#case-filing");
  });

  it("with nothing owed, reads one answer and writes nothing", async () => {
    const { service, asked } = backend([], () => ({}));
    expect(await askFilingAccess(service, Date.now() + 60_000)).toEqual({ asked: 0, whatsapp: 0, skipped: 0, gone: 0 });
    expect(asked.rpc).toEqual([["filing_access_owed", { target_limit: 50 }]]);
    expect(asked.names).toBe(0);
    expect(sent).toEqual([]);
  });

  it("keeps the ask first, then rings the bell with the case open on the choice, and sends the message", async () => {
    const { service, asked } = backend(
      [row(), row({ package_id: "p2", proceeding_id: "l2", system_key: "eproc-tjsp", system_name: "eproc do TJSP" })],
      (args) => (args.target_package === "p1" ? { code: "queued", message_id: "m1" } : { code: "skipped" }),
    );
    expect(await askFilingAccess(service, Date.now() + 60_000)).toEqual({ asked: 2, whatsapp: 1, skipped: 1, gone: 0 });
    expect(asked.rpc[1]).toEqual([
      "reserve_filing_access_ask",
      {
        target_package: "p1",
        target_user: "u1",
        target_params: [
          "Ana",
          "PJe do TJRJ",
          "a ação do caso nº 19 está pronta, e falta você escolher como o ONE protocola por você",
        ],
      },
    ]);
    expect(sent).toEqual([
      {
        to: ["u1"],
        key: "filing-access:l1:pje-tjrj",
        href: "/casos/c1?acesso=pje-tjrj#case-filing",
        text: { title: "acesso A ação do caso nº 19 PJe do TJRJ" },
      },
      {
        to: ["u1"],
        key: "filing-access:l2:eproc-tjsp",
        href: "/casos/c1?acesso=eproc-tjsp#case-filing",
        text: { title: "acesso A ação do caso nº 19 eproc do TJSP" },
      },
    ]);
    expect(delivered).toEqual(["m1"]);
  });

  it("rings nothing for an ask the database no longer owes, and starts nothing once its time is over", async () => {
    const gone = backend([row()], () => ({ code: "not_owed" }));
    expect(await askFilingAccess(gone.service, Date.now() + 60_000)).toMatchObject({ asked: 0, gone: 1 });
    const late = backend([row()], () => ({ code: "queued", message_id: "m1" }));
    await askFilingAccess(late.service, Date.now() - 1);
    expect(late.asked.rpc.map(([name]) => name)).toEqual(["filing_access_owed"]);
    expect(sent).toEqual([]);
  });
});
