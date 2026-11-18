import { describe, expect, it } from "vitest";

import { accountPanelUrl, isAccountMethod, signatureAccountOf } from "@/lib/signatures/methods";

describe("the ways a document is signed (0023, D4Sign since 0253)", () => {
  it("tells the firm's own account apart from what the firm confirms by hand", () => {
    expect(isAccountMethod("zapsign")).toBe(true);
    expect(isAccountMethod("d4sign")).toBe(true);
    for (const method of ["govbr", "enotariado", "", null, undefined, "D4Sign"])
      expect(isAccountMethod(method)).toBe(false);
  });

  it("reads the firm's account as the database answers it, and nothing it does not know", () => {
    expect(signatureAccountOf({ provider: "d4sign", environment: "sandbox" })).toEqual({
      method: "d4sign",
      environment: "sandbox",
    });
    expect(signatureAccountOf({ provider: "zapsign", environment: "anything" })).toEqual({
      method: "zapsign",
      environment: "production",
    });
    for (const value of [null, undefined, "d4sign", { provider: "docusign" }, {}]) {
      expect(signatureAccountOf(value)).toBeNull();
    }
  });

  it("opens the provider's own panel in the environment the account was connected in", () => {
    expect(accountPanelUrl("d4sign", "sandbox")).toBe("https://sandbox.d4sign.com.br");
    expect(accountPanelUrl("d4sign", "production")).toBe("https://secure.d4sign.com.br");
    expect(accountPanelUrl("zapsign", "sandbox")).toBe("https://sandbox.app.zapsign.com.br");
    expect(accountPanelUrl("zapsign", "production")).toBe("https://app.zapsign.com.br");
  });
});
