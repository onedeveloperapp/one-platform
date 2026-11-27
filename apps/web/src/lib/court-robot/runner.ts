import type { MappedScreen } from "@/lib/court-extension/capture";
import type { FilingFacts } from "@/lib/court-robot/facts";
import {
  type LearnedStep,
  learnedStep,
  sameScreen,
  type ScreenSignature,
  signatureOf,
  stepFor,
} from "@/lib/court-robot/map";
import {
  checkPlan,
  type DoneAction,
  fieldsByTarget,
  parseTarget,
  PATH_SCREENS_MOST,
  type PathStep,
  pathStepOf,
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
 * screen again. The facts' values are typed here, never seen by the AI. A screen read again is read with what ONE
 * already did on it (`feito`), so a form whose lists load one after the other goes forward one list at a time; an
 * action the screen did not take sends ONE back to read it, and ONE stops on a screen only when readings in a row
 * bring nothing new (2026-11-26, the PJe of TJRJ). Every screen is read with the path of the screens before it in this
 * filing (`percurso`), carried across a pause the lawyer ends with "Continuar", so ONE knows a filing it started is
 * its own (2026-11-27).
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
  /**
   * Whether the court's session ended and its sign-in is on the screen (ONE's own browser, whose court sends it to a
   * sign-in of another host the robot does not read): then the host signs in again. Absent where the AI says it.
   */
  signedOut?(): Promise<boolean>;
  /**
   * Told before each action whether it may send the lawsuit: ONE's own browser answers yes to the court's own question
   * ("confirma?") only on a press that may send, which the lawyer's word or a trusted map allowed.
   */
  pressing?(sends: boolean): void;
}

export type PlanInput = {
  sistema: string;
  aprendendo: boolean;
  fatos: FilingFacts["fatos"];
  partes: FilingFacts["partes"];
  arquivos: FilingFacts["arquivos"];
  tela: MappedScreen[];
  /** What ONE did on this same screen before this reading, in order, with what came of each action. */
  feito: DoneAction[];
  /** The screens ONE went through in this filing before this one, in order, with what it did on each. */
  percurso: PathStep[];
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
  /**
   * The screen the run before this one stopped on, with what ONE did there and the path that led to it (a pause the
   * lawyer ended with "Continuar"): read again as the same screen, ONE knows what it already pressed (the button that
   * signs, above all); on another screen (the lawyer moved on), ONE knows the filing is still its own.
   */
  resume?: ScreenState | null;
};

/**
 * A screen as the run left it: what tells it apart, what ONE did on it, its words as the AI named it, and the screens
 * before it in this filing.
 */
export type ScreenState = { signature: ScreenSignature; done: DoneAction[]; titulo?: string; path?: PathStep[] };

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

export type RunResult = {
  outcome: RunOutcome;
  learned: LearnedStep[];
  aiScreens: number;
  /** The screen the run stopped on, for the run that takes it up again. */
  screen: ScreenState | null;
};

/**
 * How many readings in a row of one screen may bring nothing new (no action done that was not done there before)
 * before ONE stops there: a screen whose lists load one after the other (the PJe of TJRJ: the matéria, then the
 * jurisdição, then the class) is read once per list, and only a screen where nothing moves stops ONE.
 */
const IDLE_READINGS_MOST = 3;
/** How many times one screen is read at most, whatever was done on it. */
const ONE_SCREEN_READINGS_MOST = 12;
/** How many of the actions done on a screen the AI reads again: the latest. */
const DONE_SHOWN_MOST = 40;

/** An action as it is told apart from the others done on the same screen. */
const actionKey = (action: PlanAction): string =>
  [action.fazer, action.alvo, action.fato ?? "", action.opcao ?? "", action.arquivo ?? ""].join("|");

/**
 * The words of a button that signs the documents with the lawyer's certificate on their computer (the PJe's
 * "Assinar documento(s)", through the PJeOffice): the lawyer types the certificate's PIN, never ONE. One that also
 * sends ("Assinar e enviar") is a press that may send, asked before as such.
 */
export const SIGNS = /^\s*assinar( o| os)?( documento| documentos| documento\(s\))?\s*$/i;

/** What the lawyer is asked after ONE pressed a button that signs with their certificate (2026-11-26). */
export const SIGN_QUESTION =
  "assine os documentos com o seu certificado no PJeOffice. Se o Chrome perguntar se o site pode acessar a rede local, toque em Permitir";

/** An action after which the page may change (a list that loads another, a press, a file sent): it settles first. */
const MOVES_PAGE: readonly PlanAction["fazer"][] = ["escolher", "clicar", "marcar", "desmarcar", "anexar"];

async function act(driver: ScreenDriver, action: PlanAction, input: RunInput): Promise<string> {
  driver.pressing?.(action.envia === true);
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
  let previous: ScreenSignature | null = input.resume?.signature ?? null;
  // What ONE did on the screen it is on, read again by the AI each time it reads that screen (2026-11-26: with
  // nothing of it, ONE chose the PJe's matéria three times over and stopped there).
  let doneOnScreen: DoneAction[] = input.resume ? [...input.resume.done] : [];
  let doneKeys = new Set<string>(
    doneOnScreen.filter((item) => item.resultado === "ok").map((item) => actionKey(item.acao)),
  );
  // The screens ONE went through in this filing before the one it is on, what it did on each (2026-11-27).
  const path: PathStep[] = input.resume?.path ? [...input.resume.path] : [];
  // The words of the screen ONE is on, as the AI named it, else as the screen did: how the path tells it.
  let title = input.resume?.titulo ?? input.resume?.signature.titulo ?? "";
  let idleReadings = 0;
  let readings = 0;
  // Why the program refused the last action it refused on this screen: said if ONE stops there.
  let refusal: string | null = null;

  const done = (outcome: RunOutcome): RunResult => ({
    outcome,
    learned,
    aiScreens,
    screen: previous
      ? {
          signature: previous,
          done: doneOnScreen.slice(-DONE_SHOWN_MOST),
          titulo: title,
          path: path.slice(-PATH_SCREENS_MOST),
        }
      : null,
  });

  for (let screen = 0; screen < maxScreens; screen += 1) {
    // The court's session ended: after something that may have sent, what came of it is unknown.
    if (driver.signedOut && (await driver.signedOut())) return done(sent ? { kind: "unknown" } : { kind: "login" });
    const frames = await driver.capture();
    const signature = signatureOf(frames);
    const again = previous !== null && sameScreen(previous, signature);
    previous = signature;
    if (!again) {
      // The screen ONE leaves goes to the path, with what it did there.
      const left = pathStepOf(title, doneOnScreen);
      if (left) path.push(left);
      if (path.length > PATH_SCREENS_MOST) path.splice(0, path.length - PATH_SCREENS_MOST);
      title = signature.titulo;
      refusal = null;
      doneOnScreen = [];
      doneKeys = new Set();
      idleReadings = 0;
      readings = 0;
    }
    readings += 1;
    // The same screen read again and again with nothing new done on it: ONE stops there.
    if (again && (idleReadings >= IDLE_READINGS_MOST || readings > ONE_SCREEN_READINGS_MOST)) {
      return done(sent ? { kind: "unknown" } : { kind: "stuck", why: refusal ?? "same_screen" });
    }

    // The map's step for this screen, the first time it is read, else the AI's reading of it.
    const known = !again ? stepFor(input.map, frames, input.facts) : null;
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
        feito: doneOnScreen.slice(-DONE_SHOWN_MOST),
        percurso: path.slice(-PATH_SCREENS_MOST),
      });
    }
    if (!plan) return done(sent ? { kind: "unknown" } : { kind: "stuck", why: "no_plan" });
    if (plan.tela.titulo.trim()) title = plan.tela.titulo.trim();

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
    const fields = fieldsByTarget(frames);
    // What the program refused before trying (a fact the case lacks, a file in the petition's field, secrecy the case
    // does not ask) goes to `feito` with why, so the next reading takes another way (2026-11-27). A screen where every
    // action is refused is read again, and ONE stops there only when readings in a row bring nothing new.
    for (const problem of problems) {
      const asked = plan.acoes[problem.action];
      if (!asked) continue;
      const told = { ...asked };
      delete told.motivo;
      const rotulo = fields.get(asked.alvo)?.label;
      doneOnScreen.push({ acao: told, resultado: problem.code, ...(rotulo ? { rotulo } : {}) });
    }
    if (problems[0]) refusal = problems[0].code;
    if (problems.length > 0 && actions.length === 0) {
      idleReadings += 1;
      await driver.settle();
      continue;
    }

    const doneHere: PlanAction[] = [];
    // The lawyer acted on the screen while ONE waited for their word: this screen is theirs from there.
    let moved = false;
    // Something was done here that was not done on this screen before: the reading brought the screen forward.
    let progressed = false;
    // An action the screen did not take: the screen is read again, and the AI sees what came of it.
    let refused = false;
    for (const [position, action] of actions.entries()) {
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
      const told = { ...action };
      delete told.motivo;
      const rotulo = fields.get(action.alvo)?.label;
      doneOnScreen.push({ acao: told, resultado: result, ...(rotulo ? { rotulo } : {}) });
      if (result !== "ok") {
        // After a press that may have sent, nothing is tried again: what came of it is unknown.
        if (sent) return done({ kind: "unknown" });
        refused = true;
        break;
      }
      doneHere.push(action);
      if (action.fazer !== "esperar" && !doneKeys.has(actionKey(action))) {
        doneKeys.add(actionKey(action));
        progressed = true;
      }
      // A press that signs with the lawyer's certificate (the PJe's "Assinar documento(s)", through the PJeOffice on
      // their computer): only the lawyer types its PIN, so ONE waits for them, and presses nothing else meanwhile.
      if (!action.envia && action.fazer === "clicar" && SIGNS.test(fields.get(action.alvo)?.label ?? "")) {
        learned.push(learnedStep(frames, kind, doneHere, input.facts));
        return done({ kind: "question", question: SIGN_QUESTION });
      }
      if (action.envia) break;
      // A list that loads the next, a press, a file sent: the page settles before the next action acts on it.
      if (MOVES_PAGE.includes(action.fazer) && position < actions.length - 1) await driver.settle();
    }
    idleReadings = progressed ? 0 : idleReadings + 1;
    learned.push(learnedStep(frames, kind, doneHere, input.facts));
    if (!refused && !moved && plan.pergunta && !plan.pronto) {
      return done({ kind: "question", question: plan.pergunta });
    }
    await driver.settle();
  }
  return done(sent ? { kind: "unknown" } : { kind: "stuck", why: "too_many_screens" });
}
