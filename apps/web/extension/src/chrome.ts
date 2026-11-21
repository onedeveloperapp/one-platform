/**
 * The part of Chrome's extension API this extension uses, typed here instead of a dependency: the app's TypeScript
 * checks these files, and nothing of it reaches the app (`chrome` is read from the extension's own global).
 */

export type MessageSender = { tab?: { id?: number; url?: string }; frameId?: number };

export type ChromeTab = { id?: number; url?: string; title?: string; active?: boolean; windowId?: number };

export type ChromeApi = {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        listener: (message: unknown, sender: MessageSender, reply: (answer: unknown) => void) => boolean | void,
      ): void;
    };
  };
  storage: {
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
  tabs: {
    query(filter: { active?: boolean; currentWindow?: boolean; url?: string }): Promise<ChromeTab[]>;
    get(tabId: number): Promise<ChromeTab>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  scripting: {
    executeScript<Args extends unknown[]>(injection: {
      target: { tabId: number; allFrames?: boolean; frameIds?: number[] };
      func: (...args: Args) => unknown;
      args?: Args;
    }): Promise<{ frameId: number; result?: unknown }[]>;
  };
  sidePanel?: {
    setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
  };
};

export const chromeApi = (): ChromeApi => (globalThis as unknown as { chrome: ChromeApi }).chrome;
