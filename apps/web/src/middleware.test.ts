// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COOKIE_KEYS } from "@/constants";

/**
 * The session refresh is the one piece that cannot run here (no Supabase):
 * this stand-in does what @supabase/ssr does on a refresh, rewriting the
 * request cookies and setting the new ones on a fresh NextResponse.next.
 */
const session = vi.hoisted(() => ({ user: null as { id: string } | null, refreshes: false }));

vi.mock("@flyee/auth/middleware", () => ({
  updateSession: async (request: NextRequest) => {
    let response = NextResponse.next({ request });
    if (session.refreshes) {
      request.cookies.set("sb-test-auth-token", "fresh");
      response = NextResponse.next({ request });
      response.cookies.set("sb-test-auth-token", "fresh", { path: "/", httpOnly: true });
    }
    return { response, user: session.user, needsMfa: false, impersonating: false };
  },
}));

const { middleware } = await import("./middleware");

const DOCUMENT = { accept: "text/html,application/xhtml+xml" };

const request = (path: string, headers: Record<string, string> = DOCUMENT) =>
  new NextRequest(new URL(path, "http://localhost"), { headers }) as never;

const pathOf = (header: string | null) => (header ? new URL(header, "http://localhost").pathname : null);

beforeEach(() => {
  session.user = null;
  session.refreshes = false;
});

describe("middleware: routing of the public site", () => {
  it("serves a public address from the internal route", async () => {
    const response = await middleware(request("/contato"));
    expect(pathOf(response.headers.get("x-middleware-rewrite"))).toBe("/pt-BR/contato");
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects the prefixed address to the canonical one, keeping the query string", async () => {
    const response = await middleware(request("/pt-BR/contato"));
    expect(pathOf(response.headers.get("location"))).toBe("/contato");
    const withQuery = await middleware(request("/pt-BR/contato?cupom=PILOTO"));
    expect(withQuery.headers.get("location")).toMatch(/\/contato\?cupom=PILOTO$/);
  });

  it("lets an anonymous visitor read the public site but not the app", async () => {
    expect((await middleware(request("/ajuda/primeiros-passos"))).headers.get("location")).toBeNull();
    const app = await middleware(request("/inicio"));
    expect(app.headers.get("location")).toMatch(/\/auth\/sign-in\?next=%2Finicio$/);
    // A locale prefix does not make an app route public.
    const prefixed = await middleware(request("/pt-BR/inicio"));
    expect(pathOf(prefixed.headers.get("location"))).toBe("/auth/sign-in");
  });

  it("treats an address in a language the site is not written in like any unknown one", async () => {
    for (const address of ["/en", "/en/contato", "/contact"]) {
      const response = await middleware(request(address));
      expect(response.headers.get("x-middleware-rewrite"), address).toBeNull();
      expect(pathOf(response.headers.get("location")), address).toBe("/auth/sign-in");
    }
  });

  it("carries the refreshed session into the rewritten request and the response", async () => {
    session.refreshes = true;
    const response = await middleware(request("/contato", { ...DOCUMENT, cookie: "sb-test-auth-token=stale" }));
    expect(pathOf(response.headers.get("x-middleware-rewrite"))).toBe("/pt-BR/contato");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("fresh");
    // What the server components of the page will read.
    expect(response.headers.get("x-middleware-request-cookie")).toContain("sb-test-auth-token=fresh");
  });

  it("writes no language cookie, whatever the browser asks for", async () => {
    session.user = { id: "member" };
    for (const path of ["/contato", "/inicio"]) {
      const response = await middleware(
        request(path, { ...DOCUMENT, "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0" }),
      );
      const names = response.cookies.getAll().map((cookie) => cookie.name);
      expect(
        names.filter((name) => name.includes("locale")),
        path,
      ).toEqual([]);
    }
  });

  it("moves the waitlist confirmation token out of the address", async () => {
    const response = await middleware(request("/espera/confirmar?t=TOKEN_1234567890_abcdefghij"));
    const location = new URL(response.headers.get("location") ?? "", "http://localhost");
    expect(location.pathname).toBe("/espera/confirmar");
    expect(location.search).toBe("");
    const cookie = response.cookies.get(COOKIE_KEYS.leadConfirm);
    expect(cookie?.value).toBe("TOKEN_1234567890_abcdefghij");
    expect(cookie?.httpOnly).toBe(true);
  });
});

describe("middleware: what a person reaches from an e-mail", () => {
  const LINK = "/api/public/email/unsubscribe?k=m&t=0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b";

  it("lets the unsubscribe address through without a session, as a link and as a one-click post", async () => {
    const followed = await middleware(request(LINK));
    expect(followed.headers.get("location")).toBeNull();
    const posted = await middleware(
      new NextRequest(new URL(LINK, "http://localhost"), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }) as never,
    );
    expect(posted.headers.get("location")).toBeNull();
  });

  it("serves the page the link lands on", async () => {
    const page = await middleware(request("/descadastro"));
    expect(pathOf(page.headers.get("x-middleware-rewrite"))).toBe("/pt-BR/descadastro");
  });

  it("opens nothing else under /api to a visitor without a session", async () => {
    for (const closed of ["/api/admin/ai", "/api/billing/providers", "/api/publicity"]) {
      const response = await middleware(request(closed));
      expect(pathOf(response.headers.get("location")), closed).toBe("/auth/sign-in");
    }
  });
});

describe("middleware: a client's link", () => {
  const LINK = "/c/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";

  it("opens without a session: a passenger has no account", async () => {
    const response = await middleware(request(LINK));
    expect(response.headers.get("location")).toBeNull();
    // The prefix is the folder, never a page that merely starts with the letter.
    const other = await middleware(request("/casos"));
    expect(pathOf(other.headers.get("location"))).toBe("/auth/sign-in");
  });

  it("keeps no visit cookie, so the token in the path never lands in one", async () => {
    const response = await middleware(request(`${LINK}?utm_source=whatsapp&cupom=PROMO`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get(COOKIE_KEYS.attribution)).toBeUndefined();
    expect(response.cookies.get(COOKIE_KEYS.offerCoupon)).toBeUndefined();
    expect(response.cookies.get(COOKIE_KEYS.lastCampaign)).toBeUndefined();
  });
});
