import { describe, expect, it } from "vitest";

import { pauseStop, signInStop } from "@/lib/court-browser/worker";

describe("why ONE's browser stops a batch", () => {
  it("at a sign-in that did not open the court's session", () => {
    expect(signInStop({ kind: "in" })).toBeNull();
    expect(signInStop({ kind: "refused" })).toBe("court_login_refused");
    expect(signInStop({ kind: "blocked" })).toBe("court_login_blocked");
    expect(signInStop({ kind: "captcha" })).toBe("court_captcha");
    expect(signInStop({ kind: "code_refused" })).toBe("court_code_refused");
    expect(signInStop({ kind: "no_code", why: "timeout" })).toBe("court_code_missing");
    // A person stopped the batch while ONE waited for the code: they know why.
    expect(signInStop({ kind: "no_code", why: "stopped" })).toBe("by_person_code");
    // A new version of the service took the place of this one while it waited.
    expect(signInStop({ kind: "no_code", why: "interrupted" })).toBe("interrupted");
    expect(signInStop({ kind: "failed", why: "foreign_host" })).toBe("court_sign_in_failed");
  });

  it("at a pause where only a person could go on", () => {
    expect(pauseStop("question")).toBe("court_question");
    expect(pauseStop("court_error")).toBe("court_error");
    expect(pauseStop("stuck")).toBe("stopped_stuck");
  });
});
