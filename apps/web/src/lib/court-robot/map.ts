import type { MappedScreen } from "@/lib/court-extension/capture";
import type { FilingFacts } from "@/lib/court-robot/facts";
import { isLineTarget, type PlanAction, type ScreenKind } from "@/lib/court-robot/plan";

/**
 * The path ONE learned at a court's system (migration 0264, `court_screen_maps`): each screen by what tells it apart
 * (the parameters of its address that name it, its first heading, the names of its fields) and what was done there,
 * by targets, fact keys, the system's own codes and file positions. Never a value, a person, a token or a number of
 * a lawsuit: the map is the platform's, followed by every firm. Pure: no I/O.
 */

export type ScreenSignature = { params: Record<string, string>; titulo: string; campos: string[] };

/** The shape of the case a screen's actions were learned for, when they depend on it (parties, files). */
export type CaseShape = { autores: number; reus: number; arquivos: number };

export type LearnedStep = {
  assinatura: ScreenSignature;
  tipo: ScreenKind;
  acoes: PlanAction[];
  forma: CaseShape | null;
  /**
   * The step pressed the action of a line of a table (the subject a search found): which line depends on what the
   * search found for that case, so the step is never followed again, and ONE reads that screen each time.
   */
  linhas?: true;
};

const FIELDS_KEPT = 40;

/** What tells a screen apart, from every frame of it. */
export function signatureOf(frames: readonly MappedScreen[]): ScreenSignature {
  const params: Record<string, string> = {};
  for (const frame of frames)
    for (const [key, value] of Object.entries(frame.params)) params[key.toLowerCase()] = value;
  const titulo = (
    frames.find((frame) => frame.headings.length > 0)?.headings[0] ??
    frames[0]?.title ??
    ""
  ).toLowerCase();
  const campos = Array.from(
    new Set(
      frames.flatMap((frame) =>
        frame.fields
          .filter((field) => field.visible && field.kind !== "link")
          .map((field) => `${field.kind}:${field.name ?? field.id ?? field.label ?? ""}`.toLowerCase()),
      ),
    ),
  )
    .sort()
    .slice(0, FIELDS_KEPT);
  return { params, titulo, campos };
}

/** Whether two screens are the same screen: the same naming parameters and heading, and most of the same fields. */
export function sameScreen(a: ScreenSignature, b: ScreenSignature): boolean {
  const keys = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  for (const key of keys) if (a.params[key] !== b.params[key]) return false;
  if (a.titulo !== b.titulo) return false;
  if (a.campos.length === 0 && b.campos.length === 0) return true;
  const shared = a.campos.filter((field) => b.campos.includes(field)).length;
  return shared / Math.max(a.campos.length, b.campos.length) >= 0.8;
}

export const shapeOf = (facts: Pick<FilingFacts, "partes" | "arquivos">): CaseShape => ({
  autores: facts.partes.autores.length,
  reus: facts.partes.reus.length,
  arquivos: facts.arquivos.length,
});

/** Whether a screen's actions depend on how many parties and files the case has. */
const dependsOnShape = (actions: readonly PlanAction[]): boolean =>
  actions.some((action) => action.fazer === "anexar" || /^(autor|reu)\.\d+\./.test(action.fato ?? ""));

/** A step as the map keeps it: the screen, what it was, and what was done, with the case's shape when it matters. */
export function learnedStep(
  frames: readonly MappedScreen[],
  tipo: ScreenKind,
  actions: readonly PlanAction[],
  facts: Pick<FilingFacts, "partes" | "arquivos">,
): LearnedStep {
  // What the AI said of why it chose an action stays out of the map: only the action itself is kept.
  const kept = actions.map((action) => {
    const copy = { ...action };
    delete copy.motivo;
    return copy;
  });
  return {
    assinatura: signatureOf(frames),
    tipo,
    acoes: kept,
    forma: dependsOnShape(kept) ? shapeOf(facts) : null,
    ...(kept.some((action) => isLineTarget(frames, action.alvo)) ? { linhas: true as const } : {}),
  };
}

/**
 * The step of a map for this screen and this case, or null: a screen the map does not know, or whose actions were
 * learned for a case of another shape (then ONE reads the screen again).
 */
export function stepFor(
  map: readonly LearnedStep[] | null,
  frames: readonly MappedScreen[],
  facts: Pick<FilingFacts, "partes" | "arquivos">,
): LearnedStep | null {
  if (!map || map.length === 0) return null;
  const here = signatureOf(frames);
  const shape = shapeOf(facts);
  const step = map.find((candidate) => sameScreen(candidate.assinatura, here)) ?? null;
  if (!step || step.linhas) return null;
  if (
    step.forma &&
    (step.forma.autores !== shape.autores || step.forma.reus !== shape.reus || step.forma.arquivos !== shape.arquivos)
  ) {
    return null;
  }
  return step;
}

/** A map read from the database, or null when it is not one. */
export function readMap(steps: unknown): LearnedStep[] | null {
  if (!Array.isArray(steps)) return null;
  const read: LearnedStep[] = [];
  for (const raw of steps) {
    if (typeof raw !== "object" || raw === null) return null;
    const step = raw as Partial<LearnedStep>;
    if (!step.assinatura || !Array.isArray(step.acoes) || typeof step.tipo !== "string") return null;
    read.push({
      assinatura: {
        params: step.assinatura.params ?? {},
        titulo: step.assinatura.titulo ?? "",
        campos: step.assinatura.campos ?? [],
      },
      tipo: step.tipo,
      acoes: step.acoes,
      forma: step.forma ?? null,
      ...(step.linhas === true ? { linhas: true as const } : {}),
    });
  }
  return read;
}
