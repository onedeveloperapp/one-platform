"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import type { TileTone } from "@/components/product/tile-tone";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import NiCheck from "@/icons/nexture/ni-check";
import { cn } from "@/lib/utils";

export type WizardStep = {
  title: string;
  /**
   * The step's short name in the list of steps ("O escritório"). When every step has one, the list is drawn beside
   * the card on a wide screen and the next step is named over it on a narrow one: the person sees the whole path and
   * where they are, never only "Passo 6 de 10" (the owner, 2026-11-24).
   */
  label?: string;
  /** What the step asks is in place: the list marks it with a check. */
  done?: boolean;
  /**
   * What the step saves when the person leaves it forward without its primary (a later step chosen in the list, or
   * the setup set aside): what is typed and complete. A decision the primary names ("Aprovar e continuar") is never
   * taken here. Resolve false to stay, the step saying why. Absent: nothing to save, the step just closes.
   */
  onLeave?: () => Promise<boolean> | boolean;
  /** Optional one-line reassurance under the title (progressive disclosure). */
  hint?: string;
  content: React.ReactNode;
  /** Block "next" until the step is valid. Default: true. */
  canAdvance?: boolean;
  /**
   * The step's OWN action, run by the primary button — so a step never shows
   * its action AND a separate "Continuar" (two buttons for one decision, one of
   * them disabled until the other is pressed). Resolve true to move on, false
   * to stay; the step says why. Absent: the button just advances.
   */
  onPrimary?: () => Promise<boolean> | boolean;
  /**
   * Submit this <form> instead. The primary button becomes its submit button
   * (`form={id}`), so validation, Enter-to-submit and field errors stay the
   * form's own; the form's success handler is what moves the flow on.
   */
  primaryFormId?: string;
  /** Label for the primary button here. Defaults to "Continuar"/"Concluir". */
  primaryLabel?: string;
  /**
   * The step moves on by itself when its work completes (e.g. a recording
   * finishing processing), so a primary button would only duplicate that.
   */
  hidePrimary?: boolean;
  /** A second way through beside the primary, e.g. "Agora não". */
  secondary?: { label: string; onClick: () => void };
  /** The step's action is running: the primary shows it and cannot be pressed twice. */
  busy?: boolean;
  /**
   * What the step before it did cannot be walked back into (a spreadsheet was
   * brought, a payment was made): the step shows no "Voltar", so the button
   * never promises to undo what only its own action can.
   */
  noBack?: boolean;
};

// The rail in a tone, the done steps full and the current one lighter: whole class names, for Tailwind to see them.
const RAIL: Record<TileTone, { done: string; current: string }> = {
  primary: { done: "bg-primary", current: "bg-primary/60" },
  secondary: { done: "bg-secondary", current: "bg-secondary/60" },
  "accent-1": { done: "bg-accent-1", current: "bg-accent-1/60" },
  "accent-2": { done: "bg-accent-2", current: "bg-accent-2/60" },
  "accent-3": { done: "bg-accent-3", current: "bg-accent-3/60" },
  "accent-4": { done: "bg-accent-4", current: "bg-accent-4/60" },
};

/**
 * Multi-step setup shell (progressive disclosure): one decision per screen
 * with a visible progress rail, so a long setup never feels long. Splitting
 * a form across steps can lift conversion (House: +15%) — friction removed
 * in one place, added in another. The caller owns each step's content and
 * validity; the shell owns navigation, the rail and completion.
 */
export default function SetupWizard({
  steps,
  onComplete,
  completeLabel,
  className,
  initialIndex = 0,
  index: controlledIndex,
  onIndexChange,
  tone = "primary",
}: {
  steps: WizardStep[];
  onComplete: () => void;
  /** Defaults to the translated "Finish". */
  completeLabel?: string;
  className?: string;
  /**
   * Which step to OPEN on — so a flow that can be left and resumed reopens
   * where the person stopped instead of making her walk past everything she
   * already did.
   *
   * Read once, as the name says. The caller derives it from what is already
   * done, and that derivation keeps changing as she works; re-seeding the
   * index from it would yank her out of the step she is reading the moment a
   * background refresh lands. A caller that really must re-seed remounts with
   * a `key`.
   */
  initialIndex?: number;
  /**
   * Controlled mode. Pass BOTH to own the index from outside — the standard
   * React pair, so passing neither keeps the uncontrolled default every current
   * caller relies on.
   *
   * It exists because something can legitimately need to sit BETWEEN two steps:
   * the guided onboarding acknowledges what was just accomplished before it
   * loads the next step, and that acknowledgement is what advances. A wizard
   * that owns its index privately cannot be paused that way.
   */
  index?: number;
  onIndexChange?: (next: number) => void;
  /**
   * The colour of the progress rail: the primary for the core's setups, a module's own colour for its setup (0081),
   * so a module is told apart at a glance. The buttons keep the app's action colour.
   */
  tone?: TileTone;
}) {
  const t = useTranslations("product");
  const [ownIndex, setOwnIndex] = useState(() => Math.max(0, Math.min(steps.length - 1, initialIndex)));
  const controlled = controlledIndex !== undefined && onIndexChange !== undefined;
  const index = Math.max(0, Math.min(steps.length - 1, controlled ? controlledIndex : ownIndex));
  const setIndex = (next: number) => {
    const clamped = Math.max(0, Math.min(steps.length - 1, next));
    if (controlled) onIndexChange(clamped);
    else setOwnIndex(clamped);
  };
  const step = steps[index];
  const isLast = index === steps.length - 1;
  const canAdvance = step.canAdvance ?? true;
  const [acting, setActing] = useState(false);
  const running = acting || Boolean(step.busy);

  const primary = async () => {
    if (running) return;
    if (step.onPrimary) {
      setActing(true);
      let proceed = false;
      try {
        proceed = await step.onPrimary();
      } finally {
        setActing(false);
      }
      if (!proceed) return;
    }
    if (isLast) onComplete();
    else setIndex(index + 1);
  };

  // A step chosen in the list: back is a move, what was typed stays in the flow; forward first saves what the step
  // holds, as "Continuar" would, so leaving by the list never loses it (the owner, 2026-11-24).
  const go = async (next: number) => {
    if (running || next === index) return;
    if (next > index) {
      if (!canAdvance) return;
      if (step.onLeave) {
        setActing(true);
        let proceed = false;
        try {
          proceed = await step.onLeave();
        } finally {
          setActing(false);
        }
        if (!proceed) return;
      }
    }
    setIndex(next);
  };

  const named = steps.every((item) => Boolean(item.label));
  const following = steps[index + 1];

  const card = (
    <Card className={cn("w-full", named ? "min-w-0" : "mx-auto max-w-2xl", !named && className)}>
      <CardContent className="flex flex-col gap-6">
        {/* Progress rail — the whole path is visible; the reader sees the end. Beside a list of the steps, only on
            a narrow screen, where the list is not drawn. */}
        <Box className={cn("flex flex-row items-center gap-2", named && "lg:hidden")} aria-hidden={named || undefined}>
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i < index ? RAIL[tone].done : i === index ? RAIL[tone].current : "bg-grey-100",
              )}
            />
          ))}
        </Box>

        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="text-text-secondary">
            {named && following?.label ? (
              <>
                <span className="lg:hidden">
                  {t("wizard-step-next", { current: index + 1, total: steps.length, next: following.label })}
                </span>
                <span className="hidden lg:inline">{t("wizardStep", { current: index + 1, total: steps.length })}</span>
              </>
            ) : (
              t("wizardStep", { current: index + 1, total: steps.length })
            )}
          </Typography>
          <Typography variant="h4" component="h2" className="text-text-primary">
            {step.title}
          </Typography>
          {step.hint && (
            <Typography variant="body1" className="text-text-secondary leading-6">
              {step.hint}
            </Typography>
          )}
        </Box>

        <Box>{step.content}</Box>

        <Box className="flex flex-row flex-wrap items-center justify-between gap-2">
          {step.noBack ? (
            <span />
          ) : (
            <Button variant="text" color="grey" disabled={index === 0 || running} onClick={() => setIndex(index - 1)}>
              {t("back")}
            </Button>
          )}
          <Box className="flex flex-row flex-wrap items-center justify-end gap-2">
            {step.secondary && (
              <Button variant="text" color="grey" onClick={step.secondary.onClick} disabled={running}>
                {step.secondary.label}
              </Button>
            )}
            {!step.hidePrimary &&
              (step.primaryFormId ? (
                <Button
                  type="submit"
                  form={step.primaryFormId}
                  variant="contained"
                  color="primary"
                  disabled={!canAdvance || running}
                  endIcon={isLast ? <NiCheck size="medium" /> : <NiArrowRight size="medium" />}
                >
                  {running
                    ? t("saving")
                    : (step.primaryLabel ?? (isLast ? (completeLabel ?? t("finish")) : t("continue")))}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  color="primary"
                  disabled={!canAdvance || running}
                  endIcon={isLast ? <NiCheck size="medium" /> : <NiArrowRight size="medium" />}
                  onClick={() => void primary()}
                >
                  {running
                    ? t("saving")
                    : (step.primaryLabel ?? (isLast ? (completeLabel ?? t("finish")) : t("continue")))}
                </Button>
              ))}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  if (!named) return card;

  return (
    <Box className={cn("grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)]", className)}>
      <Box component="nav" aria-label={t("wizard-steps-label")} className="hidden lg:block">
        <Box component="ol" className="m-0 flex list-none flex-col gap-1 p-0">
          {steps.map((item, i) => {
            const current = i === index;
            const reachable = i < index || (i > index && canAdvance);
            return (
              <Box component="li" key={i}>
                <Box
                  component="button"
                  type="button"
                  aria-current={current ? "step" : undefined}
                  disabled={current || running || !reachable}
                  onClick={() => void go(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl border-0 bg-transparent px-2.5 py-2 text-left text-sm transition-colors",
                    current
                      ? "bg-background-paper text-text-primary font-semibold shadow-sm"
                      : "text-text-secondary enabled:hover:bg-grey-50 enabled:cursor-pointer",
                    (item.done || i < index) && !current && "text-text-primary",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-6 flex-none items-center justify-center rounded-full border text-xs font-bold",
                      current
                        ? cn(RAIL[tone].done, "border-transparent text-white")
                        : item.done
                          ? "bg-success/15 text-success-dark border-transparent"
                          : "border-grey-200 bg-background-paper text-text-secondary",
                    )}
                  >
                    {item.done && !current ? <NiCheck size="small" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.done && !current ? <span className="sr-only">{t("wizard-step-done")}</span> : null}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
      {card}
    </Box>
  );
}
