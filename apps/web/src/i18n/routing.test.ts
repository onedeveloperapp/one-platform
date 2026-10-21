import { localizeHref, matchPublicPath } from "./routing";
import { describe, expect, it } from "vitest";

describe("matchPublicPath", () => {
  it("reads the public addresses at the root", () => {
    expect(matchPublicPath("/")).toEqual({ locale: "pt-BR", internal: "/", prefixed: false });
    expect(matchPublicPath("/contato")).toEqual({ locale: "pt-BR", internal: "/contato", prefixed: false });
    expect(matchPublicPath("/blog/primeiro-post")).toEqual({
      locale: "pt-BR",
      internal: "/blog/primeiro-post",
      prefixed: false,
    });
  });

  it("recognizes the prefixed address, which next-intl redirects to the root one", () => {
    expect(matchPublicPath("/pt-BR")).toEqual({ locale: "pt-BR", internal: "/", prefixed: true });
    expect(matchPublicPath("/pt-BR/contato")).toEqual({ locale: "pt-BR", internal: "/contato", prefixed: true });
  });

  it("ignores everything that is not a public page", () => {
    expect(matchPublicPath("/inicio")).toBeNull();
    expect(matchPublicPath("/auth/sign-in")).toBeNull();
    expect(matchPublicPath("/pt-BR/inicio")).toBeNull();
    // A language the site is not written in is not a public address.
    expect(matchPublicPath("/en")).toBeNull();
    expect(matchPublicPath("/en/contato")).toBeNull();
    expect(matchPublicPath("/contact")).toBeNull();
    expect(matchPublicPath("/blog/a/b")).toBeNull();
    expect(matchPublicPath("/api/admin/ai")).toBeNull();
  });
});

describe("localizeHref", () => {
  it("writes the address of a public page", () => {
    expect(localizeHref("/", "pt-BR")).toBe("/");
    expect(localizeHref("/contato", "pt-BR")).toBe("/contato");
    expect(localizeHref("/ajuda/primeiros-passos", "pt-BR")).toBe("/ajuda/primeiros-passos");
  });

  it("keeps the query string and the fragment", () => {
    expect(localizeHref("/contato?cupom=X#faq", "pt-BR")).toBe("/contato?cupom=X#faq");
    expect(localizeHref("/?porta=ads", "pt-BR")).toBe("/?porta=ads");
  });

  it("leaves everything else alone", () => {
    expect(localizeHref("/auth/sign-up", "pt-BR")).toBe("/auth/sign-up");
    expect(localizeHref("/pt-BR/contato", "pt-BR")).toBe("/pt-BR/contato");
    expect(localizeHref("https://example.com/contato", "pt-BR")).toBe("https://example.com/contato");
    expect(localizeHref("//example.com/contato", "pt-BR")).toBe("//example.com/contato");
    expect(localizeHref("mailto:contato@example.com", "pt-BR")).toBe("mailto:contato@example.com");
  });

  it("falls back to Portuguese for an unknown locale", () => {
    expect(localizeHref("/contato", "en")).toBe("/contato");
    expect(localizeHref("/contato", "fr")).toBe("/contato");
  });

  it("round-trips with matchPublicPath", () => {
    for (const path of ["/", "/contato", "/blog/x", "/ajuda/x", "/espera/confirmar"]) {
      expect(matchPublicPath(localizeHref(path, "pt-BR"))).toMatchObject({ locale: "pt-BR", internal: path });
    }
  });
});
