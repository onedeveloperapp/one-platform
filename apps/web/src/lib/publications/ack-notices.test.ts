import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Write = (copy: Record<string, (...args: unknown[]) => unknown>) => unknown;
const sent: { to: string[]; key: string | undefined; text: unknown }[] = [];
const copy = {
  publicationTriaged: (what: unknown, where: unknown) => ({ title: `triou ${what} ${where}` }),
  publicationAckLate: (what: unknown, where: unknown, hours: unknown) => ({
    title: `atrasada ${what} ${where} ${hours}`,
  }),
};
vi.mock("@/lib/notifications", () => ({
  notifyLocalized: async (to: string[], write: Write, options: { sourceKey?: string }) => {
    sent.push({ to, key: options.sourceKey, text: write(copy) });
    return { sent: true, created: to.length, createdFor: to };
  },
}));

const { tellPublicationAcks } = await import("@/lib/publications/ack-notices");

/** A backend that answers what is owed and the setting of the hours, and keeps what it was asked. */
function backend(rows: unknown[]) {
  const asked: { rpc: [string, unknown][]; settings: number } = { rpc: [], settings: 0 };
  const service = {
    rpc: async (name: string, args: unknown) => (asked.rpc.push([name, args]), { data: rows, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (asked.settings++, { data: { value: { ack_late_hours: 6 } }, error: null }),
        }),
      }),
    }),
  };
  return { service: service as never, asked };
}

const row = (extra: Record<string, unknown>) => ({
  publication_id: "p1",
  case_id: "c1",
  seq: 12,
  category: "audiencia",
  told_key: "pub-ack:p1",
  to_tell: [],
  reminder_key: "pub-ack-late:p1:2026-11-25",
  to_remind: [],
  ...extra,
});

describe("the bell of the awareness of ONE's triage (0295)", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("with nothing owed, reads one answer and writes nothing", async () => {
    const { service, asked } = backend([]);
    const outcomes = await tellPublicationAcks(service, Date.now() + 60_000);
    expect(asked.rpc).toEqual([["publication_acks_owed", { target_limit: 200, target_publication: undefined }]]);
    expect(asked.settings).toBe(0);
    expect(sent).toEqual([]);
    expect(outcomes).toEqual({ told: 0, reminded: 0 });
  });

  it("tells only who the database says is owed, under the keys it gave", async () => {
    const { service } = backend([
      row({ to_tell: ["bia"] }),
      row({
        publication_id: "p2",
        case_id: null,
        seq: null,
        category: "prazo",
        told_key: "pub-ack:p2",
        reminder_key: "pub-ack-late:p2:2026-11-25",
        to_remind: ["ana", "caio"],
      }),
    ]);
    const outcomes = await tellPublicationAcks(service, Date.now() + 60_000);
    expect(sent).toEqual([
      { to: ["bia"], key: "pub-ack:p1", text: { title: "triou uma audiência do caso nº 12" } },
      { to: ["ana", "caio"], key: "pub-ack-late:p2:2026-11-25", text: { title: "atrasada um prazo  6" } },
    ]);
    expect(outcomes).toEqual({ told: 1, reminded: 1 });
  });

  it("asks for the one publication ONE has just triaged", async () => {
    const { service, asked } = backend([row({ to_tell: ["bia"] })]);
    await tellPublicationAcks(service, Date.now() + 60_000, "p1");
    expect(asked.rpc).toEqual([["publication_acks_owed", { target_limit: 200, target_publication: "p1" }]]);
  });

  it("starts nothing once its time is over", async () => {
    const { service } = backend([row({ to_tell: ["bia"] })]);
    await tellPublicationAcks(service, Date.now() - 1);
    expect(sent).toEqual([]);
  });
});
