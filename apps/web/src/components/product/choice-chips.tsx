"use client";

import type { ReactNode } from "react";

import { Box, Chip } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import { cn } from "@/lib/utils";

export type ChipChoice<T extends string> = {
  value: T;
  label: ReactNode;
  /** Chosen and kept: shown as chosen, never taken out here (a module's own area). */
  fixed?: boolean;
};

/**
 * A choice of a setup's question drawn as chips (the owner's canvas of 2026-11-24): what is chosen is filled in the
 * primary with its check, what is not is outlined, so the answer is read at a glance and never taken for a button
 * that saves; the step's own button saves it. One of many (`single`, a yes or no, a band) is a radio group, several of
 * many a group of pressed chips. Radio buttons beside their labels ran into the label before them ("Até 20◯ De 21 a
 * 100", "Sim◯ Não"), and toggle buttons of the theme read as plain words.
 *
 * Closest catalog entries: `StatusChip`, which names a state and is never pressed, and the filter of `StatTile`;
 * neither answers a question.
 */
export default function ChoiceChips<T extends string>({
  options,
  selected,
  onToggle,
  single = false,
  label,
  labelledBy,
  disabled = false,
  className,
}: {
  options: ChipChoice<T>[];
  selected: readonly T[];
  /** The value pressed: a single choice takes it, a multiple one adds or takes it out. */
  onToggle: (value: T) => void;
  single?: boolean;
  /** The question, for assistive technology, when no element on the screen names it (`labelledBy`). */
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Box
      role={single ? "radiogroup" : "group"}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {options.map((option) => {
        const on = option.fixed || selected.includes(option.value);
        const pressable = !disabled && !option.fixed;
        return (
          <Chip
            key={option.value}
            label={option.label}
            icon={on ? <NiCheck size="small" /> : undefined}
            color={on ? "primary" : "default"}
            variant={on ? "filled" : "outlined"}
            onClick={pressable ? () => onToggle(option.value) : undefined}
            disabled={!pressable && !on}
            role={single ? "radio" : undefined}
            aria-checked={single ? on : undefined}
            aria-pressed={single ? undefined : on}
            className={cn(on && "font-semibold")}
          />
        );
      })}
    </Box>
  );
}
