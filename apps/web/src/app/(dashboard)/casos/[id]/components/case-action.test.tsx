import { CaseActionProvider, type CaseActions, useCaseAction, useCaseActions } from "./case-action";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";
import { act, cleanup, renderHook } from "@testing-library/react";

// One action of the case from the click to the screen that shows it (the audit of the case's sync, 2026-11-25): the
// card says "saved" as soon as the write answers, and the screen is read again only when the write's own answer did
// not bring it, or when the database already moved past it.

// The router's refresh, as the screen lives it: a drawing that arrives inside the transition that asked for it.
const page = { redraw: () => {} };
const refresh = vi.fn(() => page.redraw());
const snack = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("notistack", () => ({ useSnackbar: () => ({ enqueueSnackbar: snack }) }));

function Page({ children }: { children: ReactNode }) {
  const [, setDrawn] = useState(0);
  page.redraw = () => setDrawn((count) => count + 1);
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      {children}
    </NextIntlClientProvider>
  );
}

type Screen = { drawing: object; stamp: string; database: string | null };

/** The hook on a screen whose drawing, mark and database the test moves by hand. */
function mount(start: Screen = { drawing: {}, stamp: "s1", database: "s1" }) {
  const screen = { ...start };
  const acted = vi.fn();
  const hook = renderHook(
    (props: { drawing: object }) =>
      useCaseActions({
        acted,
        latest: async () => screen.database,
        shows: (mark) => mark === screen.stamp,
        drawing: props.drawing,
        trail: "trilha",
      }),
    { wrapper: Page, initialProps: { drawing: screen.drawing } },
  );
  return {
    ...hook,
    screen,
    acted,
    /** The server hands the screen a new drawing, read with this mark. */
    draw: (stamp: string) => {
      screen.stamp = stamp;
      hook.rerender({ drawing: {} });
    },
  };
}

/** A write that answers when the test lets it. */
function write() {
  const gate: { finish: (ok: boolean) => void } = { finish: () => {} };
  const work = () => new Promise<boolean>((resolve) => (gate.finish = resolve));
  return { work, finish: (ok: boolean) => gate.finish(ok) };
}

/** Lets time pass and what it started settle. */
const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const WORDS = { doing: "enviando o documento", done: "Documento enviado." };

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  snack.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("an action of the case", () => {
  it("says saved as soon as the write answers, and reads nothing again when the answer brought the case", async () => {
    const screen = mount();
    const sent = write();
    let finished: Promise<boolean> = Promise.resolve(false);
    act(() => {
      finished = screen.result.current.run("documents", "upload", WORDS, sent.work);
    });
    expect(screen.result.current.running).toMatchObject({ key: "upload", saved: false });
    expect(screen.result.current.note).toBeNull();

    // The write answers. Its answer carries the case read again, which is drawn a moment later.
    screen.screen.database = "s2";
    sent.finish(true);
    await pass(10);
    // Saved, said at once in the card, while the screen brings itself up to it.
    expect(screen.result.current.note).toMatchObject({ anchor: "case-documents", text: "Documento enviado." });
    expect(screen.result.current.running).toMatchObject({ saved: true });
    expect(screen.result.current.last?.text).toBe("Documento enviado.");
    // Its line is not in front of the person (no card on this page): the same words where they are, at once.
    expect(snack).toHaveBeenCalledTimes(1);
    expect(snack.mock.calls[0]?.[0]).toBe("Documento enviado.");

    // A second goes by before the drawing comes: nothing is read on top of it meanwhile.
    await pass(1_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.result.current.running).not.toBeNull();
    act(() => screen.draw("s2"));
    await pass(100);
    await act(async () => {
      expect(await finished).toBe(true);
    });
    expect(screen.result.current.running).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.acted).toHaveBeenCalledTimes(1);
    // What came of it was said once, never again when the screen showed it.
    expect(snack).toHaveBeenCalledTimes(1);
  });

  it("reads the case again only after a while when the write's answer brought no drawing of it", async () => {
    const screen = mount();
    screen.screen.database = "s2";
    let finished: Promise<boolean> = Promise.resolve(false);
    act(() => {
      finished = screen.result.current.run("documents", "upload", WORDS, async () => true);
    });
    await pass(3_000);
    expect(refresh).not.toHaveBeenCalled();
    await pass(1_500);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await finished).toBe(true);
    });
    expect(screen.result.current.running).toBeNull();
  });

  it("reads the case again when the database is past the drawing: ONE began from what was written", async () => {
    const screen = mount();
    const sent = write();
    let finished: Promise<boolean> = Promise.resolve(false);
    act(() => {
      finished = screen.result.current.run("documents", "upload", WORDS, sent.work);
    });
    // The answer draws the case as written (s2), and ONE has claimed its work since (s3).
    screen.screen.database = "s3";
    sent.finish(true);
    await pass(10);
    act(() => screen.draw("s2"));
    await pass(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await finished;
    });
  });

  it("reads nothing again when the drawing only crossed the pulse on its way", async () => {
    const screen = mount();
    const sent = write();
    let finished: Promise<boolean> = Promise.resolve(false);
    act(() => {
      finished = screen.result.current.run("documents", "upload", WORDS, sent.work);
    });
    // The pulse answers the mark of the write (s2); the drawing, read a moment later, already has ONE's (s3).
    screen.screen.database = "s2";
    sent.finish(true);
    await pass(10);
    screen.screen.database = "s3";
    act(() => screen.draw("s3"));
    await pass(200);
    await act(async () => {
      expect(await finished).toBe(true);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes the drawing as the screen's when the pulse cannot say", async () => {
    const screen = mount({ drawing: {}, stamp: "s1", database: null });
    const sent = write();
    let finished: Promise<boolean> = Promise.resolve(false);
    act(() => {
      finished = screen.result.current.run("documents", "upload", WORDS, sent.work);
    });
    sent.finish(true);
    await pass(10);
    act(() => screen.draw("s2"));
    await pass(100);
    await act(async () => {
      expect(await finished).toBe(true);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says nothing as saved, and reads nothing again, when the write did not work", async () => {
    const screen = mount();
    await act(async () => {
      expect(await screen.result.current.run("documents", "upload", WORDS, async () => false)).toBe(false);
    });
    expect(screen.result.current.note).toBeNull();
    expect(screen.result.current.last).toBeNull();
    expect(screen.result.current.running).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("gives an action with no words of its own a line all the same", async () => {
    const screen = mount();
    await act(async () => {
      await screen.result.current.run("rules", "plan", { doing: "criando os processos" }, async () => true);
    });
    expect(screen.result.current.note).toMatchObject({ anchor: "case-rules", text: "Feito." });
    // What it wrote changed nothing the screen follows: the screen is already current, and nothing is read again.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the line of what came of it while the screen comes, and for a while after", async () => {
    const screen = mount();
    screen.screen.database = "s2";
    act(() => {
      void screen.result.current.run("documents", "upload", WORDS, async () => true);
    });
    await pass(3_900);
    expect(screen.result.current.note?.text).toBe("Documento enviado.");
    await pass(600);
    expect(screen.result.current.running).toBeNull();
    await pass(9_000);
    expect(screen.result.current.note?.text).toBe("Documento enviado.");
    await pass(1_500);
    expect(screen.result.current.note).toBeNull();
  });
});

describe("a write a card made on its own", () => {
  it("says the change is saved in its card at once, and reads nothing again when its answer brought the case", async () => {
    const screen = mount();
    screen.screen.database = "s2";
    act(() => screen.result.current.reload("case-fees"));
    expect(screen.result.current.note).toMatchObject({ anchor: "case-fees", text: "Alteração salva." });
    expect(screen.result.current.running).toMatchObject({ key: "reload", saved: true });
    expect(snack.mock.calls[0]?.[0]).toBe("Alteração salva.");
    await pass(300);
    act(() => screen.draw("s2"));
    await pass(100);
    expect(screen.result.current.running).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reads the case again when no drawing came with its answer", async () => {
    const screen = mount();
    screen.screen.database = "s2";
    act(() => screen.result.current.reload("case-trip"));
    await pass(4_500);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.result.current.running).toBeNull();
  });

  it("claims nothing as saved when the card reads the case again after a refusal, and reads it at once", async () => {
    const screen = mount();
    act(() => screen.result.current.reload("case-drafts", false));
    expect(screen.result.current.note).toBeNull();
    expect(screen.result.current.last).toBeNull();
    expect(snack).not.toHaveBeenCalled();
    expect(screen.result.current.running).toMatchObject({ key: "reload", saved: false });
    await pass(50);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.result.current.running).toBeNull();
  });
});

describe("a change somebody else made", () => {
  it("is read with nothing locked", async () => {
    const screen = mount();
    let read: Promise<boolean> = Promise.resolve(false);
    act(() => {
      read = screen.result.current.follow();
    });
    expect(screen.result.current.syncing).toBe(true);
    await pass(50);
    expect(await read).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.result.current.running).toBeNull();
    expect(screen.result.current.syncing).toBe(false);
  });

  it("is never read on top of an action, and says it read nothing, so it is asked for again", async () => {
    const screen = mount();
    const sent = write();
    act(() => {
      void screen.result.current.run("documents", "upload", WORDS, sent.work);
    });
    let read: Promise<boolean> = Promise.resolve(true);
    act(() => {
      read = screen.result.current.follow();
    });
    await pass(10);
    expect(await read).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    sent.finish(false);
    await pass(10);
  });
});

describe("what a card's button says of its action", () => {
  const actionsOf = (running: CaseActions["running"]): CaseActions => ({
    running,
    syncing: false,
    note: null,
    last: null,
    run: async () => true,
    reload: () => {},
    follow: async () => true,
  });
  const said = (running: CaseActions["running"]) => {
    const { result } = renderHook(() => useCaseAction("documents"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
          <CaseActionProvider value={actionsOf(running)}>{children}</CaseActionProvider>
        </NextIntlClientProvider>
      ),
    });
    return result.current;
  };

  it("says its verb while it is written, that it is done once the write answered, and its name otherwise", () => {
    const idle = said(null);
    expect(idle.label("upload", "Enviando", "Enviar arquivo")).toBe("Enviar arquivo");
    expect(idle.pending("upload")).toBe(false);

    const writing = said({ key: "upload", section: "documents", doing: "enviando", saved: false });
    expect(writing.label("upload", "Enviando", "Enviar arquivo")).toBe("Enviando");
    expect(writing.pending("upload")).toBe(true);
    expect(writing.done("upload")).toBe(false);

    const done = said({ key: "upload", section: "documents", doing: "enviando", saved: true });
    expect(done.label("upload", "Enviando", "Enviar arquivo")).toBe("Feito");
    // Its button still waits until the screen shows what came of it.
    expect(done.pending("upload")).toBe(true);
    expect(done.done("upload")).toBe(true);
    expect(done.busy).toBe(true);
  });

  it("says nothing of an action of another card or of another key", () => {
    const other = said({ key: "plan", section: "rules", doing: "criando os processos", saved: true });
    expect(other.label("upload", "Enviando", "Enviar arquivo")).toBe("Enviar arquivo");
    expect(other.busy).toBe(true);
  });
});
