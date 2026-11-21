import type { MappedScreen } from "@/lib/court-extension/capture";
import type { FilingFacts } from "@/lib/court-robot/facts";
import { type LearnedStep, learnedStep, sameScreen, signatureOf, stepFor } from "@/lib/court-robot/map";
import {
  checkPlan,
  fieldsByTarget,
  parseTarget,
  type PlanAction,
  receiptNumber,
  type ScreenPlan,
  type Target,
} from "@/lib/court-robot/plan";

/**
 * Files one lawsuit on a court's screen (the owner, 2026-11-20, root `CLAUDE.md`, "Three ways to file"), the same
 * code wherever it runs: in the lawyer's own browser (the extension, a driver over the page) or in ONE's own browser
 * (a driver over Playwright). Screen by screen it reads the structure (never a value), follows the step the map of
 * the system has for it or asks the AI that reads screens (`protocolo.tela`), checks the plan, does it, and reads the
 * screen again. The facts' values are typed here, never seen by the AI.
 *
 * What it never does: type a login, a password or a code (it answers that the court asks one, and the host asks the
 * lawyer); solve a captcha or accept a term (it answers with the question); press, while ONE still learns the system,
 * the first button that may send anything to the court before the lawyer says so (`confirm`, asked once per filing:
 * in the extension over the screen itself, in ONE's browser in ONE with the screen in front of them), the database
 * marking the filing as going before that press; press it again once pressed (an answer that does not come is
 * `unknown`, and a lawyer looks in the court's system). Pure over its driver, its planner and its host, so it is
 * tested with stand-ins of them.
 */

export type DriverFile = { name: string; type: string; bytes: Uint8Array };

export interface ScreenDriver {
  /** The structure of the screen now, every frame of it (labels, the system's own lists, buttons). */
  capture(): Promise<MappedScreen[]>;
  /** The page's visible text, read here only (never sent to the AI): the receipt's number. */
  text(): Promise<string>;
  fill(target: Target, value: string): Promise<boolean>;
  /** Picks a line of a list: by its code, or by the words of its text (a list the system filled after a search). */
  select(target: Target, choice: { code: string } | { text: string }): Promise<boolean>;
  check(target: Target, on: boolean): Promise<boolean>;
  click(target: Target): Promise<boolean>;
  upload(target: Target, file: DriverFile): Promise<boolean>;
  /** Waits until the page stops changing after an action. */
  settle(): Promise<void>;
}

export type PlanInput = {
  sistema: string;
  aprendendo: boolean;
  fatos: FilingFacts["fatos"];
  partes: FilingFacts["partes"];
  arquivos: FilingFacts["arquivos"];
  tela: MappedScreen[];
  feito: { acao: PlanAction; resultado: string }[];
};

/** Asks the AI what to do on a screen. Null when it gave no usable answer. */
export type ScreenPlanner = (input: PlanInput) => Promise<ScreenPlan | null>;

/** The first button that may send to the court, while ONE learns the system: where it is and what it says. */
export type SendPoint = { titulo: string; botao: string; target: Target; frames: MappedScreen[] };

/**
 * The lawyer's word before the first button that may send, while ONE learns the system: go, stop, or `moved` when the
 * lawyer acted on the court's screen themself while ONE waited (in their own browser, the extension sees the screen
 * change): what they pressed may have sent the lawsuit, so the filing is marked as going, nothing is pressed for them,
 * and only the court's summary or its receipt may follow.
 */
export type Confirmation = "go" | "stop" | "moved";

export type RunInput = {
  driver: ScreenDriver;
  planner: ScreenPlanner;
  system: string;
  facts: FilingFacts;
  file(position: number): Promise<DriverFile | null>;
  /** ONE still learns the system: the first button that may send waits for the lawyer's word. */
  learning: boolean;
  /** The lawyer already confirmed this filing (in ONE, while it waited): nothing is asked again. */
  confirmed?: boolean;
  /**
   * The database already marks this filing as going: a run taken up again after the lawyer acted on the screen. Only
   * the court's summary or its receipt may follow, and nothing is marked again.
   */
  sent?: boolean;
  confirm(point: SendPoint): Promise<Confirmation>;
  map: LearnedStep[] | null;
  /** Before the first button that may send: the database marks the filing as going (0101's `sending`). */
  beforeSend(): Promise<{ ok: boolean; code: string }>;
  maxScreens?: number;
};

export type RunOutcome =
  | { kind: "filed"; number: string | null }
  | { kind: "not_confirmed" }
  | { kind: "login" }
  | { kind: "code" }
  | { kind: "question"; question: string }
  | { kind: "court_error"; question: string }
  | { kind: "unknown" }
  | { kind: "not_sent"; code: string }
  | { kind: "stuck"; why: string };

export type RunResult = { outcome: RunOutcome; learned: LearnedStep[]; aiScreens: number };

const SAME_SCREEN_LIMIT = 3;

async function act(driver: ScreenDriver, action: PlanAction, input: RunInput): Promise<string> {
  if (action.fazer === "esperar") {
    await driver.settle();
    return "ok";
  }
  const target = parseTarget(action.alvo);
  if (!target) return "unknown_target";
  switch (action.fazer) {
    case "preencher": {
      const value = action.fato ? input.facts.values[action.fato] : undefined;
      if (value === undefined) return "unknown_fact";
      return (await driver.fill(target, value)) ? "ok" : "not_done";
    }
    case "escolher": {
      if (action.opcao) return (await driver.select(target, { code: action.opcao })) ? "ok" : "not_done";
      const value = action.fato ? input.facts.values[action.fato] : undefined;
      if (value === undefined) return "unknown_fact";
      return (await driver.select(target, { text: value })) ? "ok" : "not_done";
    }
    case "marcar":
    case "desmarcar":
      return (await driver.check(target, action.fazer === "marcar")) ? "ok" : "not_done";
    case "clicar":
      return (await driver.click(target)) ? "ok" : "not_done";
    case "anexar": {
      const file = typeof action.arquivo === "number" ? await input.file(action.arquivo) : null;
      if (!file) return "unknown_file";
      return (await driver.upload(target, file)) ? "ok" : "not_done";
    }
  }
}

export async function runFiling(input: RunInput): Promise<RunResult> {
  const { driver } = input;
  const learned: LearnedStep[] = [];
  const maxScreens = input.maxScreens ?? 40;
  let aiScreens = 0;
  // Something that may have sent was pressed: from here only the court's summary and its receipt may follow.
  let sent = input.sent === true;
  // The lawyer said ONE may send this filing (asked once, and only while ONE learns the system).
  let confirmed = !input.learning || input.confirmed === true;
  let previous: ReturnType<typeof signatureOf> | null = null;
  let repeats = 0;

  const done = (outcome: RunOutcome): RunResult => ({ outcome, learned, aiScreens });

  for (let screen = 0; screen < maxScreens; screen += 1) {
    const frames = await driver.capture();
    const signature = signatureOf(frames);
    repeats = previous && sameScreen(previous, signature) ? repeats + 1 : 0;
    previous = signature;
    if (repeats >= SAME_SCREEN_LIMIT) return done(sent ? { kind: "unknown" } : { kind: "stuck", why: "same_screen" });

    // The map's step for this screen, else the AI's reading of it.
    const known = repeats === 0 ? stepFor(input.map, frames, input.facts) : null;
    let plan: ScreenPlan | null;
    if (known) {
      plan = { tela: { tipo: known.tipo, titulo: signature.titulo }, acoes: known.acoes, pronto: true, pergunta: "" };
    } else {
      aiScreens += 1;
      plan = await input.planner({
        sistema: input.system,
        // Learning holds back the button that sends only until the lawyer confirmed this filing: after their word,
        // the court's summary is confirmed by ONE, else it would wait there with nothing to press.
        aprendendo: input.learning && !confirmed,
        fatos: input.facts.fatos,
        partes: input.facts.partes,
        arquivos: input.facts.arquivos,
        tela: frames,
        feito: [],
      });
    }
    if (!plan) return done(sent ? { kind: "unknown" } : { kind: "stuck", why: "no_plan" });

    const kind = plan.tela.tipo;
    if (kind === "recibo") {
      const number = receiptNumber(await driver.text());
      // A receipt with nothing pressed that may send: the court took it all the same, and it is said as filed.
      if (!sent) {
        const going = await input.beforeSend();
        if (!going.ok) return done({ kind: "unknown" });
      }
      learned.push(learnedStep(frames, "recibo", [], input.facts));
      return done({ kind: "filed", number });
    }
    if (sent && kind !== "resumo") return done({ kind: "unknown" });
    if (kind === "login") return done({ kind: "login" });
    if (kind === "segundo_fator") return done({ kind: "code" });
    if (kind === "aviso") return done({ kind: "question", question: plan.pergunta || plan.tela.titulo });
    if (kind === "erro") return done({ kind: "court_error", question: plan.pergunta || plan.tela.titulo });
    if (plan.pergunta && plan.acoes.length === 0) return done({ kind: "question", question: plan.pergunta });

    const { actions, problems } = checkPlan(plan, frames, input.facts);
    if (problems.length > 0 && actions.length === 0) {
      return done({ kind: "stuck", why: problems[0]?.code ?? "invalid_plan" });
    }

    const fields = fieldsByTarget(frames);
    const doneHere: PlanAction[] = [];
    // The lawyer acted on the screen while ONE waited for their word: this screen is theirs from there.
    let moved = false;
    for (const action of actions) {
      if (action.envia) {
        if (!confirmed) {
          const target = parseTarget(action.alvo);
          if (!target) return done({ kind: "stuck", why: "unknown_target" });
          const word = await input.confirm({
            titulo: plan.tela.titulo,
            botao: fields.get(action.alvo)?.label ?? "",
            target,
            frames,
          });
          if (word === "stop") {
            learned.push(learnedStep(frames, kind, doneHere, input.facts));
            return done({ kind: "not_confirmed" });
          }
          confirmed = true;
          moved = word === "moved";
        }
        if (!sent) {
          const going = await input.beforeSend();
          // What the lawyer pressed may have reached the court: it is never said as not sent.
          if (!going.ok) return done(moved ? { kind: "unknown" } : { kind: "not_sent", code: going.code });
          sent = true;
        }
        if (moved) break;
      }
      const result = await act(driver, action, input);
      if (result !== "ok") return done(sent ? { kind: "unknown" } : { kind: "stuck", why: result });
      doneHere.push(action);
      if (action.envia) break;
    }
    learned.push(learnedStep(frames, kind, doneHere, input.facts));
    if (!moved && plan.pergunta && !plan.pronto) return done({ kind: "question", question: plan.pergunta });
    await driver.settle();
  }
  return done(sent ? { kind: "unknown" } : { kind: "stuck", why: "too_many_screens" });
}
