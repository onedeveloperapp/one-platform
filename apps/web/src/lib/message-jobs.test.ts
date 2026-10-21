// @vitest-environment node
import {
  keptAccess,
  notifySubscriptionEnded,
  sendAccessEndNotices,
  sendTermEndNotices,
  settleAccessEndings,
} from "./billing-notices";
import { deliverNewsletter, deliverNewsletterBatch } from "./newsletter";
import { decodeUnsubscribeCookie, encodeUnsubscribeCookie, parseUnsubscribe, unsubscribe } from "./unsubscribe";
import { isNewAccount, welcomeOnce } from "./welcome";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The jobs are wired to Inngest, Resend and the service role. None of that is
 * what these tests are about. What is worth pinning is the bookkeeping: who is
 * written to, that nobody is written to twice, what happens when the provider
 * refuses a request or does not exist, and that a notice never takes a billing
 * event down with it.
 */
const mocks = vi.hoisted(() => ({
  configured: true,
  service: null as unknown,
  notifyUser: vi.fn(),
  notifyLocalized: vi.fn(),
  sendNewsletterBatch: vi.fn(),
  sendSubscriptionCanceledEmail: vi.fn(),
  sendTermEndingEmail: vi.fn(),
  sendAccessEndedEmail: vi.fn(),
  sendMemberWelcomeEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, delete: () => undefined }) }));
vi.mock("@flyee/jobs", () => ({
  inngest: { createFunction: () => ({}) },
  sendEvent: vi.fn(async () => ({ sent: false, hint: "no queue in tests" })),
}));
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => mocks.service }));
vi.mock("@/lib/notifications", () => ({ notifyUser: mocks.notifyUser, notifyLocalized: mocks.notifyLocalized }));
vi.mock("@flyee/email", () => ({
  BATCH_LIMIT: 100,
  get isEmailConfigured() {
    return mocks.configured;
  },
  sendNewsletterBatch: mocks.sendNewsletterBatch,
  sendSubscriptionCanceledEmail: mocks.sendSubscriptionCanceledEmail,
  sendTermEndingEmail: mocks.sendTermEndingEmail,
  sendAccessEndedEmail: mocks.sendAccessEndedEmail,
  sendMemberWelcomeEmail: mocks.sendMemberWelcomeEmail,
  sendKitReceiptEmail: vi.fn(),
  sendSubscriptionActiveEmail: vi.fn(),
}));

type Answer = { data?: unknown; error?: { message: string } | null; count?: number | null };
type Query = { table: string; calls: [string, ...unknown[]][] };

/**
 * A stand-in for the service client. `rpc` answers come from a handler per
 * function name; a table answers through a handler that sees every call made
 * on the query (select, eq, in, update…), so a test can assert on the filters.
 */
function fakeService(handlers: {
  rpc?: Record<string, (args: Record<string, unknown>) => Answer>;
  tables?: Record<string, (query: Query) => Answer>;
  storage?: { list: () => Answer; remove: (paths: string[]) => Answer };
}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const queries: Query[] = [];

  const builder = (table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const answer = () => ({ data: null, error: null, ...(handlers.tables?.[table]?.(query) ?? {}) });
    const proxy: unknown = new Proxy(
      {},
      {
        get(_, name: string) {
          if (name === "then") {
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(answer()).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            query.calls.push([name, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const service = {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      const handler = handlers.rpc?.[fn];
      if (!handler) throw new Error(`unexpected rpc: ${fn}`);
      return { data: null, error: null, ...handler(args) };
    },
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        list: async () => ({ data: null, error: null, ...(handlers.storage?.list() ?? {}) }),
        remove: async (paths: string[]) => ({ data: null, error: null, ...(handlers.storage?.remove(paths) ?? {}) }),
      }),
    },
  };
  return { service: service as unknown as SupabaseClient, rpcCalls, queries };
}

const recipient = (userId: string, overrides: Record<string, unknown> = {}) => ({
  user_id: userId,
  email: `${userId}@example.invalid`,
  display_name: userId,
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
  marketing_email_opt_out: false,
  email_unsubscribe_token: "00000000-0000-4000-8000-0000000000aa",
  ...overrides,
});

const recipients =
  (...rows: ReturnType<typeof recipient>[]) =>
  (args: Record<string, unknown>) => ({
    data: rows.filter((row) => (args.target_users as string[]).includes(row.user_id)),
  });

beforeEach(() => {
  mocks.configured = true;
  mocks.service = null;
  mocks.notifyUser.mockReset().mockResolvedValue({ sent: true, created: 1, createdFor: ["x"] });
  mocks.notifyLocalized.mockReset().mockResolvedValue({ sent: true, created: 1, createdFor: ["x"] });
  mocks.sendNewsletterBatch
    .mockReset()
    .mockImplementation(async (messages: unknown[]) => ({ sent: true, count: messages.length }));
  mocks.sendSubscriptionCanceledEmail.mockReset().mockResolvedValue({ sent: true });
  mocks.sendTermEndingEmail.mockReset().mockResolvedValue({ sent: true });
  mocks.sendAccessEndedEmail.mockReset().mockResolvedValue({ sent: true });
  mocks.sendMemberWelcomeEmail.mockReset().mockResolvedValue({ sent: true });
});

describe("a message to the list", () => {
  const lead = (id: string, locale = "pt-BR") => ({
    lead_id: id,
    email: `${id}@example.invalid`,
    locale,
    unsubscribe_token: "00000000-0000-4000-8000-0000000000bb",
    subject: "Abrimos",
    body_md: "O ONE abriu.",
  });

  it("claims, sends and counts a batch, each reader with their own unsubscribe address", async () => {
    const { service, rpcCalls } = fakeService({
      rpc: {
        claim_newsletter_batch: () => ({ data: [lead("l1"), lead("l2", "en")] }),
        settle_newsletter_batch: () => ({}),
      },
    });
    expect(await deliverNewsletterBatch(service, "send-1")).toEqual({ claimed: 2, delivered: 2 });

    const messages = mocks.sendNewsletterBatch.mock.calls[0][0];
    expect(messages[0]).toMatchObject({ to: "l1@example.invalid", locale: "pt-BR", subject: "Abrimos" });
    // A contact stored with another language still reads Portuguese, the one language written.
    expect(messages[1]).toMatchObject({ locale: "pt-BR", subject: "Abrimos", bodyMarkdown: "O ONE abriu." });
    expect(new URL(messages[1].unsubscribeUrl).searchParams.get("k")).toBe("l");
    expect(new URL(messages[1].unsubscribeUrl).searchParams.has("l")).toBe(false);
    expect(rpcCalls[1]).toEqual({
      fn: "settle_newsletter_batch",
      args: { target_send: "send-1", target_leads: ["l1", "l2"], target_delivered: true, target_error: null },
    });
  });

  it("gives the readers back and stops when the provider refuses the batch", async () => {
    mocks.sendNewsletterBatch.mockResolvedValue({ sent: false, count: 0, error: "quota exceeded" });
    const { service, rpcCalls } = fakeService({
      rpc: { claim_newsletter_batch: () => ({ data: [lead("l1")] }), settle_newsletter_batch: () => ({}) },
    });
    expect(await deliverNewsletterBatch(service, "send-1")).toEqual({
      claimed: 1,
      delivered: 0,
      error: "quota exceeded",
    });
    expect(rpcCalls[1].args).toMatchObject({ target_delivered: false, target_error: "quota exceeded" });
  });

  it("closes the send when nobody is left", async () => {
    const { service, rpcCalls } = fakeService({
      rpc: { claim_newsletter_batch: () => ({ data: [] }), finish_newsletter_send: () => ({}) },
    });
    expect(await deliverNewsletterBatch(service, "send-1")).toEqual({ claimed: 0, delivered: 0 });
    expect(rpcCalls.map((call) => call.fn)).toEqual(["claim_newsletter_batch", "finish_newsletter_send"]);
    expect(mocks.sendNewsletterBatch).not.toHaveBeenCalled();
  });

  it("claims nobody when there is no e-mail provider, so the send stays as it is", async () => {
    mocks.configured = false;
    const { service, rpcCalls } = fakeService({});
    expect(await deliverNewsletterBatch(service, "send-1")).toEqual({
      claimed: 0,
      delivered: 0,
      error: "email_not_configured",
    });
    expect(rpcCalls).toEqual([]);
  });

  it("runs batch after batch until the list is exhausted", async () => {
    const batches = [[lead("l1"), lead("l2")], [lead("l3")], []];
    const { service } = fakeService({
      rpc: {
        claim_newsletter_batch: () => ({ data: batches.shift() ?? [] }),
        settle_newsletter_batch: () => ({}),
        finish_newsletter_send: () => ({}),
      },
    });
    expect(await deliverNewsletter(service, "send-1")).toEqual({ batches: 2, delivered: 3, done: true });
  });

  it("stops at the first refused batch and says why", async () => {
    mocks.sendNewsletterBatch.mockResolvedValue({ sent: false, count: 0, error: "quota exceeded" });
    const { service } = fakeService({
      rpc: { claim_newsletter_batch: () => ({ data: [lead("l1")] }), settle_newsletter_batch: () => ({}) },
    });
    expect(await deliverNewsletter(service, "send-1")).toEqual({
      batches: 0,
      delivered: 0,
      done: false,
      error: "quota exceeded",
    });
  });
});

describe("what a firm is told when a subscription ends", () => {
  const entitlements = (sources: unknown[], active = true) => ({
    data: { active, limits: {}, sources },
  });

  it("names the purchase that still stands beyond the floor", async () => {
    const { service } = fakeService({
      rpc: {
        org_entitlements: () =>
          entitlements([
            { type: "free", plan_id: "plan-free" },
            { type: "grant", plan_id: "plan-access" },
          ]),
      },
      tables: { plans: () => ({ data: [{ id: "plan-access", name: "Acesso anual" }] }) },
    });
    expect(await keptAccess(service, "org-1")).toEqual({ by: "Acesso anual" });
  });

  it("says nothing is left when only the floor stands or the firm is suspended", async () => {
    const gone = fakeService({
      rpc: { org_entitlements: () => entitlements([{ type: "free", plan_id: "plan-free" }]) },
    });
    expect(await keptAccess(gone.service, "org-1")).toBeNull();
    const suspended = fakeService({
      rpc: { org_entitlements: () => entitlements([{ type: "grant", plan_id: "p" }], false) },
    });
    expect(await keptAccess(suspended.service, "org-1")).toBeNull();
  });

  it("keeps the access unnamed when no plan stands behind it", async () => {
    const { service } = fakeService({
      rpc: { org_entitlements: () => entitlements([{ type: "grant", plan_id: null }]) },
    });
    expect(await keptAccess(service, "org-1")).toEqual({ by: null });
  });

  it("writes the bell for every person of the firm and the e-mail for who manages it", async () => {
    const { service } = fakeService({
      rpc: {
        org_entitlements: () => entitlements([{ type: "free", plan_id: "plan-free" }]),
        member_recipients: recipients(recipient("owner", { locale: "en" })),
      },
      tables: {
        plans: () => ({ data: { name: "Plano Escritório", limits: {} } }),
        memberships: () => ({ data: [{ user_id: "owner" }] }),
      },
    });
    await notifySubscriptionEnded(service, {
      orgId: "org-1",
      planId: "plan-club",
      cause: "payment",
      endedAt: "2026-10-02T15:00:00Z",
    });

    const [members, write, options] = mocks.notifyLocalized.mock.calls[0];
    expect(members).toEqual(["owner"]);
    expect(options).toMatchObject({ type: "billing", href: "/settings/billing" });
    expect(
      write({ subscriptionEnded: (plan: string, keeps: boolean) => ({ title: plan, body: String(keeps) }) }),
    ).toEqual({
      title: "Plano Escritório",
      body: "false",
    });
    const [to, props] = mocks.sendSubscriptionCanceledEmail.mock.calls[0];
    expect(to).toBe("owner@example.invalid");
    expect(props).toMatchObject({
      locale: "pt-BR",
      planName: "Plano Escritório",
      cause: "payment",
      endedLabel: "2 de outubro de 2026",
      keptAccess: null,
    });
  });

  it("never throws: a notice that fails must not replay the billing event above it", async () => {
    const { service } = fakeService({
      tables: { plans: () => ({ data: { name: "Plano Escritório", limits: {} } }) },
      rpc: { org_entitlements: () => ({ error: { message: "down" } }) },
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      notifySubscriptionEnded(service, { orgId: "org-1", planId: "plan-club", cause: "requested" }),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      "billing_notice_failed",
      expect.objectContaining({ what: "subscription_ended" }),
    );
    expect(mocks.sendSubscriptionCanceledEmail).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("announces the end of a paid period once per claim, keyed by subscription and end date", async () => {
    const { service } = fakeService({
      rpc: {
        claim_term_end_notices: () => ({
          data: [
            {
              subscription_id: "sub-1",
              org_id: "org-1",
              plan_name: "Assinatura anual",
              current_period_end: "2026-10-17T03:00:00Z",
            },
          ],
        }),
        member_recipients: recipients(recipient("owner")),
      },
      tables: { memberships: () => ({ data: [{ user_id: "owner" }] }) },
    });
    expect(await sendTermEndNotices(service)).toEqual({ claimed: 1, notified: 1, emailed: 1 });
    expect(mocks.notifyLocalized.mock.calls[0][2]).toMatchObject({ sourceKey: "term-ending:sub-1:2026-10-17" });
    expect(mocks.sendTermEndingEmail.mock.calls[0][1]).toMatchObject({
      planName: "Assinatura anual",
      endsLabel: "17 de outubro de 2026",
    });
  });

  it("announces the end of an access term with the same words, keyed by the grant", async () => {
    const { service } = fakeService({
      rpc: {
        claim_access_end_notices: () => ({
          data: [
            { grant_id: "grant-1", org_id: "org-1", plan_name: "Acesso anual", expires_at: "2026-10-20T03:00:00Z" },
          ],
        }),
        member_recipients: recipients(recipient("owner")),
      },
      tables: { memberships: () => ({ data: [{ user_id: "owner" }] }) },
    });
    expect(await sendAccessEndNotices(service)).toEqual({ claimed: 1, notified: 1, emailed: 1 });
    expect(mocks.notifyLocalized.mock.calls[0][2]).toMatchObject({ sourceKey: "access-ending:grant-1" });
    expect(mocks.sendTermEndingEmail.mock.calls[0][1]).toMatchObject({
      planName: "Acesso anual",
      endsLabel: "20 de outubro de 2026",
    });
  });

  it("settles an ended access: the firm is told when nothing else is left beyond the floor", async () => {
    const claims = [
      { grant_id: "grant-1", org_id: "org-gone", plan_name: "Acesso anual", expires_at: "2026-10-05T03:00:00Z" },
      { grant_id: "grant-2", org_id: "org-kept", plan_name: "Acesso anual", expires_at: "2026-10-05T03:00:00Z" },
    ];
    const { service } = fakeService({
      rpc: {
        claim_access_endings: () => ({ data: claims }),
        org_entitlements: (args) => ({
          data: {
            active: true,
            limits: {},
            sources:
              args.target_org === "org-kept"
                ? [{ type: "free" }, { type: "subscription", plan_id: "plan-live" }]
                : [{ type: "free" }],
          },
        }),
        member_recipients: recipients(recipient("owner")),
      },
      tables: { memberships: () => ({ data: [{ user_id: "owner" }] }) },
    });
    expect(await settleAccessEndings(service)).toEqual({ claimed: 2, ended: 1, kept: 1, emailed: 1 });
    expect(mocks.notifyLocalized.mock.calls[0][2]).toMatchObject({ sourceKey: "access-ended:grant-1" });
    expect(mocks.sendAccessEndedEmail.mock.calls[0][1]).toMatchObject({
      planName: "Acesso anual",
      endedLabel: "5 de outubro de 2026",
    });
  });
});

describe("the welcome of a new account", () => {
  it("is for an account created within the week", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(isNewAccount("2026-10-02T11:50:00Z", now)).toBe(true);
    expect(isNewAccount("2026-09-27T12:00:00Z", now)).toBe(true);
    expect(isNewAccount("2026-09-20T12:00:00Z", now)).toBe(false);
    expect(isNewAccount(null, now)).toBe(false);
    expect(isNewAccount("not a date", now)).toBe(false);
  });

  it("sends the e-mail only with the first bell notice", async () => {
    mocks.service = fakeService({ rpc: { member_recipients: recipients(recipient("ana", { locale: "en" })) } }).service;
    await welcomeOnce("ana");
    expect(mocks.notifyLocalized.mock.calls[0][2]).toMatchObject({ sourceKey: "welcome", href: "/inicio" });
    expect(mocks.sendMemberWelcomeEmail).toHaveBeenCalledWith(
      "ana@example.invalid",
      expect.objectContaining({ locale: "pt-BR", name: "ana" }),
    );

    mocks.sendMemberWelcomeEmail.mockClear();
    mocks.notifyLocalized.mockResolvedValue({ sent: true, created: 0, createdFor: [] });
    await welcomeOnce("ana");
    expect(mocks.sendMemberWelcomeEmail).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    mocks.notifyLocalized.mockRejectedValue(new Error("down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(welcomeOnce("ana")).resolves.toBeUndefined();
    logged.mockRestore();
  });
});

describe("an unsubscribe link", () => {
  const token = "0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b";

  it("is read from the address and survives the trip through the cookie", () => {
    const member = parseUnsubscribe(new URLSearchParams({ k: "m", t: token }));
    expect(member).toEqual({ kind: "member", token });
    expect(decodeUnsubscribeCookie(encodeUnsubscribeCookie(member!))).toEqual(member);
    const lead = parseUnsubscribe(new URLSearchParams({ k: "l", t: token, l: "en" }));
    expect(lead).toEqual({ kind: "lead", token });
    expect(encodeUnsubscribeCookie(lead!)).toBe(`l:${token}`);
  });

  it("is refused when the kind or the token is not what the platform writes", () => {
    expect(parseUnsubscribe(new URLSearchParams({ k: "x", t: token }))).toBeNull();
    expect(parseUnsubscribe(new URLSearchParams({ k: "m", t: "not-a-token" }))).toBeNull();
    expect(parseUnsubscribe(new URLSearchParams({ k: "constructor", t: token }))).toBeNull();
    expect(parseUnsubscribe(new URLSearchParams())).toBeNull();
    expect(decodeUnsubscribeCookie("m:")).toBeNull();
    expect(decodeUnsubscribeCookie(`z:${token}`)).toBeNull();
    expect(decodeUnsubscribeCookie(null)).toBeNull();
  });

  it("changes the member's preference or the contact's, each through its own function", async () => {
    const fake = fakeService({
      rpc: { unsubscribe_profile: () => ({ data: true }), unsubscribe_lead: () => ({ data: true }) },
    });
    mocks.service = fake.service;
    expect(await unsubscribe({ kind: "member", token })).toBe(true);
    expect(await unsubscribe({ kind: "lead", token })).toBe(true);
    expect(fake.rpcCalls).toEqual([
      { fn: "unsubscribe_profile", args: { p_token: token } },
      { fn: "unsubscribe_lead", args: { target_token: token } },
    ]);
  });

  it("reports a request that could not be carried out", async () => {
    mocks.service = fakeService({ rpc: { unsubscribe_profile: () => ({ error: { message: "down" } }) } }).service;
    expect(await unsubscribe({ kind: "member", token })).toBe(false);
  });
});
