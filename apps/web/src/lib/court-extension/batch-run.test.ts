import { describe, expect, it } from "vitest";

import { runBatch, type RunPanel } from "@/lib/court-extension/batch-run";
import type { MappedField, MappedScreen } from "@/lib/court-extension/capture";
import type { OneAnswer, OneApi } from "@/lib/court-extension/one-api";
import { filingFactsOf, type ToSend } from "@/lib/court-robot/facts";
import type { LearnedStep } from "@/lib/court-robot/map";
import { type ScreenPlan, type Target, targetKey } from "@/lib/court-robot/plan";
import type { ScreenDriver } from "@/lib/court-robot/runner";
import type { ExtensionFiling } from "@/lib/filing-ways/extension-protocol";

// ---------- A stand-in eproc of four screens, as the lawyer's tab shows it ----------

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

const SCREENS = [
  {
    heading: "Peticionamento Eletrônico (1 de 5) - Informações do processo",
    acao: "processo_ajuizamento",
    fields: [field("input", "txtValorCausa", "Valor da causa"), field("button", "btnProxima", "Próxima")],
  },
  {
    heading: "Peticionamento Eletrônico (5 de 5) - Documentos",
    acao: "processo_ajuizamento_documentos",
    fields: [
      field("input", "arquivo", "Escolher arquivo", { type: "file" }),
      field("button", "btnFinalizar", "Finalizar"),
    ],
  },
  {
    heading: "Resumo do ajuizamento",
    acao: "processo_ajuizamento_resumo",
    fields: [field("button", "btnConfirmar", "Confirmar ajuizamento")],
  },
  { heading: "Processo distribuído", acao: "processo_ajuizamento_recibo", fields: [] as MappedField[] },
];

class StandInTab implements ScreenDriver {
  screen = 0;
  clicks: string[] = [];
  files: string[] = [];
  /** The court asks its code once, at the first screen, until the lawyer types it. */
  asksCode = false;
  async capture(): Promise<MappedScreen[]> {
    const here = this.asksCode
      ? { heading: "Autenticação em dois fatores", acao: "login_2fa", fields: [field("input", "txtCodigo", "Código")] }
      : SCREENS[this.screen]!;
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
        capturedAt: "2026-11-21T15:00:00.000Z",
      },
    ];
  }
  async text(): Promise<string> {
    return this.screen === 3 ? "Processo 1000123-07.2099.8.26.0100 distribuído ao 1º Juizado Especial Cível" : "";
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
    if (target.selector === "#btnProxima") this.screen = 1;
    if (target.selector === "#btnFinalizar") this.screen = 2;
    if (target.selector === "#btnConfirmar") this.screen = 3;
    return true;
  }
  async upload(_target: Target, file: { name: string }): Promise<boolean> {
    this.files.push(file.name);
    return true;
  }
  async settle(): Promise<void> {}
}

const T = (id: string) => targetKey(0, { selector: `#${id}`, index: 0 });

function planFor(heading: string, aprendendo: boolean): ScreenPlan | null {
  if (heading.includes("dois fatores"))
    return { tela: { tipo: "segundo_fator", titulo: heading }, acoes: [], pronto: false, pergunta: "" };
  if (heading.includes("Informações")) {
    return {
      tela: { tipo: "formulario", titulo: heading },
      acoes: [
        { fazer: "preencher", alvo: T("txtValorCausa"), fato: "processo.valor_causa" },
        { fazer: "clicar", alvo: T("btnProxima") },
      ],
      pronto: true,
      pergunta: "",
    };
  }
  if (heading.includes("Documentos")) {
    return {
      tela: { tipo: "formulario", titulo: heading },
      acoes: [
        { fazer: "anexar", alvo: T("arquivo"), arquivo: 1 },
        { fazer: "clicar", alvo: T("btnFinalizar") },
      ],
      pronto: true,
      pergunta: "",
    };
  }
  if (heading.includes("Resumo")) {
    // While ONE learns and the lawyer has not given their word, the AI holds back the button that sends.
    return aprendendo
      ? { tela: { tipo: "resumo", titulo: heading }, acoes: [], pronto: false, pergunta: "" }
      : {
          tela: { tipo: "resumo", titulo: heading },
          acoes: [{ fazer: "clicar", alvo: T("btnConfirmar"), envia: true }],
          pronto: true,
          pergunta: "",
        };
  }
  if (heading.includes("distribuído"))
    return { tela: { tipo: "recibo", titulo: heading }, acoes: [], pronto: true, pergunta: "" };
  return null;
}

// ---------- The lawsuit, and ONE as the extension calls it ----------

const SENT: ToSend = {
  submission_id: "s1",
  claim: 1,
  channel: "extension",
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

const filingOf = (id: string, extra: Partial<ExtensionFiling> = {}): ExtensionFiling => ({
  id,
  claim: 1,
  learning: true,
  confirmed: false,
  caseSeq: 12,
  client: "Marina",
  facts: filingFactsOf(SENT),
  files: [{ position: 1, name: "01-peticao-inicial.pdf", type: "application/pdf", url: "https://storage.invalid/1" }],
  ...extra,
});

type Call = { name: string; args: unknown[] };

class StandInOne {
  calls: Call[] = [];
  queue: ExtensionFiling[];
  confirmedInOne = new Set<string>();
  sendingRefused = false;
  learning: Map<string, boolean>;
  constructor(filings: ExtensionFiling[]) {
    this.queue = filings.slice();
    this.learning = new Map(filings.map((filing) => [filing.id, filing.learning]));
  }
  names = () => this.calls.map((call) => call.name);
  api(): OneApi {
    const yes = <T>(value: T): Promise<OneAnswer<T>> => Promise.resolve({ ok: true, value });
    const record = (name: string, args: unknown[]) => this.calls.push({ name, args });
    return {
      link: async () => ({ ok: false, error: "unused" }),
      situation: async () => ({ ok: false, error: "unused" }),
      start: async () => ({ ok: false, error: "unused" }),
      next: async (...args) => {
        record("next", args);
        return yes({ filing: this.queue.shift() ?? null });
      },
      keep: async (...args) => {
        record("keep", args);
        return yes({ held: true });
      },
      finish: async (...args) => {
        record("finish", args);
        return yes({ code: args[2] ? "stopped" : "done" });
      },
      plan: async (...args) => {
        record("plan", args);
        const screen = args[2] as MappedScreen[];
        const filing = args[0] as string;
        // The backend says it learns until the lawyer's word for this filing came.
        const word =
          this.calls.some((call) => call.name === "confirm" && call.args[0] === filing) ||
          this.confirmedInOne.has(filing);
        return yes({ plan: planFor(screen[0]?.headings[0] ?? "", (this.learning.get(filing) ?? true) && !word) });
      },
      hold: async (...args) => {
        record("hold", args);
        return yes({ code: "confirming" });
      },
      confirm: async (...args) => {
        record("confirm", args);
        return this.confirmedInOne.has(args[0]) ? { ok: false, error: "not_confirming" } : yes({ code: "confirmed" });
      },
      state: async (...args) => {
        record("state", args);
        return yes(
          this.confirmedInOne.has(args[0])
            ? { status: "claimed", confirmed: true, batch: "running" }
            : { status: "confirming", confirmed: false, batch: "awaiting_confirmation" },
        );
      },
      sending: async (...args) => {
        record("sending", args);
        return this.sendingRefused
          ? yes({ going: false, code: "batch_not_running" })
          : yes({ going: true, code: "sending" });
      },
      path: async (...args) => {
        record("path", args);
        return yes({ saved: true });
      },
      result: async (...args) => {
        record("result", args);
        return yes({ code: (args[2] as { outcome: string }).outcome === "filed" ? "filed" : "unknown" });
      },
    };
  }
}

/** The panel, as the lawyer answers it in each test. */
function panelOf(answers: {
  word?: "go" | "stop" | "never";
  pause?: "continue" | "stop";
  onWord?: () => void;
  onPause?: () => void;
}) {
  const told: string[] = [];
  const panel: RunPanel = {
    tell: (news) => told.push(news.kind),
    askWord: () => {
      answers.onWord?.();
      const word = answers.word ?? "go";
      return {
        word: word === "never" ? new Promise<"go" | "stop">(() => undefined) : Promise.resolve(word),
        close: () => undefined,
      };
    },
    pause: async () => {
      answers.onPause?.();
      return answers.pause ?? "stop";
    },
  };
  return { panel, told };
}

const STARTED = (map: LearnedStep[] | null = null) => ({
  claim: 1,
  system: { key: "eproc-tjsp", name: "eproc do TJSP", host: "eproc1g.tjsp.jus.br" },
  learning: true,
  map,
});

const base = (one: StandInOne, tab: StandInTab, panel: RunPanel, map: LearnedStep[] | null = null) => ({
  api: one.api(),
  driver: tab,
  batchId: "b1",
  system: { key: "eproc-tjsp", name: "eproc do TJSP", host: "eproc1g.tjsp.jus.br" },
  started: STARTED(map),
  fetchFile: async () => ({
    name: "01-peticao-inicial.pdf",
    type: "application/pdf",
    bytes: new Uint8Array([37, 80, 68, 70]),
  }),
  panel,
  // A turn of the event loop: what the lawyer does meanwhile (a timer here) happens between two looks.
  wait: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  every: () => () => undefined,
});

describe("a batch filed by the lawyer's extension", () => {
  it("learning the system, it holds the filing for the lawyer's word, files it, keeps the path and the receipt", async () => {
    const one = new StandInOne([filingOf("s1")]);
    const tab = new StandInTab();
    const { panel, told } = panelOf({ word: "go" });
    const end = await runBatch(base(one, tab, panel));

    expect(end).toEqual({ filed: 1, unknown: 0, stopped: null, lookFor: null });
    expect(one.names().filter((name) => name !== "plan")).toEqual([
      "next",
      "hold",
      "confirm",
      "sending",
      "path",
      "result",
      "next",
      "finish",
    ]);
    // Held before "Finalizar", the first button that may send; sent once the lawyer's word came.
    expect(tab.clicks).toEqual(["#btnProxima", "#btnFinalizar", "#btnConfirmar"]);
    const result = one.calls.find((call) => call.name === "result")?.args[2] as { number: string; receipt: string };
    expect(result.number).toBe("10001230720998260100");
    expect(result.receipt).toContain("distribuído");
    expect(told).toEqual(["filing", "waiting_word", "filed"]);
    const finish = one.calls.find((call) => call.name === "finish");
    expect(finish?.args[2]).toBeNull();
  });

  it("when the lawyer says stop, nothing that may send is pressed and the batch stops with the path kept", async () => {
    const one = new StandInOne([filingOf("s1")]);
    const tab = new StandInTab();
    const { panel } = panelOf({ word: "stop" });
    const end = await runBatch(base(one, tab, panel));
    expect(end).toEqual({ filed: 0, unknown: 0, stopped: "not_confirmed", lookFor: null });
    expect(tab.clicks).not.toContain("#btnFinalizar");
    expect(one.names()).not.toContain("sending");
    expect(one.names()).toContain("path");
    expect(one.calls.find((call) => call.name === "finish")?.args[2]).toBe("not_confirmed");
  });

  it("when the lawyer presses the court's button themself, the filing is marked as going and ONE presses nothing for them", async () => {
    const one = new StandInOne([filingOf("s1")]);
    const tab = new StandInTab();
    // The lawyer pressed "Finalizar" on the court's screen while the panel asked.
    const { panel } = panelOf({ word: "never", onWord: () => setTimeout(() => (tab.screen = 2), 0) });
    const end = await runBatch(base(one, tab, panel));
    expect(end.filed).toBe(1);
    expect(tab.clicks).not.toContain("#btnFinalizar");
    expect(tab.clicks).toContain("#btnConfirmar");
    expect(one.names().filter((name) => name === "sending")).toHaveLength(1);
    expect(one.names()).toContain("confirm");
  });

  it("when the lawyer confirms in ONE meanwhile, it goes without asking again", async () => {
    const one = new StandInOne([filingOf("s1")]);
    const tab = new StandInTab();
    const { panel } = panelOf({ word: "never", onWord: () => one.confirmedInOne.add("s1") });
    const end = await runBatch(base(one, tab, panel));
    expect(end.filed).toBe(1);
    expect(one.names()).not.toContain("confirm");
    expect(one.names()).toContain("state");
  });

  it("what only the lawyer can do pauses the batch, and it goes on from the screen they leave", async () => {
    const one = new StandInOne([filingOf("s1", { learning: false })]);
    const tab = new StandInTab();
    tab.asksCode = true;
    const { panel } = panelOf({ pause: "continue", onPause: () => (tab.asksCode = false) });
    const end = await runBatch(base(one, tab, panel));
    expect(end.filed).toBe(1);
    expect(one.names()).not.toContain("hold");
  });

  it("a filing that went and whose answer cannot be read is unknown, and stops the batch for a lawyer to look", async () => {
    const one = new StandInOne([filingOf("s1", { learning: false }), filingOf("s2", { learning: false })]);
    const tab = new StandInTab();
    // The receipt never comes: the court shows the summary again after the press.
    tab.click = async (target: Target) => {
      tab.clicks.push(target.selector);
      if (target.selector === "#btnProxima") tab.screen = 1;
      if (target.selector === "#btnFinalizar") tab.screen = 0;
      return true;
    };
    const { panel } = panelOf({});
    const end = await runBatch(base(one, tab, panel));
    expect(end.unknown).toBe(1);
    expect(end.stopped).toBe("unknown_outcome");
    expect(end.lookFor?.id).toBe("s1");
    const result = one.calls.find((call) => call.name === "result")?.args[2] as { outcome: string };
    expect(result.outcome).toBe("unknown");
    expect(one.calls.find((call) => call.name === "finish")?.args[2]).toBe("unknown_outcome");
    expect(one.calls.filter((call) => call.name === "next")).toHaveLength(1);
  });

  it("the second lawsuit of a batch follows the path the first one learned, and still waits for the lawyer's word", async () => {
    const one = new StandInOne([filingOf("s1"), filingOf("s2")]);
    const tab = new StandInTab();
    let words = 0;
    const { panel } = panelOf({
      word: "go",
      onWord: () => {
        words += 1;
      },
    });
    // Each lawsuit starts on the first screen of the eproc.
    const original = tab.click.bind(tab);
    tab.click = async (target: Target) => {
      const done = await original(target);
      return done;
    };
    const next = one.api().next;
    const api = one.api();
    api.next = async (batchId, claim) => {
      tab.screen = 0;
      return next(batchId, claim);
    };
    const end = await runBatch({ ...base(one, tab, panel), api });
    expect(end.filed).toBe(2);
    expect(words).toBe(2);
    const plansOfSecond = one.calls.filter((call) => call.name === "plan" && call.args[0] === "s2");
    expect(plansOfSecond).toHaveLength(0);
  });
});
