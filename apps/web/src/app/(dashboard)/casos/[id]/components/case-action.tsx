"use client";

import { goToSection, showTrail } from "./journey-card";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@mui/material";

import { SECTION_ANCHOR } from "@/lib/cases/now";
import type { CaseSection } from "@/lib/cases/sections";

/** How long a refresh of the screen is waited for before the case's actions are let go anyway. */
const LAND_LIMIT_MS = 20_000;
/** How long the line that says what came of an action stays in its card. */
const NOTE_MS = 10_000;

/** What a card says of one action, in the words of the screen. */
export type CaseActionWords = {
  /** What happens while it runs, said lower case after "Uma ação em andamento:": "criando os processos". */
  doing: string;
  /** What came of it, said in its card for a while with the time: "Processos criados". */
  done?: string;
  /** Said when it did not work and its card is out of sight: "Os processos não foram criados". */
  failed?: string;
  /** Another card the result changed: brought to the person with "Ver". */
  target?: CaseSection;
};

/** The person's action under way: from the click until the screen shows what came of it. */
export type RunningAction = { key: string; section: CaseSection | null; doing: string };

/** What came of the latest action, said in its card for a while. */
export type ActionNote = { section: CaseSection; text: string; at: number };

export type CaseActions = {
  running: RunningAction | null;
  /** The screen reads the case again for a change somebody else made (ONE, the client): nothing is locked. */
  syncing: boolean;
  note: ActionNote | null;
  /**
   * Runs one action of a card: refused while another runs; while it runs, every other control of the case waits;
   * once it worked, the screen is read again and the controls come back only when the result shows. `work` answers
   * whether it worked (the card says why not, as before).
   */
  run: (section: CaseSection, key: string, words: CaseActionWords, work: () => Promise<boolean>) => Promise<boolean>;
  /** A write a card made on its own (a dialog saved): the screen is read again, the controls waiting meanwhile. */
  reload: () => void;
  /** Something changed outside the screen: it is read again, saying so, with nothing locked. */
  follow: () => void;
};

const CaseActionContext = createContext<CaseActions | null>(null);

/** What an action does, as its button says it while it runs: "criando os processos" is "Criando os processos". */
export const sentence = (phrase: string) => phrase.charAt(0).toLocaleUpperCase("pt-BR") + phrase.slice(1);

export const CaseActionProvider = CaseActionContext.Provider;

/** Whether the card is in front of the person now. */
function inSight(section: CaseSection): boolean {
  const heading = document.getElementById(SECTION_ANCHOR[section]);
  const card = heading?.closest("section") ?? heading;
  if (!card) return false;
  const box = card.getBoundingClientRect();
  return box.bottom > 0 && box.top < window.innerHeight;
}

/** A person typing in a field: a write that comes by itself waits for nothing rather than take the field away. */
function typing(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))
  );
}

/**
 * One action at a time on a case (the owner's canvas, 2026-11-10): the state of the screen's actions, kept by the
 * case screen and handed to its cards. A refresh is the router's, inside a transition, so the screen knows when what
 * it read is the one on screen: the controls come back, the top and the cards change at the same moment, and the
 * line of what came of it shows, never before. When what the person did moved the case's trail (`trail`: its steps,
 * who has it and the lines of what happens now, as the screen read them), the screen goes to the trail, which marks
 * itself, and what came of it in the card is one "Ver" away (the owner, 2026-11-11).
 */
export function useCaseActions({ acted, trail }: { acted: () => void; trail: string }): CaseActions {
  const router = useRouter();
  const t = useTranslations("product");
  const { enqueueSnackbar } = useSnackbar();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<RunningAction | null>(null);
  const runningRef = useRef<RunningAction | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<ActionNote | null>(null);
  const waiters = useRef<(() => void)[]>([]);
  const sawPending = useRef(false);
  // The trail as the screen shows it. Kept before the refresh's own effect below, so that one finds it already as
  // the screen read it again in the same commit.
  const trailRef = useRef(trail);
  useEffect(() => {
    trailRef.current = trail;
  }, [trail]);

  // A refresh asked inside the transition shows once the transition ends: then each one waiting for it goes on.
  useEffect(() => {
    if (pending) {
      sawPending.current = true;
      return;
    }
    if (!sawPending.current) return;
    sawPending.current = false;
    const list = waiters.current;
    waiters.current = [];
    for (const go of list) go();
  }, [pending]);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  /** Reads the screen again and answers once what it read is on screen (or after a while, if it never comes). */
  const land = useCallback(
    () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const go = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        waiters.current.push(go);
        window.setTimeout(go, LAND_LIMIT_MS);
        startTransition(() => router.refresh());
      }),
    [router],
  );

  const begin = useCallback((entry: RunningAction) => {
    runningRef.current = entry;
    setRunning(entry);
  }, []);

  const end = useCallback((returnTo: Element | null, stayInView = false) => {
    runningRef.current = null;
    setRunning(null);
    // The disabled controls let go of the focus: it goes back to where the person was, when that is still there,
    // without taking the screen back from the trail it just went to.
    window.requestAnimationFrame(() => {
      if (
        returnTo instanceof HTMLElement &&
        returnTo.isConnected &&
        (document.activeElement === null || document.activeElement === document.body)
      ) {
        returnTo.focus({ preventScroll: stayInView });
      }
    });
  }, []);

  const run = useCallback<CaseActions["run"]>(
    async (section, key, words, work) => {
      if (runningRef.current) return false;
      const returnTo = document.activeElement;
      const before = trailRef.current;
      begin({ key, section, doing: words.doing });
      setNote(null);
      let ok = false;
      try {
        ok = await work();
      } catch {
        ok = false;
      }
      if (!ok) {
        end(returnTo);
        if (words.failed && !inSight(section)) {
          enqueueSnackbar(words.failed, {
            variant: "error",
            action: (snack) => (
              <Button color="inherit" size="small" key={String(snack)} onClick={() => goToSection(section)}>
                {t("case-action-see")}
              </Button>
            ),
          });
        }
        return false;
      }
      acted();
      await land();
      const at = Date.now();
      if (words.done) setNote({ section, text: words.done, at });
      // What the person did moved the case: the screen goes to the trail, never from under a field being typed in.
      const toTrail = trailRef.current !== before && !typing() && showTrail();
      // What came of it is said where the person acted; another card it changed, or a card out of sight (the screen
      // went to the trail), is one "Ver" away.
      const lead = words.target ?? (toTrail || !inSight(section) ? section : null);
      if (lead && words.done) {
        enqueueSnackbar(words.done, {
          variant: "success",
          action: (snack) => (
            <Button color="inherit" size="small" key={String(snack)} onClick={() => goToSection(lead)}>
              {t("case-action-see")}
            </Button>
          ),
        });
      }
      end(returnTo, toTrail);
      return true;
    },
    [acted, begin, end, enqueueSnackbar, land, t],
  );

  const reload = useCallback(() => {
    // An action under way reads the screen again itself, once it ends.
    if (runningRef.current) return;
    acted();
    if (typing()) {
      setSyncing(true);
      void land().then(() => setSyncing(false));
      return;
    }
    const returnTo = document.activeElement;
    const before = trailRef.current;
    begin({ key: "reload", section: null, doing: t("case-action-reloading") });
    void land().then(() => end(returnTo, trailRef.current !== before && !typing() && showTrail()));
  }, [acted, begin, end, land, t]);

  const follow = useCallback(() => {
    setSyncing(true);
    void land().then(() => setSyncing(false));
  }, [land]);

  return useMemo(
    () => ({ running, syncing, note, run, reload, follow }),
    [running, syncing, note, run, reload, follow],
  );
}

/**
 * A card's way to its actions: `run` one (refused while another runs), whether one with this key is under way (its
 * button turns and says what it does until the screen shows the result), and whether the case is busy with any.
 */
export function useCaseAction(section: CaseSection) {
  const actions = useContext(CaseActionContext);
  const running = actions?.running ?? null;
  const run = useCallback(
    (key: string, words: CaseActionWords, work: () => Promise<boolean>) =>
      actions ? actions.run(section, key, words, work) : work(),
    [actions, section],
  );
  return {
    run,
    /** The action of this card with this key is under way. */
    pending: (key: string) => running !== null && running.section === section && running.key === key,
    /** Any action of the case is under way. */
    busy: running !== null,
  };
}
