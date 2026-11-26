import { describe, expect, it } from "vitest";

import type { MappedField, MappedScreen } from "@/lib/court-extension/capture";
import { filingFactsOf, type ToSend } from "@/lib/court-robot/facts";
import { type LearnedStep, learnedStep, stepFor } from "@/lib/court-robot/map";
import {
  checkPlan,
  fieldsByTarget,
  MAY_SEND,
  resolveTarget,
  screenForAi,
  type ScreenPlan,
  type Target,
  targetKey,
} from "@/lib/court-robot/plan";
import {
  type PlanInput,
  runFiling,
  type ScreenDriver,
  type SendPoint,
  SIGN_QUESTION,
  SIGNS,
} from "@/lib/court-robot/runner";

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

// ---------- A stand-in PJe: lists that load one after the other (the owner's test of 2026-11-26) ----------

const MATERIAS = [
  { value: "", text: "Selecione" },
  { value: "1215", text: "Direito do Consumidor" },
];
const JURISDICOES = [
  { value: "", text: "Selecione" },
  { value: "77", text: "Comarca da Capital" },
];
const CLASSES = [
  { value: "", text: "Selecione" },
  { value: "436", text: "PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL" },
];

/** The "Dados iniciais" of a PJe: the jurisdição loads after the matéria, the class after the jurisdição. */
class StandInPje implements ScreenDriver {
  chosen = new Map<string, string>();
  filed = false;
  /** How many times the screen undoes the matéria chosen, as a page that reloads its form would. */
  undoes = 0;
  /** How many times the jurisdição is not there yet when ONE chooses it. */
  late = 0;
  settles = 0;

  async capture(): Promise<MappedScreen[]> {
    const list = (id: string, label: string, options: { value: string; text: string }[]) =>
      field("select", id, label, {
        options,
        optionCount: options.length,
        chosen: this.chosen.get(`#${id}`) ?? "",
      });
    const materia = this.chosen.get("#materia");
    const jurisdicao = this.chosen.get("#jurisdicao");
    return [
      {
        system: "pje-tjrj",
        host: "tjrj.pje.jus.br",
        path: "/1g/Processo/CadastroProcesso/listView.seam",
        params: {},
        title: "Cadastro de processo",
        headings: [this.filed ? "Processo distribuído" : "Cadastro de processo"],
        fields: this.filed
          ? []
          : [
              list("materia", "Matéria", MATERIAS),
              list("jurisdicao", "Jurisdição", materia ? JURISDICOES : MATERIAS.slice(0, 1)),
              list("classe", "Classe judicial", jurisdicao ? CLASSES : CLASSES.slice(0, 1)),
              field("button", "incluir", "INCLUIR"),
            ],
        tables: [],
        capturedAt: "2026-11-26T12:28:00.000Z",
      },
    ];
  }
  async text(): Promise<string> {
    return this.filed ? "Processo 0800123-07.2099.8.19.0001 distribuído" : "";
  }
  async fill(): Promise<boolean> {
    return true;
  }
  async select(target: Target, choice: { code: string } | { text: string }): Promise<boolean> {
    if (!("code" in choice)) return false;
    if (target.selector === "#jurisdicao" && (!this.chosen.get("#materia") || this.late > 0)) {
      this.late = Math.max(0, this.late - 1);
      return false;
    }
    this.chosen.set(target.selector, choice.code);
    if (target.selector === "#materia" && this.undoes > 0) {
      this.undoes -= 1;
      this.chosen.delete("#materia");
    }
    return true;
  }
  async check(): Promise<boolean> {
    return true;
  }
  async click(target: Target): Promise<boolean> {
    if (target.selector === "#incluir" && this.chosen.get("#classe") === "436") this.filed = true;
    return true;
  }
  async upload(): Promise<boolean> {
    return true;
  }
  async settle(): Promise<void> {
    this.settles += 1;
  }
}

const P = (id: string) => targetKey(0, { selector: `#${id}`, index: 0 });

/** The AI as the second instructions ask: what the screen holds and what ONE did decide the next list. */
function pjePlanner(seen: PlanInput[]) {
  return async (input: PlanInput): Promise<ScreenPlan | null> => {
    seen.push(input);
    const frame = input.tela[0];
    if (!frame || frame.fields.length === 0) {
      return { tela: { tipo: "recibo", titulo: "Processo distribuído" }, acoes: [], pronto: true, pergunta: "" };
    }
    const holds = (id: string) => frame.fields.find((item) => item.id === id)?.chosen ?? "";
    const offers = (id: string, code: string) =>
      frame.fields.find((item) => item.id === id)?.options?.some((option) => option.value === code) === true;
    const titulo = "Cadastro de processo";
    const choose = (id: string, opcao: string): ScreenPlan => ({
      tela: { tipo: "formulario", titulo },
      acoes: [
        { fazer: "escolher", alvo: P(id), opcao },
        { fazer: "esperar", alvo: P(id) },
      ],
      pronto: false,
      pergunta: "",
    });
    if (holds("materia") !== "1215") return choose("materia", "1215");
    if (holds("jurisdicao") !== "77")
      return offers("jurisdicao", "77") ? choose("jurisdicao", "77") : choose("materia", "1215");
    if (holds("classe") !== "436") return choose("classe", "436");
    return {
      tela: { tipo: "formulario", titulo },
      acoes: [{ fazer: "clicar", alvo: P("incluir") }],
      pronto: true,
      pergunta: "",
    };
  };
}

const pjeRun = (court: StandInPje, planner: (input: PlanInput) => Promise<ScreenPlan | null>) =>
  runFiling({
    driver: court,
    planner,
    system: "PJe do TJRJ",
    facts: FACTS,
    file: async () => PDF,
    learning: false,
    confirm: async () => "go",
    map: null,
    beforeSend: async () => ({ ok: true, code: "sending" }),
  });

describe("a screen whose lists load one after the other (the PJe of TJRJ, 2026-11-26)", () => {
  it("goes forward one list a reading, each reading told what ONE already did on the screen", async () => {
    const court = new StandInPje();
    const seen: PlanInput[] = [];
    const result = await pjeRun(court, pjePlanner(seen));
    expect(result.outcome).toEqual({ kind: "filed", number: "08001230720998190001" });
    // Four readings of one screen, past the three the robot stopped at before, and the receipt.
    expect(seen).toHaveLength(5);
    expect(seen[0]?.feito).toEqual([]);
    expect(seen[1]?.feito).toEqual([
      { acao: { fazer: "escolher", alvo: P("materia"), opcao: "1215" }, resultado: "ok" },
      { acao: { fazer: "esperar", alvo: P("materia") }, resultado: "ok" },
    ]);
    expect(seen[3]?.feito.map((done) => done.acao.alvo)).toEqual([
      P("materia"),
      P("materia"),
      P("jurisdicao"),
      P("jurisdicao"),
      P("classe"),
      P("classe"),
    ]);
    // A new screen starts with nothing done on it.
    expect(seen[4]?.feito).toEqual([]);
  });

  it("an action the screen does not take is read again, and the AI sees what came of it", async () => {
    const court = new StandInPje();
    // The jurisdição is listed, but the page is still loading it the first time ONE chooses it.
    court.late = 1;
    const seen: PlanInput[] = [];
    const result = await pjeRun(court, pjePlanner(seen));
    // Before, an action the screen did not take stopped the filing there.
    expect(result.outcome.kind).toBe("filed");
    expect(seen[2]?.feito).toEqual([
      { acao: { fazer: "escolher", alvo: P("materia"), opcao: "1215" }, resultado: "ok" },
      { acao: { fazer: "esperar", alvo: P("materia") }, resultado: "ok" },
      { acao: { fazer: "escolher", alvo: P("jurisdicao"), opcao: "77" }, resultado: "not_done" },
    ]);
    expect(court.chosen.get("#jurisdicao")).toBe("77");
  });

  it("lets the page settle after a list that may load the next, before the next action acts on it", async () => {
    const court = new StandInPje();
    const order: string[] = [];
    const settle = court.settle.bind(court);
    court.settle = async () => {
      order.push("settle");
      await settle();
    };
    const select = court.select.bind(court);
    court.select = async (target, choice) => {
      order.push(`select ${target.selector}`);
      return select(target, choice);
    };
    const click = court.click.bind(court);
    court.click = async (target) => {
      order.push(`click ${target.selector}`);
      return click(target);
    };
    await pjeRun(court, async (input) => {
      if (input.tela[0]?.fields.find((item) => item.id === "materia")?.chosen === "1215") return null;
      return {
        tela: { tipo: "formulario", titulo: "Cadastro de processo" },
        acoes: [
          { fazer: "escolher", alvo: P("materia"), opcao: "1215" },
          { fazer: "clicar", alvo: P("incluir") },
        ],
        pronto: false,
        pergunta: "",
      };
    });
    expect(order.slice(0, 3)).toEqual(["select #materia", "settle", "click #incluir"]);
  });

  it("a screen where readings in a row bring nothing new stops ONE there, and nothing else is tried", async () => {
    const court = new StandInPje();
    // The screen undoes the matéria each time: ONE chooses it, it is gone, and again.
    court.undoes = 99;
    let readings = 0;
    const result = await pjeRun(court, async () => {
      readings += 1;
      return {
        tela: { tipo: "formulario", titulo: "Cadastro de processo" },
        acoes: [{ fazer: "escolher", alvo: P("materia"), opcao: "1215" }],
        pronto: false,
        pergunta: "",
      };
    });
    expect(result.outcome).toEqual({ kind: "stuck", why: "same_screen" });
    // The first reading did something new; the three after it did nothing that had not been done.
    expect(readings).toBe(4);
  });
});

describe("the path ONE keeps of a screen whose line depends on a search", () => {
  it("never follows again a step that pressed the line a search found", async () => {
    const frames: MappedScreen[] = [
      {
        system: "pje-tjrj",
        host: "tjrj.pje.jus.br",
        path: "/1g/Processo/CadastroProcesso/listView.seam",
        params: {},
        title: "Cadastro de processo",
        headings: ["Assuntos"],
        fields: [field("button", "pesquisar", "PESQUISAR")],
        tables: [
          {
            selector: "#resultado",
            index: 0,
            headers: ["Cod.", "Assunto"],
            rows: 1,
            lines: [{ cells: ["4830", "Cancelamento de vôo"], actions: [field("link", "add1", "Adicionar")] }],
          },
        ],
        capturedAt: "2026-11-26T12:33:00.000Z",
      },
    ];
    const pressed = learnedStep(frames, "formulario", [{ fazer: "clicar", alvo: P("add1") }], FACTS);
    expect(pressed.linhas).toBe(true);
    expect(stepFor([pressed], frames, FACTS)).toBeNull();
    const searched = learnedStep(frames, "formulario", [{ fazer: "clicar", alvo: P("pesquisar") }], FACTS);
    expect(searched).not.toHaveProperty("linhas");
    expect(stepFor([searched], frames, FACTS)).toEqual(searched);
    // The line's action is a target the plan may name.
    expect(
      checkPlan(
        {
          tela: { tipo: "formulario", titulo: "" },
          acoes: [{ fazer: "clicar", alvo: P("add1") }],
          pronto: false,
          pergunta: "",
        },
        frames,
        FACTS,
      ).problems,
    ).toEqual([]);
  });
});

// ---------- The target a plan names (the PJe of TJRJ, 2026-11-26) ----------

/** The "Dados iniciais" as the extension read them: the PJe's lists by their JSF ids, and a button of each row. */
const PJE_SCREEN: MappedScreen[] = [
  {
    system: "pje-tjrj",
    host: "tjrj.pje.jus.br",
    path: "/1g/Processo/CadastroProcesso/listView.seam",
    params: {},
    title: "Cadastro de processo",
    headings: ["Cadastro de processo"],
    fields: [
      field("select", "materia", "Matéria", {
        selector: "#processoTrfForm\\:classeJudicial\\:j_id207\\:areaDireitoCombo",
        options: MATERIAS,
        optionCount: 2,
        chosen: "",
      }),
      field("button", "incluir", "INCLUIR", { selector: "tr > td > button", index: 0 }),
      field("button", "incluir2", "INCLUIR", { selector: "tr > td > button", index: 1 }),
    ],
    tables: [],
    capturedAt: "2026-11-26T18:15:00.000Z",
  },
];
const MATERIA = "#processoTrfForm\\:classeJudicial\\:j_id207\\:areaDireitoCombo";

describe("the target a plan names", () => {
  it("reads the bare selector the AI answered with as the one field it names, and never guesses between two", () => {
    const fields = fieldsByTarget(PJE_SCREEN);
    expect(resolveTarget(fields, `0|${MATERIA}|0`)).toBe(`0|${MATERIA}|0`);
    // What the first and second instructions led the AI to answer, every action then dropped as an unknown target.
    expect(resolveTarget(fields, MATERIA)).toBe(`0|${MATERIA}|0`);
    expect(resolveTarget(fields, `${MATERIA}|0`)).toBe(`0|${MATERIA}|0`);
    expect(resolveTarget(fields, `0|${MATERIA}`)).toBe(`0|${MATERIA}|0`);
    // Two fields share the selector: only its position tells them apart.
    expect(resolveTarget(fields, "tr > td > button")).toBeNull();
    expect(resolveTarget(fields, "tr > td > button|1")).toBe("0|tr > td > button|1");
    expect(resolveTarget(fields, "#naoExiste")).toBeNull();
  });

  it("checks a plan with the bare selector and hands its action back keyed as the screen keys it", () => {
    const { actions, problems } = checkPlan(
      {
        tela: { tipo: "formulario", titulo: "Cadastro de processo" },
        acoes: [
          { fazer: "escolher", alvo: MATERIA, opcao: "1215" },
          { fazer: "esperar", alvo: "#processoTrfForm\\:classeJudicial\\:jurisdicaoCombo" },
        ],
        pronto: false,
        pergunta: "",
      },
      PJE_SCREEN,
      FACTS,
    );
    expect(problems).toEqual([]);
    expect(actions[0]).toEqual({ fazer: "escolher", alvo: `0|${MATERIA}|0`, opcao: "1215" });
  });

  it("chooses the matéria when the AI names it by its selector, where before only the wait ran", async () => {
    const court = new StandInPje();
    const result = await runFiling({
      driver: court,
      planner: async () =>
        court.chosen.get("#materia") === "1215"
          ? null
          : {
              tela: { tipo: "formulario", titulo: "Cadastro de processo" },
              acoes: [
                { fazer: "escolher", alvo: "#materia", opcao: "1215" },
                { fazer: "esperar", alvo: "#jurisdicao" },
              ],
              pronto: false,
              pergunta: "",
            },
      system: "PJe do TJRJ",
      facts: FACTS,
      file: async () => PDF,
      learning: false,
      confirm: async () => "go",
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    });
    expect(court.chosen.get("#materia")).toBe("1215");
    expect(result.outcome).toEqual({ kind: "stuck", why: "no_plan" });
  });

  it("hands the AI each field with its target to copy, in the place of the selector and its position", () => {
    const [frame] = screenForAi(PJE_SCREEN) as {
      quadro: number;
      fields: Record<string, unknown>[];
    }[];
    expect(frame?.quadro).toBe(0);
    expect(frame?.fields[0]).toMatchObject({ alvo: `0|${MATERIA}|0`, kind: "select", label: "Matéria", chosen: "" });
    expect(frame?.fields[0]).not.toHaveProperty("selector");
    expect(frame?.fields[0]).not.toHaveProperty("index");
    expect(frame?.fields.map((item) => item.alvo)).toEqual([
      `0|${MATERIA}|0`,
      "0|tr > td > button|0",
      "0|tr > td > button|1",
    ]);
  });
});

// ---------- The PJe's signature and its last tab (its manual, 2026-11-26) ----------

/** The tab "Incluir petições e documentos" of a PJe: the files in, and the button that signs with the certificate. */
class StandInSigning implements ScreenDriver {
  clicks: string[] = [];
  async capture(): Promise<MappedScreen[]> {
    return [
      {
        system: "pje-tjrj",
        host: "tjrj.pje.jus.br",
        path: "/1g/Processo/CadastroProcesso/listView.seam",
        params: {},
        title: "Cadastro de processo",
        headings: ["Incluir petições e documentos"],
        fields: [field("button", "assinar", "ASSINAR DOCUMENTO(S)"), field("link", "abaCustas", "CUSTAS JUDICIAIS")],
        tables: [],
        capturedAt: "2026-11-26T19:00:00.000Z",
      },
    ];
  }
  async text(): Promise<string> {
    return "";
  }
  async fill(): Promise<boolean> {
    return true;
  }
  async select(): Promise<boolean> {
    return true;
  }
  async check(): Promise<boolean> {
    return true;
  }
  async click(target: Target): Promise<boolean> {
    this.clicks.push(target.selector);
    return true;
  }
  async upload(): Promise<boolean> {
    return true;
  }
  async settle(): Promise<void> {}
}

describe("the PJe's signature with the lawyer's certificate", () => {
  it("presses the button that signs once and waits for the lawyer, who signs in the PJeOffice", async () => {
    const court = new StandInSigning();
    const seen: PlanInput[] = [];
    const planner = async (input: PlanInput): Promise<ScreenPlan> => {
      seen.push(input);
      const signed = input.feito.some((item) => item.acao.alvo === P("assinar") && item.resultado === "ok");
      return {
        tela: { tipo: "formulario", titulo: "Incluir petições e documentos" },
        acoes: [{ fazer: "clicar", alvo: signed ? P("abaCustas") : P("assinar") }],
        pronto: false,
        pergunta: "",
      };
    };
    const base = {
      driver: court,
      planner,
      system: "PJe do TJRJ",
      facts: FACTS,
      file: async () => PDF,
      learning: false,
      confirm: async () => "go" as const,
      map: null,
      beforeSend: async () => ({ ok: true, code: "sending" }),
    };
    const first = await runFiling(base);
    expect(first.outcome).toEqual({ kind: "question", question: SIGN_QUESTION });
    expect(court.clicks).toEqual(["#assinar"]);
    // The lawyer signed and said "Continuar": the run taken up again knows the button was pressed.
    const again = await runFiling({ ...base, resume: first.screen, maxScreens: 1 });
    expect(seen[1]?.feito.map((item) => item.acao.alvo)).toEqual([P("assinar")]);
    expect(court.clicks).toEqual(["#assinar", "#abaCustas"]);
    expect(again.outcome.kind).toBe("stuck");
  });

  it("never takes the PJe's tab 'Protocolar inicial' for the button that sends, which 'Protocolar' is", () => {
    expect(MAY_SEND.test("PROTOCOLAR INICIAL")).toBe(false);
    expect(MAY_SEND.test("PROTOCOLAR")).toBe(true);
    expect(MAY_SEND.test("Confirmar ajuizamento")).toBe(true);
    expect(SIGNS.test("ASSINAR DOCUMENTO(S)")).toBe(true);
    expect(SIGNS.test("Assinar e enviar")).toBe(false);
  });
});
