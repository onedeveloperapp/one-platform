import { describe, expect, it } from "vitest";

import { dayLabel, kindLabelKey, sha256OfFile, verificationOutcome } from "@/lib/documents/verification";
import messages from "@flyee/content/messages/pt-BR.json";
import { formatVerifyCode, normalizeVerifyCode } from "@flyee/documents/codes";

const issued = { found: true, status: "issued" as const, firm: "Souza Advogados", kind: "procuracao", version: 1 };

describe("what the public verification of a document says", () => {
  it("tells a valid document from a revoked one, a replaced one and a code that finds nothing", () => {
    expect(verificationOutcome(issued)).toBe("valid");
    expect(verificationOutcome({ ...issued, replacedByVersion: 2 })).toBe("replaced");
    expect(verificationOutcome({ ...issued, status: "revoked" })).toBe("revoked");
    // A revoked version says it was revoked even when a newer one exists.
    expect(verificationOutcome({ ...issued, status: "revoked", replacedByVersion: 2 })).toBe("revoked");
    expect(verificationOutcome({ found: false })).toBe("missing");
    expect(verificationOutcome(null)).toBe("missing");
    // An answer that names no firm is not a document anybody can vouch for.
    expect(verificationOutcome({ found: true, status: "issued", firm: null })).toBe("missing");
  });

  it("has words for every kind of document, and a kind with none yet reads as a document", () => {
    const product = messages.product as Record<string, string>;
    for (const kind of [
      "procuracao",
      "contrato",
      "peca",
      "pacote_protocolo",
      "declaracao_residencia",
      "um_tipo_novo",
      "",
    ]) {
      expect(product[kindLabelKey(kind)], kind).toBeTruthy();
    }
    expect(kindLabelKey("um_tipo_novo")).toBe("verify-kind-other");
    expect(kindLabelKey(null)).toBe("verify-kind-other");
  });

  it("writes a day on Brasília's calendar, whatever the hour elsewhere", () => {
    expect(dayLabel("2026-10-08T15:00:00Z")).toBe("8 de outubro de 2026");
    // Two in the morning in Greenwich is still the evening before in Brasília.
    expect(dayLabel("2026-10-09T02:00:00Z")).toBe("8 de outubro de 2026");
    expect(dayLabel(null)).toBeNull();
    expect(dayLabel("isto não é uma data")).toBeNull();
  });

  it("reads a code as it is printed and refuses what cannot be one", () => {
    expect(normalizeVerifyCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(formatVerifyCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
    expect(normalizeVerifyCode("ABCDEFGHJKM0")).toBeNull();
    expect(normalizeVerifyCode("../../admin")).toBeNull();
  });

  it("computes the fingerprint of a file where the file is", async () => {
    expect(await sha256OfFile(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
