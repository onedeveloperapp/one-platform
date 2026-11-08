import { describe, expect, it } from "vitest";

import {
  EXAMPLE_DEADLINE,
  EXAMPLE_PACKAGE,
  EXAMPLE_PACKAGE_NAMES,
  EXAMPLE_SYSTEM,
} from "@/components/marketing/product-examples";
import ptBR from "@flyee/content/messages/pt-BR.json";

const words = ptBR.marketing as Record<string, string>;

describe("the home's example figures", () => {
  it("counts the example deadline as the page describes it", () => {
    expect(EXAMPLE_DEADLINE.ok).toBe(true);
    if (!EXAMPLE_DEADLINE.ok) return;
    const count = EXAMPLE_DEADLINE.result;
    expect(count.publishedOn).toBe("2026-11-05");
    expect(count.startsOn).toBe("2026-11-06");
    expect(count.dueOn).toBe("2026-11-27");
    expect(count.skipped).toEqual([
      { from: "2026-11-20", to: "2026-11-20", reason: "holiday", label: expect.any(String) },
    ]);
    expect(count.moved).toBeNull();
    // Nothing the count could not know: the figure shows no note of an assumption.
    expect(count.assumptions).toEqual([]);

    const label = words["one-home-bento-deadline-label"];
    for (const said of ["15 dias úteis", "5 de novembro", "27 de novembro", "20 de novembro"]) {
      expect(label).toContain(said);
    }
  });

  it("names the example package as the page describes it", () => {
    expect(EXAMPLE_PACKAGE.ready).toBe(true);
    expect(EXAMPLE_PACKAGE_NAMES).toEqual([
      "01-peticao-inicial.pdf",
      "02-procuracao-mariana-souza.pdf",
      "03-documento-de-identidade-mariana-souza.pdf",
      "04-comprovante-de-endereco-mariana-souza.pdf",
      "05-cartao-de-embarque.pdf",
    ]);
    expect(words["one-home-bento-package-label"]).toContain(EXAMPLE_SYSTEM);
  });
});
