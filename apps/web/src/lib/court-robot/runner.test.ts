import { describe, expect, it } from "vitest";

import type { MappedField, MappedScreen } from "@/lib/court-extension/capture";
import { filingFactsOf, type ToSend } from "@/lib/court-robot/facts";
import type { LearnedStep } from "@/lib/court-robot/map";
import { type ScreenPlan, type Target, targetKey } from "@/lib/court-robot/plan";
import { type PlanInput, runFiling, type ScreenDriver, type SendPoint } from "@/lib/court-robot/runner";

// ---------- A stand-in court: four screens of an eproc, kept in memory ----------

const field = (
  kind: MappedField["kind"],
  id: string,
  label: string,
  extra: Partial<MappedField> = {},
): MappedField => ({
  kind,
  type: kind === "input" ? (extra.type ?? "text") : null,
  id,
  name: id,
  label,
  required: false,
  disabled: false,
  readOnly: false,
  visible: true,
  options: null,
  optionCount: null,
  selector: `#${id}`,
  index: 0,
  ...extra,
});

const SCREENS: { heading: string; acao: string; fields: MappedField[] }[] = [
  {
    heading: "Peticionamento Eletrônico (1 de 5) - Informações do processo",
    acao: "processo_ajuizamento",
    fields: [
      field("select", "selRito", "Rito:", {
        options: [
          { value: "", text: "Selecione" },
          { value: "JE", text: "JUIZADO ESPECIAL" },
        ],
        optionCount: 2,
      }),
      field("input", "txtValorCausa", "Valor da causa"),
      field("button", "btnProxima", "Próxima"),
    ],
  },
  {
    heading: "Peticionamento Eletrônico (5 de 5) - Documentos",
    acao: "processo_ajuizamento_documentos",
    fields: [
      field("input", "arquivo", "Escolher arquivo", { type: "file" }),
      field("select", "selTipo", "Tipo", { options: [{ value: "PI", text: "Petição Inicial" }], optionCount: 1 }),
      field("button", "btnConfirmarSel", "Confirmar seleção de documento"),
      field("button", "btnFinalizar", "Finalizar"),
    ],
  },
  {
    heading: "Resumo do ajuizamento",
    acao: "processo_ajuizamento_resumo",
    fields: [field("button", "btnConfirmar", "Confirmar ajuizamento")],
  },
  { heading: "Processo distribuído", acao: "processo_ajuizamento_recibo", fields: [] },
];

class StandInCourt implements ScreenDriver {
  screen = 0;
  values = new Map<string, string>();
  files: string[] = [];
  clicks: string[] = [];

  async capture(): Promise<MappedScreen[]> {
    const here = SCREENS[this.screen]!;
    return [
      {
        system: "eproc-tjsp",
        host: "eproc1g.tjsp.jus.br",
        path: "/eproc/controlador.php",
        params: { acao: here.acao },
        title: "eproc - TJSP",
        headings: [here.heading],
        fields: here.fields,
        tables: [],
        capturedAt: "2026-11-20T15:00:00.000Z",
      },
    ];
  }
  async text(): Promise<string> {
    return this.screen === 3 ? "Processo 1000123-07.2099.8.26.0100 distribuído ao 1º Juizado Especial Cível" : "";
  }
  async fill(target: Target, value: string): Promise<boolean> {
    this.values.set(target.selector, value);
    return true;
  }
  async select(target: Target, choice: { code: string } | { text: string }): Promise<boolean> {
    this.values.set(target.selector, "code" in choice ? choice.code : choice.text);
    return true;
  }
  async check(): Promise<boolean> {
    return true;
  }
  async click(target: Target): Promise<boolean> {
    this.clicks.push(target.selector);
    if (target.selector === "#btnProxima" && this.values.get("#selRito") === "JE") this.screen = 1;
    if (target.selector === "#btnFinalizar" && this.files.length > 0) this.screen = 2;
    if (target.selector === "#btnConfirmar") this.screen = 3;
    return true;
  }
  async upload(target: Target, file: { name: string }): Promise<boolean> {
    this.files.push(file.name);
    return true;
  }
  async settle(): Promise<void> {}
}

// ---------- The lawsuit ----------

const SENT: ToSend = {
  submission_id: "s1",
  claim: 1,
  channel: "browser",
  batch_id: "b1",
  learning: true,
  screen_system: "eproc-tjsp",
  org_id: "o1",
  case_id: "c1",
  incident: "cancellation",
  package_id: "p1",
  kind: "juizado",
  court: "TJSP",
  court_state: "SP",
  system: "eproc",
  comarca: "São Paulo",
  unit: null,
  value_cents: 1000000,
  claimants: [
    {
      name: "Marina Teste",
      cpf: "52998224725",
      birth_date: "1990-05-04",
      street: "Rua das Flores",
      number: "10",
      complement: null,
      district: "Centro",
      city: "São Paulo",
      state: "SP",
      zip: "01001000",
      email: "marina@teste.invalid",
      phone: "5511999990000",
      guardian: null,
    },
  ],
  defendant: { name: "Companhia Aérea Exemplo S.A.", cnpj: "11222333000181", airline: "XX" },
  lawyers: [{ user_id: "u1", name: "Ana Lima", cpf: null, oab: { uf: "SP", number: "123456" } }],
  items: [
    {
      position: 1,
      name: "01-peticao-inicial.pdf",
      file_id: "f1",
      signed_file_id: null,
      document_kind: "petition",
      storage_path: "x",
      signed_storage_path: null,
    },
  ],
};

const FACTS = filingFactsOf(SENT);
const T = (id: string) => targetKey(0, { selector: `#${id}`, index: 0 });

/** The AI's readings of the four screens, as the task answers them. */
function scriptedPlanner(seen: PlanInput[]) {
  return async (input: PlanInput): Promise<ScreenPlan | null> => {
    seen.push(input);
    const heading = input.tela[0]?.headings[0] ?? "";
    if (heading.includes("Informações")) {
      return {
        tela: { tipo: "formulario", titulo: heading },
        acoes: [
          { fazer: "escolher", alvo: T("selRito"), opcao: "JE" },
          { fazer: "preencher", alvo: T("txtValorCausa"), fato: "processo.valor_causa" },
          { fazer: "clicar", alvo: T("btnProxima") },
        ],
        pronto: true,
        pergunta: "",
      };
    }
    if (heading.includes("Documentos")) {
      // The model did not mark "Finalizar" as sending: ONE's own rule does.
      return {
        tela: { tipo: "formulario", titulo: heading },
        acoes: [
          { fazer: "anexar", alvo: T("arquivo"), arquivo: 1 },
          { fazer: "escolher", alvo: T("selTipo"), opcao: "PI" },
          { fazer: "clicar", alvo: T("btnConfirmarSel") },
          { fazer: "clicar", alvo: T("btnFinalizar") },
        ],
        pronto: true,
        pergunta: "",
      };
    }
    if (heading.includes("Resumo")) {
      return {
        tela: { tipo: "resumo", titulo: heading },
        acoes: [{ fazer: "clicar", alvo: T("btnConfirmar"), envia: true }],
        pronto: true,
        pergunta: "",
      };
    }
    if (heading.includes("distribuído")) {
      return { tela: { tipo: "recibo", titulo: heading }, acoes: [], pronto: true, pergunta: "" };
    }
    return null;
  };
}

const PDF = { name: "01-peticao-inicial.pdf", type: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };

describe("ONE filing on a court's screen", () => {
  it("learning a system, it fills every screen, asks the lawyer once before the first button that may send, and files", async () => {
    const court = new StandInCourt();
    const seen: PlanInput[] = [];
    const points: SendPoint[] = [];
    const going: string[] = [];
    const result = await runFiling({
      driver: court,
      planner: scriptedPlanner(seen),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async (position) => (position === 1 ? PDF : null),
      learning: true,
      confirm: async (point) => {
        points.push(point);
        // Nothing that may send was pressed before the lawyer's word.
        expect(court.clicks).not.toContain("#btnFinalizar");
        return "go";
      },
      map: null,
      beforeSend: async () => {
        going.push(court.clicks.join(","));
        return { ok: true, code: "sending" };
      },
    });

    expect(result.outcome).toEqual({ kind: "filed", number: "10001230720998260100" });
    expect(points).toHaveLength(1);
    expect(points[0]?.botao).toBe("Finalizar");
    // The AI holds back the button that sends only until the lawyer's word: the summary after it is ONE's to confirm.
    expect(seen.map((input) => input.aprendendo)).toEqual([true, true, false, false]);
    // The database is told the filing goes before the first press that may send, once.
    expect(going).toEqual(["#btnProxima,#btnConfirmarSel"]);
    expect(court.values.get("#txtValorCausa")).toBe("10.000,00");
    expect(court.files).toEqual(["01-peticao-inicial.pdf"]);
    expect(result.aiScreens).toBe(4);
    expect(result.learned.map((step) => step.tipo)).toEqual(["formulario", "formulario", "resumo", "recibo"]);

    // The AI never saw a person's data: the claimant's name, CPF, e-mail and phone stay in ONE's code.
    const shown = JSON.stringify(seen);
    for (const secret of ["Marina Teste", "52998224725", "marina@teste.invalid", "11999990000", "01001000"]) {
      expect(shown).not.toContain(secret);
    }
    expect(shown).toContain("autor.1.cpf");
  });

  it("when the lawyer does not confirm, nothing that may send is pressed and the database is not told it goes", async () => {
    const court = new StandInCourt();
    let told = 0;
    const result = await runFiling({
      driver: court,
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirm: async () => "stop",
      map: null,
      beforeSend: async () => {
        told += 1;
        return { ok: true, code: "sending" };
      },
    });
    expect(result.outcome).toEqual({ kind: "not_confirmed" });
    expect(told).toBe(0);
    expect(court.clicks).not.toContain("#btnFinalizar");
    expect(court.clicks).not.toContain("#btnConfirmar");
  });

  it("a system ONE learned is followed by its map, with no AI and no question to the lawyer", async () => {
    const first = new StandInCourt();
    const learnedRun = await runFiling({
      driver: first,
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    const map: LearnedStep[] = JSON.parse(JSON.stringify(learnedRun.learned));
    // The map holds no value, no person and no number of a lawsuit.
    const kept = JSON.stringify(map);
    for (const secret of ["Marina", "52998224725", "10.000,00", "1000123", "marina@"])
      expect(kept).not.toContain(secret);

    const court = new StandInCourt();
    let asked = 0;
    const result = await runFiling({
      driver: court,
      planner: async () => {
        asked += 1;
        return null;
      },
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: false,
      confirm: async () => {
        throw new Error("a system learned asks nothing");
      },
      map,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(result.outcome).toEqual({ kind: "filed", number: "10001230720998260100" });
    expect(asked).toBe(0);
    expect(result.aiScreens).toBe(0);
  });

  it("a login or a code the court asks goes to the lawyer, and nothing is typed in it", async () => {
    const court = new StandInCourt();
    const result = await runFiling({
      driver: court,
      planner: async () => ({
        tela: { tipo: "segundo_fator", titulo: "Código" },
        acoes: [],
        pronto: false,
        pergunta: "",
      }),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(result.outcome).toEqual({ kind: "code" });
    expect(court.values.size).toBe(0);
  });

  it("a plan with a fact the case does not have, or a line the list does not have, is not done", async () => {
    const court = new StandInCourt();
    const result = await runFiling({
      driver: court,
      planner: async () => ({
        tela: { tipo: "formulario", titulo: "x" },
        acoes: [
          { fazer: "preencher", alvo: T("txtValorCausa"), fato: "autor.9.cpf" },
          { fazer: "escolher", alvo: T("selRito"), opcao: "XX" },
        ],
        pronto: true,
        pergunta: "",
      }),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(result.outcome).toEqual({ kind: "stuck", why: "unknown_fact" });
    expect(court.values.size).toBe(0);
  });

  it("when the lawyer acts on the screen while ONE waits, the filing is marked as going once and nothing is pressed for them", async () => {
    const court = new StandInCourt();
    const going: number[] = [];
    const result = await runFiling({
      driver: court,
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirm: async () => {
        // The lawyer pressed "Finalizar" on the court's own screen: the summary is open.
        court.screen = 2;
        return "moved";
      },
      map: null,
      beforeSend: async () => {
        going.push(court.screen);
        return { ok: true, code: "sending" };
      },
    });
    expect(result.outcome).toEqual({ kind: "filed", number: "10001230720998260100" });
    expect(going).toEqual([2]);
    expect(court.clicks).not.toContain("#btnFinalizar");
    expect(court.clicks).toContain("#btnConfirmar");
  });

  it("when the lawyer acted on the screen and the database refuses the filing, it is unknown, never not sent", async () => {
    const court = new StandInCourt();
    const result = await runFiling({
      driver: court,
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirm: async () => {
        court.screen = 2;
        return "moved";
      },
      map: null,
      beforeSend: async () => ({ ok: false, code: "batch_not_running" }),
    });
    expect(result.outcome).toEqual({ kind: "unknown" });
  });

  it("a filing its lawyer already confirmed asks nothing again, and one already going is never marked twice", async () => {
    const confirmedRun = await runFiling({
      driver: new StandInCourt(),
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirmed: true,
      confirm: async () => {
        throw new Error("a confirmed filing asks nothing");
      },
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(confirmedRun.outcome).toEqual({ kind: "filed", number: "10001230720998260100" });

    // Taken up again at the summary, already marked as going: it goes on with no new mark.
    const atSummary = new StandInCourt();
    atSummary.screen = 2;
    let marks = 0;
    const resumed = await runFiling({
      driver: atSummary,
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirmed: true,
      sent: true,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => {
        marks += 1;
        return { ok: true, code: "sending" };
      },
    });
    expect(resumed.outcome).toEqual({ kind: "filed", number: "10001230720998260100" });
    expect(marks).toBe(0);

    // Taken up again on a form, already marked as going: the lawsuit may be at the court, so it is unknown.
    const onForm = new StandInCourt();
    onForm.screen = 1;
    const lost = await runFiling({
      driver: onForm,
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: true,
      confirmed: true,
      sent: true,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(lost.outcome).toEqual({ kind: "unknown" });
    expect(onForm.clicks).toEqual([]);
  });

  it("after something that may send was pressed, any screen but the summary or the receipt leaves the filing unknown", async () => {
    const court = new StandInCourt();
    court.screen = 1;
    court.files.push("x");
    let call = 0;
    const result = await runFiling({
      driver: court,
      planner: async (input) => {
        call += 1;
        if (call === 1) {
          return {
            tela: { tipo: "formulario", titulo: input.tela[0]?.headings[0] ?? "" },
            acoes: [{ fazer: "clicar", alvo: T("btnFinalizar") }],
            pronto: true,
            pergunta: "",
          };
        }
        return { tela: { tipo: "erro", titulo: "Erro" }, acoes: [], pronto: false, pergunta: "O sistema recusou" };
      },
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: false,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(result.outcome).toEqual({ kind: "unknown" });
  });
  it("where the court signed the session out, the host signs in again; after something that may send, it is unknown", async () => {
    // ONE's own browser: the court sent it to its sign-in, a page of another host the robot does not read.
    const court = new StandInCourt();
    let out = true;
    const signedOut = Object.assign(court, { signedOut: async () => out });
    const planned: PlanInput[] = [];
    const first = await runFiling({
      driver: signedOut,
      planner: scriptedPlanner(planned),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: false,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(first.outcome).toEqual({ kind: "login" });
    expect(planned).toHaveLength(0);

    out = false;
    court.screen = 2;
    let calls = 0;
    const sent = await runFiling({
      driver: Object.assign(court, {
        signedOut: async () => {
          calls += 1;
          return calls > 1;
        },
      }),
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: false,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(sent.outcome).toEqual({ kind: "unknown" });
  });

  it("tells the driver which press may send, so the court's own question is answered yes only there", async () => {
    const court = new StandInCourt();
    const presses: boolean[] = [];
    const result = await runFiling({
      driver: Object.assign(court, { pressing: (sends: boolean) => presses.push(sends) }),
      planner: scriptedPlanner([]),
      system: "eproc do TJSP",
      facts: FACTS,
      file: async () => PDF,
      learning: false,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(result.outcome.kind).toBe("filed");
    // "Finalizar" may send (ONE's own rule: in another system it does) and so does the summary's confirmation.
    expect(presses).toEqual([false, false, false, false, false, false, true, true]);
  });
});
