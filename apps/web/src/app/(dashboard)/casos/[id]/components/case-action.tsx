"use client";

import { goToSection, showTrail, TRAIL_TITLE_ID } from "./journey-card";
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
/**
 * How long the drawing a server action brings with its own answer is waited for before the screen is read again.
 * Every write of the case revalidates the case's path, so its answer carries the case read again; the router answers
 * the action as soon as the write is done (the first rows of its answer) and draws the case when the rest of that
 * answer has streamed in, a second or so later. Reading the screen once more on top of it doubled every reading (the
 * audit of the case's sync, 2026-11-25). The time is only a ceiling: the wait ends the moment the drawing shows.
 */
const OWN_DRAWING_MS = 4_000;
/** How long the pulse is given to answer after a write, before the screen goes on without it. */
const PULSE_ANSWER_MS = 2_500;

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

/**
 * The person's action under way: from the click until the screen shows what came of it. `saved` once the write was
 * answered as done: the screen then only brings itself up to it, and says so ("Feito. Atualizando a tela").
 */
export type RunningAction = { key: string; section: CaseSection | null; doing: string; saved: boolean };

/** What came of the latest action, said in its card (by the card's id) for a while. */
export type ActionNote = { anchor: string; section: CaseSection | null; text: string; at: number };

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
  /**
   * A write a card made on its own (a dialog saved): the screen brings itself up to it, the controls waiting
   * meanwhile, and the card (`anchor`, its id) says "Alteração salva" at once. `saved` false when the card reads the
   * case again after a refusal, or with no word of whether it wrote: then nothing is said as saved.
   */
  reload: (anchor?: string | null, saved?: boolean) => void;
  /**
   * Something changed outside the screen: it is read again, saying so, with nothing locked. Answers false when it
   * read nothing, an action under way bringing the screen up by itself: the change is then still to be asked for.
   */
  follow: () => Promise<boolean>;
  /** What the person did last that was saved, kept until their next action: the notice of ONE's work says it first. */
  last: { text: string; at: number } | null;
};

const CaseActionContext = createContext<CaseActions | null>(null);

/** What an action does, as its button says it while it runs: "criando os processos" is "Criando os processos". */
export const sentence = (phrase: string) => phrase.charAt(0).toLocaleUpperCase("pt-BR") + phrase.slice(1);

export const CaseActionProvider = CaseActionContext.Provider;

/**
 * Whether the line a card says "saved" in is in front of the person now: it is written under the card's head, so a
 * button far down a long card, or a card of another tab, leaves it out of sight.
 */
function noteInSight(anchor: string | null): boolean {
  const heading = document.getElementById(anchor ?? TRAIL_TITLE_ID);
  if (!heading) return false;
  const box = heading.getBoundingClientRect();
  // A card of a tab that is not open has no box at all; a card that is closed keeps its line folded away.
  if (box.width === 0 && box.height === 0) return false;
  if (heading.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded") === "false") return false;
  return box.bottom > 0 && box.top < window.innerHeight;
}

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
 * case screen and handed to its cards. The controls come back only when the screen shows what the action wrote, the
 * top and the cards changing at the same moment. When what the person did moved the case's trail (`trail`: its steps,
 * who has it and the lines of what happens now, as the screen read them), the screen goes to the trail, which marks
 * itself, and what came of it in the card is one "Ver" away (the owner, 2026-11-11).
 *
 * Since the audit of the case's sync (the owner, 2026-11-25: "em dúvida se o que ele acabou de fazer está realmente
 * salvo"), an action has two moments the screen says apart. As soon as the write answers, its card says what came of
 * it, with the time, its button says "Feito" and the top says "Feito. Atualizando a tela" ("Salvo" for a card's own
 * save), with a toast when the card's line is out of sight: nobody waits for a reading of the whole case to know
 * their act was kept. Then the screen brings itself up to it (`settle`): every write of the case revalidates the
 * case's path, so its answer carries the case read again, drawn a moment later; that drawing is waited for, and the
 * screen is read again only when it never came, or when the database really moved past it (ONE began from what was
 * written). Before, every action read the case twice, and said nothing until the second reading landed.
 */
export function useCaseActions({
  acted,
  latest,
  shows,
  drawing,
  trail,
}: {
  acted: () => void;
  /** The mark the database has now (`useLiveRead`); null when it could not be read. */
  latest: () => Promise<string | null>;
  /** Whether the screen was drawn with a mark. */
  shows: (stamp: string) => boolean;
  /** What the server handed the screen: a new object with every drawing of it. */
  drawing: unknown;
  trail: string;
}): CaseActions {
  const router = useRouter();
  const t = useTranslations("product");
  const { enqueueSnackbar } = useSnackbar();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<RunningAction | null>(null);
  const runningRef = useRef<RunningAction | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<ActionNote | null>(null);
  const [last, setLast] = useState<{ text: string; at: number } | null>(null);
  const waiters = useRef<(() => void)[]>([]);
  // How many drawings of the case the screen has shown: one more with each reading the server hands it.
  const drawings = useRef(0);
  useEffect(() => {
    drawings.current += 1;
  }, [drawing]);
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

  // The line of what came of an action stays while the action still brings the screen up to it, and for a while
  // after: said at the moment the write answers, it must not be gone before the person can look at it.
  useEffect(() => {
    if (!note || running) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note, running]);

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

  /** The mark the database has now, or null when the pulse cannot say in time. */
  const markNow = useCallback(
    () =>
      Promise.race([
        latest().catch(() => null),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), PULSE_ANSWER_MS)),
      ]),
    [latest],
  );

  /**
   * Brings the screen up to what the person just wrote, reading it again only when it has to. The write's own answer
   * carries the case read again, drawn a moment after the answer (`OWN_DRAWING_MS`): it is waited for, and the wait
   * ends as soon as the screen shows the mark the database has. The screen is read again only when that drawing
   * never comes, or when it came older than the database (ONE began from what was written in between). `since` is
   * how many drawings the screen had shown when the write answered. A reading asked after a refusal (`wrote` false)
   * waits for nothing: no drawing comes with a write that was not made.
   */
  const settle = useCallback(
    async (since: number, wrote: boolean) => {
      if (!wrote) return land();
      const mark = await markNow();
      const until = Date.now() + OWN_DRAWING_MS;
      for (;;) {
        if (mark !== null && shows(mark)) return;
        if (drawings.current !== since) {
          // The drawing came. With no pulse to compare, it is the screen's. One that does not show the mark may have
          // crossed the pulse on its way: asked once more, and read again only when the database is really past it.
          if (mark === null) return;
          const again = await markNow();
          if (again === null || shows(again)) return;
          break;
        }
        if (Date.now() >= until) break;
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      }
      await land();
    },
    [land, markNow, shows],
  );

  const begin = useCallback((entry: RunningAction) => {
    runningRef.current = entry;
    setRunning(entry);
  }, []);

  /** The write was answered as done: the action only waits for the screen now. */
  const saved = useCallback(() => {
    if (!runningRef.current) return;
    const entry = { ...runningRef.current, saved: true };
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
      begin({ key, section, doing: words.doing, saved: false });
      setNote(null);
      setLast(null);
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
      // Saved: said at once where the person acted, before the screen brings itself up to it, so nobody wonders
      // whether what they did was kept while the case is read again. The drawings are counted from here: the one the
      // write's own answer brings is the next.
      const since = drawings.current;
      const at = Date.now();
      const done = words.done ?? t("case-action-done");
      const anchor = SECTION_ANCHOR[section];
      setNote({ anchor, section, text: done, at });
      setLast({ text: done, at });
      const see = (lead: CaseSection) => {
        enqueueSnackbar(done, {
          variant: "success",
          action: (snack) => (
            <Button color="inherit" size="small" key={String(snack)} onClick={() => goToSection(lead)}>
              {t("case-action-see")}
            </Button>
          ),
        });
      };
      // The card's line out of sight (a button far down a long card): the same words where the person is, now.
      const told = !noteInSight(anchor);
      if (told) see(section);
      saved();
      acted();
      await settle(since, true);
      // What the person did moved the case: the screen goes to the trail, never from under a field being typed in.
      const toTrail = trailRef.current !== before && !typing() && showTrail();
      // What came of it is said where the person acted; another card it changed, or a card out of sight (the screen
      // went to the trail), is one "Ver" away, unless that was already said.
      const lead = words.target ?? (toTrail || !inSight(section) ? section : null);
      if (lead && !(told && lead === section)) see(lead);
      end(returnTo, toTrail);
      return true;
    },
    [acted, begin, end, enqueueSnackbar, saved, settle, t],
  );

  const reload = useCallback<CaseActions["reload"]>(
    (anchor = null, wrote = true) => {
      // An action under way reads the screen again itself, once it ends.
      if (runningRef.current) return;
      const since = drawings.current;
      acted();
      if (wrote) {
        const at = Date.now();
        const text = t("case-action-saved-note");
        if (anchor) setNote({ anchor, section: null, text, at });
        setLast({ text, at });
        // No card to say it in (a write of the top), or its line out of sight: said where the person is.
        if (!noteInSight(anchor)) enqueueSnackbar(text, { variant: "success" });
      }
      if (typing()) {
        setSyncing(true);
        void settle(since, wrote).then(() => setSyncing(false));
        return;
      }
      const returnTo = document.activeElement;
      const before = trailRef.current;
      begin({ key: "reload", section: null, doing: t("case-action-reloading"), saved: wrote });
      void settle(since, wrote).then(() => end(returnTo, trailRef.current !== before && !typing() && showTrail()));
    },
    [acted, begin, end, enqueueSnackbar, settle, t],
  );

  const follow = useCallback(async () => {
    // An action under way brings the screen up to the database itself, once it ends: nothing is read here, and the
    // change is still to be asked for.
    if (runningRef.current) return false;
    setSyncing(true);
    await land();
    setSyncing(false);
    return true;
  }, [land]);

  return useMemo(
    () => ({ running, syncing, note, last, run, reload, follow }),
    [running, syncing, note, last, run, reload, follow],
  );
}

/**
 * A card's way to its actions: `run` one (refused while another runs), whether one with this key is under way (its
 * button turns and says what it does until the screen shows the result), and whether the case is busy with any.
 */
export function useCaseAction(section: CaseSection) {
  const actions = useContext(CaseActionContext);
  const t = useTranslations("product");
  const doneWord = t("case-action-button-done");
  const running = actions?.running ?? null;
  const run = useCallback(
    (key: string, words: CaseActionWords, work: () => Promise<boolean>) =>
      actions ? actions.run(section, key, words, work) : work(),
    [actions, section],
  );
  const mine = (key: string) => running !== null && running.section === section && running.key === key;
  return {
    run,
    /** The action of this card with this key is under way: from the click until the screen shows what came of it. */
    pending: mine,
    /** Its write was answered as done, and the screen brings itself up to it. */
    done: (key: string) => mine(key) && running?.saved === true,
    /**
     * What the action's button says: `doing` while it is written, "Feito" once the write answered (the screen still
     * brings itself up to it, and the button still waits), `idle` otherwise. A button that goes on saying its verb
     * after the write was kept is where the doubt the owner pointed at begins (whether the act was really saved).
     */
    label: (key: string, doing: string, idle: string) => (mine(key) ? (running?.saved ? doneWord : doing) : idle),
    /** Any action of the case is under way. */
    busy: running !== null,
  };
}
