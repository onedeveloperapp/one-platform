/**
 * The loading/success/empty/error state of anything a screen fetches.
 *
 * Moved out of the inherited clinical package (2026-10-01). The default error
 * keeps the same shape, with a free-form code, so `empty` and `error` stay two
 * different states: an error must never be rendered as an empty screen.
 */

export interface RemoteError {
  code: string;
  retryable: boolean;
  /** Safe structured context only; never put user content here. */
  details?: Readonly<Record<string, unknown>>;
}

export type RemoteState<T, E = RemoteError> =
  | { status: "idle" }
  | { status: "loading"; previous?: T }
  | { status: "success"; data: T }
  | { status: "empty" }
  | { status: "error"; error: E; previous?: T };

export const remoteIdle = <T, E = RemoteError>(): RemoteState<T, E> => ({ status: "idle" });
export const remoteLoading = <T, E = RemoteError>(previous?: T): RemoteState<T, E> => ({
  status: "loading",
  ...(previous === undefined ? {} : { previous }),
});
export const remoteSuccess = <T, E = RemoteError>(data: T): RemoteState<T, E> => ({ status: "success", data });
export const remoteEmpty = <T, E = RemoteError>(): RemoteState<T, E> => ({ status: "empty" });
export const remoteError = <T, E = RemoteError>(error: E, previous?: T): RemoteState<T, E> => ({
  status: "error",
  error,
  ...(previous === undefined ? {} : { previous }),
});
