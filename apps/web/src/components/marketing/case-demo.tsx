"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Card, CardContent, Typography } from "@mui/material";

import AutoplayButton from "@/components/marketing/autoplay-button";
import { prefersReducedMotion, watchEntry } from "@/components/marketing/motion";
import ActivityCards, { type ActivityItem } from "@/components/product/activity-cards";
import MessageBubble from "@/components/product/message-bubble";
import ProgressSteps, { type ProgressStep, type ProgressStepState } from "@/components/product/progress-steps";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import { cn } from "@/lib/utils";

/** The scene's moments: ONE checks the paper, the paper is accepted, the client is told. */
type Phase = "checking" | "accepted" | "told";

/** How long each moment stays before the next, in milliseconds (the told one is the result, held for reading). */
const HOLD: Record<Phase, number> = { checking: 3000, accepted: 1300, told: 2800 };
const NEXT: Record<Phase, Phase> = { told: "checking", checking: "accepted", accepted: "told" };
/** How many times the scene plays before it rests on its result: nothing on the page moves forever. */
const PASSES = 4;
/** How a part moves: the arrival curve of the demonstration guide; nothing with less motion. */
const MOVE = "motion-safe:transition-[opacity,transform,max-height] motion-safe:ease-[cubic-bezier(0.25,0.8,0.25,1)]";
/**
 * A part that arrives waits for the one it takes the place of to leave, and comes at the guide's length; a part that
 * leaves goes quickly. Two parts in one place are never seen over each other.
 */
const ARRIVES = "motion-safe:duration-700 motion-safe:delay-300 translate-y-0 opacity-100";
const LEAVES = "motion-safe:duration-300 motion-safe:delay-0 pointer-events-none translate-y-2 opacity-0";

export type CaseDemoWords = {
  /** What the scene shows, said whole to a screen reader (the scene itself is a picture). */
  label: string;
  /** The tag beside the scene: the data are invented. */
  sample: string;
  pauseLabel: string;
  playLabel: string;
  /** The top of a case, in the product's own words. */
  title: string;
  steps: ProgressStep[];
  stateWords: Record<ProgressStepState, string>;
  workingTitle: string;
  workingLine: string;
  workingSince: string;
  recentTitle: string;
  recent: ActivityItem;
  /** The conversation on the firm's WhatsApp, as the firm reads it in ONE. */
  client: { sideLabel: string; kind: string; open: string; time: string; by: string };
  reply: { sideLabel: string; text: string; time: string; by: string; status: string };
};

/**
 * The product working, at the top of the home: the top of a case in ONE and the firm's conversation with the client,
 * drawn with the product's own components and fixed data (the demonstration guide of the sales-page skill, its first
 * choice). One action: ONE checks the identity a client sent on WhatsApp. Its result stays on the screen: the paper
 * among what ONE did a moment ago, and ONE's words to the client in the conversation, which are the words ONE sends
 * for a paper it accepted (`fileLine` of lib/conversations/agent.ts).
 *
 * The scene opens on its result (the cover a photo of the page, a phone that asks for less motion and a visitor who
 * paused it see), plays only while it is on screen, four times, and then rests on the result; the button beside its
 * tag pauses it and plays it again. Inside, everything is inert and outside the reading of a screen reader, which
 * reads the scene's name; no heading of the product's cards enters the page's outline.
 */
export default function CaseDemo({ words }: { words: CaseDemoWords }) {
  const root = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("told");
  const [running, setRunning] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const passes = useRef(0);

  // Plays once the scene reaches the screen, never for a visitor who asked for less motion.
  useEffect(() => {
    const element = root.current;
    if (!element || prefersReducedMotion()) return;
    const stop = watchEntry(element, {
      onPlaced: (position) => {
        if (position === "visible") setRunning(true);
      },
      onEnter: () => setRunning(true),
    });
    // Stops while the scene is off the screen, and goes on when it comes back.
    const seen = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.25 });
    seen.observe(element);
    return () => {
      stop();
      seen.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!running || !onScreen) return;
    const timer = window.setTimeout(() => {
      const next = NEXT[phase];
      if (next === "told") {
        passes.current += 1;
        if (passes.current >= PASSES) setRunning(false);
      }
      setPhase(next);
    }, HOLD[phase]);
    return () => window.clearTimeout(timer);
  }, [running, onScreen, phase]);

  const toggle = useCallback(() => {
    if (running) {
      // Paused, the scene shows its result, still.
      setRunning(false);
      setPhase("told");
      return;
    }
    passes.current = 0;
    setRunning(true);
  }, [running]);

  // A part that arrives rises a little as it fades in; a part that leaves fades as it goes.
  const shown = (on: boolean) => cn(MOVE, on ? ARRIVES : LEAVES);
  // From a laptop on, the conversation floats over the panel, and the reply opens its own room as it comes and gives
  // it back as it goes. On a phone the conversation is in the page's flow, so its room stays: the scene never changes
  // height and never moves what comes after it.
  const opens = (on: boolean) =>
    cn(MOVE, "md:overflow-hidden", on ? cn(ARRIVES, "md:max-h-48") : cn(LEAVES, "md:max-h-0"));

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div ref={root} data-demo="caso" role="img" aria-label={words.label} className="relative text-left">
        <div inert className="flex flex-col gap-4 md:block md:pb-8">
          {/* The main object: the top of a case, cut to the panel where the scene happens. */}
          <Card className="md:w-4/5">
            <CardContent className="flex flex-col gap-5">
              <Typography variant="h5" component="div" className="mb-0">
                {words.title}
              </Typography>
              {/* The way of the case runs past the panel's edge: what is cut is the steps still to come. */}
              <div className="hidden overflow-hidden md:block">
                <div style={{ width: "150%" }}>
                  <ProgressSteps
                    steps={words.steps}
                    label={words.title}
                    stateWords={words.stateWords}
                    working={false}
                  />
                </div>
              </div>
              {/* The two moments of the case share one place, so nothing under them jumps; never under the conversation. */}
              <div className="md:pr-28">
                <div className="grid">
                  <div className={cn("col-start-1 row-start-1 flex flex-col gap-2", shown(phase === "checking"))}>
                    <Typography variant="subtitle2" component="div" className="mb-0">
                      {words.workingTitle}
                    </Typography>
                    <StateLine tone="waiting" status={words.workingSince}>
                      {words.workingLine}
                    </StateLine>
                  </div>
                  <div className={cn("col-start-1 row-start-1", shown(phase !== "checking"))}>
                    <ActivityCards
                      id="case-demo-recent"
                      titleAs="div"
                      title={words.recentTitle}
                      items={[words.recent]}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* The smaller object: the conversation, over the panel's edge, never over its words. */}
          <Card className="md:absolute md:right-0 md:bottom-0 md:w-80">
            <ul className="m-0 flex list-none flex-col gap-2 p-3">
              <MessageBubble
                side="in"
                sideLabel={words.client.sideLabel}
                meta={
                  <>
                    <span>{words.client.time}</span>
                    <span>{words.client.by}</span>
                  </>
                }
              >
                <em>{words.client.kind}</em>
                <div className="mt-2">
                  <Button size="small" variant="outlined" color="grey" tabIndex={-1}>
                    {words.client.open}
                  </Button>
                </div>
              </MessageBubble>
              <MessageBubble
                side="out"
                sideLabel={words.reply.sideLabel}
                className={opens(phase === "told")}
                meta={
                  <>
                    <span>{words.reply.time}</span>
                    <span>{words.reply.by}</span>
                    <StatusChip label={words.reply.status} tone="neutral" />
                  </>
                }
              >
                {words.reply.text}
              </MessageBubble>
            </ul>
          </Card>
        </div>
      </div>
      <div className="flex items-center justify-center gap-1">
        <figcaption className="text-text-secondary text-xs">{words.sample}</figcaption>
        <AutoplayButton running={running} onToggle={toggle} pauseLabel={words.pauseLabel} playLabel={words.playLabel} />
      </div>
    </figure>
  );
}
