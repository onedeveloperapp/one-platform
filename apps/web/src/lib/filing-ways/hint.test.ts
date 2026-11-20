import { describe, expect, it } from "vitest";

import { loginHint } from "@/lib/filing-ways/hint";

describe("what the screens show of a court login", () => {
  it("hides the middle of a CPF and keeps no six digits in a row", () => {
    expect(loginHint("529.982.247-25")).toBe("529.***.***-25");
    expect(loginHint(" 52998224725 ")).toBe("529.***.***-25");
    expect(loginHint("ana.lima")).toBe("an***");
    for (const login of ["52998224725", "ana.lima", "AB12345678"]) expect(loginHint(login)).not.toMatch(/\d{6}/);
  });
});
