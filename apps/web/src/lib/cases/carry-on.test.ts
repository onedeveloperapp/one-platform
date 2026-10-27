import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { waitingFix, waitingHref } from "@/lib/cases/advance";
import { INCIDENTS } from "@/lib/cases/cases";
import { claimDefaultsOf } from "@/lib/firm/autonomy";
import { WHATSAPP_COPY } from "@/lib/messages/whatsapp-copy";
import { OCCASIONAL_CAUSES_PER_YEAR } from "@flyee/rules/state-count";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0052_case_carry_on.sql"), "utf8");

/** The text of a function of the migration, from its name to its end. */
function sqlFunction(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return MIGRATION.slice(start, MIGRATION.indexOf("$$;", start));
}

describe("what ONE carries on by itself where the firm said how (0052)", () => {
  it("takes the five causes a year of the rule of the bar, in the database and in the rules", () => {
    expect(sqlFunction("occasional_causes_per_year")).toMatch(/select 5;/);
    expect(OCCASIONAL_CAUSES_PER_YEAR).toBe(5);
  });

  it("says a default claim for each kind of problem a case knows, and no other", () => {
    const listed = (from: string) => [...from.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    const check = MIGRATION.slice(
      MIGRATION.indexOf("constraint firm_claim_defaults_incident_check"),
      MIGRATION.indexOf("constraint firm_claim_defaults_cents_check"),
    );
    expect(listed(check)).toEqual([...INCIDENTS]);
    const setter = sqlFunction("set_firm_claim_default");
    const from = setter.indexOf("target_incident not in");
    expect(listed(setter.slice(from, setter.indexOf(") then", from)))).toEqual([...INCIDENTS]);
  });

  it("reads the firm's defaults as the database answers them, leaving out what is not one", () => {
    expect(
      claimDefaultsOf([
        { incident: "cancellation", cents: 1000000 },
        { incident: "delay", cents: "800000" },
        { incident: "meteor", cents: 100 },
        { incident: "overbooking", cents: 0 },
        null,
      ]),
    ).toEqual([
      { incident: "cancellation", cents: 1000000 },
      { incident: "delay", cents: 800000 },
    ]);
    expect(claimDefaultsOf(null)).toEqual([]);
  });

  it("sends a missing claim to the case's own card, and the default to where the firm says it", () => {
    const caseId = "6f4a1c2e-0000-4000-8000-000000000001";
    expect(waitingHref("claims_missing", caseId)).toBe(`/casos/${caseId}#como-vai-a-juizo`);
    expect(waitingFix("claims_missing")?.href).toBe("/settings/autonomia#valor-do-pedido");
    expect(waitingHref("no_signer", caseId)).toBe("/settings/autonomia#quem-assina");
    expect(waitingHref("documents_waiting", caseId)).toBe(`/casos/${caseId}`);
  });
});

describe("what the client hears once they finished (0055)", () => {
  it("says it arrived and the next steps, the power of attorney first when one waits for them", () => {
    const words = WHATSAPP_COPY["pt-BR"].caseReceived;
    const waiting = words({ firstName: "Mariana", paperWaiting: true, finished: true });
    expect(waiting.startsWith("Recebi o seu aviso de que terminou, Mariana.")).toBe(true);
    expect(waiting).toContain("1. Assine a procuração que está no seu link.");
    expect(waiting).toContain("3. Quando a ação for protocolada, o escritório avisa você por aqui.");
    expect(waiting).toContain("ainda pode enviar pelo mesmo link");
    const none = words({ firstName: "", paperWaiting: false, finished: true });
    expect(none.startsWith("Recebi o seu aviso de que terminou. Obrigado.")).toBe(true);
    expect(none).not.toContain("procuração");
    expect(none).toContain("1. O escritório confere os documentos e prepara a ação.");
    // The rules of copy for clients: no dash, no exclamation, no emoji.
    for (const text of [waiting, none]) expect(text).not.toMatch(/[—–!]|\p{Extended_Pictographic}/u);
  });

  it("says the case has what it needs when it moved on before they said they finished (0057)", () => {
    const moved = WHATSAPP_COPY["pt-BR"].caseReceived({ firstName: "Mariana", paperWaiting: true, finished: false });
    expect(moved.startsWith("Recebi tudo o que o seu caso precisa, Mariana. Obrigado.")).toBe(true);
    expect(moved).not.toContain("terminou");
    expect(moved).toContain("1. Assine a procuração que está no seu link.");
    expect(moved).toContain("2. O escritório prepara a ação.");
    // Its link takes no more papers: nothing is said of sending more there.
    expect(moved).not.toContain("mesmo link");
    expect(moved).toContain("Se precisar mudar alguma coisa, me diga por aqui.");
    expect(moved).not.toMatch(/[—–!]|\p{Extended_Pictographic}/u);
  });
});
