import type { OneApi } from "@/lib/court-extension/one-api";
import type { ExtensionStarted } from "@/lib/filing-ways/extension-protocol";

/**
 * What ONE's own browser on ONE's server (`worker.ts`) asks of ONE's backend: the functions of the database it calls
 * with the service role (migrations 0263, 0264, 0268) and the vault that opens a lawyer's court login for one batch
 * or one check. The real one is `backend.ts`; the smoke test (`clock/navegador-smoke.mjs`) and the unit tests stand in
 * for it.
 */

export type BrowserSystem = {
  key: string;
  name: string;
  host: string;
  /** Where ONE's browser opens the system; the court sends it on to its sign-in. */
  startPath: string;
  loginKind: "password_app" | "password_email";
};

/** A batch a lawyer approved for ONE's browser, held by it under a number. */
export type ClaimedBatch = {
  batchId: string;
  claim: number;
  orgId: string;
  personId: string;
  system: BrowserSystem;
  /** ONE still learns the system: the first filing waits for the lawyer's word before sending. */
  learning: boolean;
};

/** A login a lawyer just gave ONE, to see the court take it. */
export type LoginCheck = {
  orgId: string;
  connectionId: string;
  system: Pick<BrowserSystem, "key" | "host" | "startPath">;
  login: string;
  senha: string;
};

export type OpenedLogin =
  | { ok: true; connectionId: string; login: string; senha: string }
  | { ok: false; code: string };

/** The court's code the lawyer typed in ONE for a batch: taken once, or none yet, or the batch is no longer this run's. */
export type TakenCode = { kind: "code"; code: string } | { kind: "none" } | { kind: "gone" };

/** What ONE's browser prints of the court's screen: the screen held for the lawyer's word, and the receipt. */
export type PageHooks = {
  screenshot(): Promise<Uint8Array | null>;
  receipt(): Promise<Uint8Array | null>;
};

export type BrowserStarted = ExtensionStarted & {
  /** The map ONE followed while it learned the system, trusted once a filing that followed it is taken by the court. */
  mapId: string | null;
};

export type BrowserBackend = {
  claimCheck(): Promise<LoginCheck | null>;
  checked(check: { orgId: string; connectionId: string }, outcome: "verified" | "refused" | "blocked"): Promise<void>;
  claimBatch(): Promise<ClaimedBatch | null>;
  started(batch: ClaimedBatch): Promise<BrowserStarted | null>;
  openLogin(batch: ClaimedBatch): Promise<OpenedLogin>;
  askCode(batch: ClaimedBatch, kind: "app" | "email"): Promise<boolean>;
  takeCode(batch: ClaimedBatch): Promise<TakenCode>;
  batchStatus(batchId: string): Promise<string | null>;
  touch(batch: ClaimedBatch): Promise<void>;
  finish(batch: ClaimedBatch, error: string | null): Promise<void>;
  /** ONE's calls for the run of a batch, as the shared run of a batch makes them (`runBatch`). */
  api(batch: ClaimedBatch, started: BrowserStarted, hooks: PageHooks): OneApi;
  /** ONE's browser is alive: its mark in the database. */
  beat(mark: { at: string; commit: string; working: string | null }): Promise<void>;
};
