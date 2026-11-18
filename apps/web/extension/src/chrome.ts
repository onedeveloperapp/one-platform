/**
 * The part of Chrome's extension API this extension uses, typed here instead of a dependency: the app's TypeScript
 * checks these files, and nothing of it reaches the app (`chrome` is read from the extension's own global).
 */

export type MessageSender = { tab?: { id?: number; url?: string }; frameId?: number };

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
  };
  tabs: {
    query(filter: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<{ id?: number; url?: string; title?: string }[]>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number; allFrames: boolean };
      func: () => unknown;
    }): Promise<{ frameId: number; result?: unknown }[]>;
  };
};

export const chromeApi = (): ChromeApi => (globalThis as unknown as { chrome: ChromeApi }).chrome;
