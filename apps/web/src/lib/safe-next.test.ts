import { sanitizeInternalNext } from "./safe-next";
import { describe, expect, it } from "vitest";

describe("sanitizeInternalNext", () => {
  it("keeps same-origin absolute paths with query and hash", () => {
    expect(sanitizeInternalNext("/settings/billing?plan=kit#top")).toBe("/settings/billing?plan=kit#top");
  });

  it("refuses anything that could leave the site", () => {
    expect(sanitizeInternalNext("https://evil.example")).toBe("/inicio");
    expect(sanitizeInternalNext("//evil.example/path")).toBe("/inicio");
    expect(sanitizeInternalNext("/%2F%2Fevil.example")).toBe("/inicio");
    expect(sanitizeInternalNext("/\\evil.example")).toBe("/inicio");
  });

  it("falls back to a sanitized fallback, then to the app root", () => {
    expect(sanitizeInternalNext("javascript:alert(1)", "/modulos")).toBe("/modulos");
    expect(sanitizeInternalNext(null, "https://evil.example")).toBe("/inicio");
  });
});
