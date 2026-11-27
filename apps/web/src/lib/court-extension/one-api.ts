import type { MappedScreen } from "@/lib/court-extension/capture";
import type { LearnedStep } from "@/lib/court-robot/map";
import type { DoneAction, PathStep, ScreenPlan } from "@/lib/court-robot/plan";
import {
  EXTENSION_API,
  type ExtensionFiling,
  type ExtensionFilingState,
  type ExtensionLinked,
  type ExtensionSituation,
  type ExtensionStarted,
} from "@/lib/filing-ways/extension-protocol";

/**
 * The extension's side of its calls to ONE (`/api/extensao/v1/...`): each call with the token the extension took when
 * the lawyer linked it, and its answer read as the protocol says (`extension-protocol.ts`). Pure over `fetch`, so it is
 * tested with a stand-in of it; the extension builds it with ONE's address.
 */

export type OneAnswer<T> = { ok: true; value: T } | { ok: false; error: string };

export type OneApi = {
  link(code: string, label: string): Promise<OneAnswer<ExtensionLinked>>;
  situation(): Promise<OneAnswer<ExtensionSituation>>;
  start(batchId: string): Promise<OneAnswer<ExtensionStarted>>;
  next(batchId: string, claim: number): Promise<OneAnswer<{ filing: ExtensionFiling | null }>>;
  keep(batchId: string, claim: number): Promise<OneAnswer<{ held: boolean }>>;
  finish(batchId: string, claim: number, error: string | null): Promise<OneAnswer<{ code: string }>>;
  /**
   * The AI's reading of a screen, with what ONE did on that same screen before (`done`) and the screens before it in
   * this filing (`path`), both read again by the AI.
   */
  plan(
    filingId: string,
    claim: number,
    screen: MappedScreen[],
    done?: DoneAction[],
    path?: PathStep[],
  ): Promise<OneAnswer<{ plan: ScreenPlan | null }>>;
  hold(filingId: string, claim: number): Promise<OneAnswer<{ code: string }>>;
  confirm(filingId: string): Promise<OneAnswer<{ code: string }>>;
  state(filingId: string): Promise<OneAnswer<ExtensionFilingState>>;
  sending(filingId: string, claim: number): Promise<OneAnswer<{ going: boolean; code: string }>>;
  path(
    filingId: string,
    claim: number,
    steps: LearnedStep[],
    aiScreens: number,
  ): Promise<OneAnswer<{ saved: boolean }>>;
  result(
    filingId: string,
    claim: number,
    outcome: { outcome: "filed" | "unknown"; number?: string | null; message?: string | null; receipt?: string | null },
  ): Promise<OneAnswer<{ code: string }>>;
};

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

/** ONE's calls from the extension, at ONE's address, with the token it holds (null before it is linked). */
export function oneApi(base: string, token: () => string | null, fetcher: Fetch): OneApi {
  const root = `${base.replace(/\/+$/, "")}${EXTENSION_API}`;

  async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<OneAnswer<T>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const held = token();
    if (held) headers.Authorization = `Bearer ${held}`;
    if (body) headers["Content-Type"] = "application/json";
    let answer: { status: number; json(): Promise<unknown> };
    try {
      answer = await fetcher(`${root}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      return { ok: false, error: "offline" };
    }
    let read: Record<string, unknown> = {};
    try {
      read = ((await answer.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return { ok: false, error: answer.status >= 500 ? "unavailable" : "failed" };
    }
    if (read.ok === true) {
      const value = { ...read };
      delete value.ok;
      return { ok: true, value: value as T };
    }
    return { ok: false, error: typeof read.error === "string" ? read.error : "failed" };
  }

  return {
    link: (code, label) => call("POST", "vincular", { code, label }),
    situation: () => call("GET", "situacao"),
    start: (batchId) => call("POST", `lotes/${batchId}/iniciar`, {}),
    next: (batchId, claim) => call("POST", `lotes/${batchId}/proximo`, { claim }),
    keep: (batchId, claim) => call("POST", `lotes/${batchId}/manter`, { claim }),
    finish: (batchId, claim, error) => call("POST", `lotes/${batchId}/fim`, { claim, error }),
    plan: (filingId, claim, screen, done, path) =>
      call("POST", `envios/${filingId}/tela`, { claim, screen, done: done ?? [], path: path ?? [] }),
    hold: (filingId, claim) => call("POST", `envios/${filingId}/segurar`, { claim }),
    confirm: (filingId) => call("POST", `envios/${filingId}/confirmar`, {}),
    state: (filingId) => call("POST", `envios/${filingId}/estado`, {}),
    sending: (filingId, claim) => call("POST", `envios/${filingId}/enviando`, { claim }),
    path: (filingId, claim, steps, aiScreens) =>
      call("POST", `envios/${filingId}/caminho`, { claim, steps, aiScreens }),
    result: (filingId, claim, outcome) => call("POST", `envios/${filingId}/resultado`, { claim, ...outcome }),
  };
}
