import { describe, expect, it } from "vitest";

import {
  authorizationState,
  cpfMiddleLabel,
  DEFAULT_SIGNATURE_HOURS,
  isSignatureHours,
  isSignatureOutcome,
  SIGNATURE_HOURS,
  SIGNATURE_HOURS_KEY,
  SIGNATURE_OUTCOME_KEY,
  SIGNATURE_OUTCOMES,
  signatureActionErrorKey,
  signatureErrorKey,
} from "@/lib/psc/signature";

describe("a lawyer's signature in the cloud, as the screens read it", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const later = "2026-10-16T12:00:00Z";
  const before = "2026-10-15T11:00:00Z";

  it("is in force only while its end is to come, failing when its last use failed", () => {
    expect(authorizationState("connected", later, now)).toBe("active");
    expect(authorizationState("error", later, now)).toBe("failing");
    expect(authorizationState("connected", before, now)).toBe("ended");
    expect(authorizationState("connected", null, now)).toBe("ended");
    expect(authorizationState("expired", later, now)).toBe("ended");
    expect(authorizationState("pending", null, now)).toBe("pending");
  });

  it("offers at most the norm's 7 days, and that by default", () => {
    expect(Math.max(...SIGNATURE_HOURS)).toBe(7 * 24);
    expect(DEFAULT_SIGNATURE_HOURS).toBe(168);
    expect(SIGNATURE_HOURS.every((hours) => SIGNATURE_HOURS_KEY[hours])).toBe(true);
    expect(isSignatureHours(24)).toBe(true);
    expect(isSignatureHours(200)).toBe(false);
    expect(isSignatureHours("24")).toBe(false);
  });

  it("shows the holder's CPF by its middle only", () => {
    expect(cpfMiddleLabel("456789")).toBe("***.456.789-**");
    expect(cpfMiddleLabel("12345678909")).toBeNull();
    expect(cpfMiddleLabel(null)).toBeNull();
  });

  it("has words for every return of the PSC, and reads nothing else from the address", () => {
    expect(SIGNATURE_OUTCOMES.every((outcome) => SIGNATURE_OUTCOME_KEY[outcome])).toBe(true);
    expect(isSignatureOutcome("autorizada")).toBe(true);
    expect(isSignatureOutcome("<script>")).toBe(false);
  });

  it("says a failure in the lawyer's words, and anything unknown as a plain failure", () => {
    expect(signatureErrorKey("session_ended")).toBe("psc-error-session-ended");
    expect(signatureErrorKey("token_used")).toBe("psc-error-session-ended");
    expect(signatureErrorKey("vault_tampered")).toBe("psc-error-failed");
    expect(signatureErrorKey(null)).toBe("psc-error-failed");
    expect(signatureActionErrorKey("second_factor_required")).toBe("team-error-second-factor");
    expect(signatureActionErrorKey("qualquer")).toBe("psc-action-failed");
  });
});
