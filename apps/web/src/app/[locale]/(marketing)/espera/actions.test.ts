// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COOKIE_KEYS } from "@/constants";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  deleted: [] as string[],
  headers: new Map<string, string>(),
  rpc: vi.fn(),
  send: vi.fn(),
  emailConfigured: true,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) } : undefined),
    delete: (name: string) => state.deleted.push(name),
  }),
  headers: async () => ({ get: (name: string) => state.headers.get(name) ?? null }),
}));

vi.mock("@flyee/auth/service", () => ({
  createServiceClient: () => ({ rpc: state.rpc }),
}));

vi.mock("@flyee/email", () => ({
  get isEmailConfigured() {
    return state.emailConfigured;
  },
  sendLeadConfirmationEmail: state.send,
}));

const { confirmWaitlist, joinWaitlist } = await import("./actions");

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const valid = { email: " Pessoa@Example.com ", consent: true, locale: "pt-BR" };

beforeEach(() => {
  state.cookies.clear();
  state.deleted = [];
  state.headers.clear();
  state.rpc.mockReset();
  state.send.mockReset();
  state.emailConfigured = true;
  vi.stubEnv("PUBLIC_FORMS_IP_SALT", "");
});

describe("joinWaitlist", () => {
  it("stores the lead and e-mails a link whose token matches the stored hash", async () => {
    state.cookies.set(
      COOKIE_KEYS.attribution,
      encodeURIComponent(JSON.stringify({ origem: "ads", utm_campaign: "launch" })),
    );
    state.cookies.set(COOKIE_KEYS.offerCoupon, "fundador");
    state.rpc.mockResolvedValue({ data: { ok: true, code: "created", send_confirmation: true, locale: "pt-BR" } });
    state.send.mockResolvedValue({ sent: true });

    expect(await joinWaitlist(valid)).toEqual({ status: "sent" });

    const [fn, args] = state.rpc.mock.calls[0];
    expect(fn).toBe("submit_lead");
    expect(args.payload).toMatchObject({
      email: "pessoa@example.com",
      consent: true,
      locale: "pt-BR",
      source: "waitlist",
      cupom: "FUNDADOR",
      origem: "ads",
      utm_campaign: "launch",
    });
    expect(args.target_ip_hash).toBeNull();

    const mail = state.send.mock.calls[0][0];
    expect(mail.to).toBe("pessoa@example.com");
    expect(mail.locale).toBe("pt-BR");
    const url = new URL(mail.confirmUrl);
    expect(url.pathname).toBe("/espera/confirmar");
    expect(sha256(url.searchParams.get("t") ?? "")).toBe(args.target_confirm_token_hash);
  });

  it("writes in Portuguese to an address stored with a language the site is not written in", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, code: "pending", send_confirmation: true, locale: "en" } });
    state.send.mockResolvedValue({ sent: true });
    await joinWaitlist({ ...valid, locale: "en" });
    expect(state.rpc.mock.calls[0][1].payload.locale).toBe("pt-BR");
    const mail = state.send.mock.calls[0][0];
    expect(mail.locale).toBe("pt-BR");
    expect(new URL(mail.confirmUrl).pathname).toBe("/espera/confirmar");
  });

  it("answers the same for an address already on the list, without sending anything", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, code: "already_confirmed", send_confirmation: false } });
    expect(await joinWaitlist(valid)).toEqual({ status: "sent" });
    expect(state.send).not.toHaveBeenCalled();
  });

  it("pseudonymizes the network only with the server secret", async () => {
    vi.stubEnv("PUBLIC_FORMS_IP_SALT", "secret");
    state.headers.set("x-forwarded-for", "203.0.113.7, 10.0.0.1");
    state.rpc.mockResolvedValue({ data: { ok: true, code: "created", send_confirmation: true, locale: "pt-BR" } });
    state.send.mockResolvedValue({ sent: true });
    await joinWaitlist(valid);
    const hash = state.rpc.mock.calls[0][1].target_ip_hash as string;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203");
  });

  it("refuses before touching the database", async () => {
    expect(await joinWaitlist({ ...valid, email: "not-an-email" })).toEqual({ status: "invalid_email" });
    expect(await joinWaitlist({ ...valid, consent: false })).toEqual({ status: "consent_required" });
    // A bot filled the honeypot: it is told it worked, and nothing is stored.
    expect(await joinWaitlist({ ...valid, website: "https://spam.example" })).toEqual({ status: "sent" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("names the window and the failures", async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, code: "rate_limited" } });
    expect(await joinWaitlist(valid)).toEqual({ status: "rate_limited" });
    state.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await joinWaitlist(valid)).toEqual({ status: "error" });
  });

  it("never promises a message the provider did not send", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, code: "created", send_confirmation: true, locale: "pt-BR" } });
    state.send.mockResolvedValue({ sent: false, error: "rejected" });
    expect(await joinWaitlist(valid)).toEqual({ status: "error" });
  });
});

describe("confirmWaitlist", () => {
  it("spends the token held in the cookie", async () => {
    const token = "A".repeat(43);
    state.cookies.set(COOKIE_KEYS.leadConfirm, token);
    state.rpc.mockResolvedValue({ data: { ok: true, code: "confirmed" } });

    expect(await confirmWaitlist()).toEqual({ status: "confirmed" });
    expect(state.rpc).toHaveBeenCalledWith("confirm_lead", { target_token_hash: sha256(token) });
    expect(state.deleted).toContain(COOKIE_KEYS.leadConfirm);
  });

  it("refuses without a token and reports an expired one", async () => {
    expect(await confirmWaitlist()).toEqual({ status: "invalid" });
    expect(state.rpc).not.toHaveBeenCalled();

    state.cookies.set(COOKIE_KEYS.leadConfirm, "B".repeat(43));
    state.rpc.mockResolvedValue({ data: { ok: false, code: "invalid" } });
    expect(await confirmWaitlist()).toEqual({ status: "invalid" });
  });
});
