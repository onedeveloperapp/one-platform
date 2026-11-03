"use client";

import { type ReactNode, useRef } from "react";

import { Box, Button, Typography } from "@mui/material";

import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";

/** What a registration may start from: a photo, a screenshot or a PDF. */
export const DOCUMENT_SLOT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

/** Where one document sent to start a registration stands. */
export type SlotState =
  | { kind: "empty" }
  | { kind: "sending" }
  | { kind: "reading" }
  | { kind: "read"; tone: "positive" | "attention"; sentence: string }
  | { kind: "failed"; sentence: string };

export type SlotLabels = {
  send: string;
  again: string;
  sending: string;
  reading: string;
  read: string;
  failed: string;
};

/**
 * One document a person sends to start a registration (migration 0085): what it is, what ONE reads in it, where its
 * reading stands and the button that sends it, or another. Closest to a line of the case's documents card, with the
 * file input of its own because nothing is written yet: the form saves what the person confirms, and the document
 * joins the case after.
 */
export default function DocumentSlot({
  id,
  icon,
  title,
  hint,
  state,
  fileName,
  primary = false,
  disabled = false,
  labels,
  onFile,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  /** What ONE reads in it, while nothing was sent. */
  hint: string;
  state: SlotState;
  fileName?: string | null;
  /** The document the registration starts from: its button is the dialog's first action. */
  primary?: boolean;
  disabled?: boolean;
  labels: SlotLabels;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const sent = state.kind !== "empty";
  const chip: { label: string; tone: StatusTone } | null =
    state.kind === "sending"
      ? { label: labels.sending, tone: "info" }
      : state.kind === "reading"
        ? { label: labels.reading, tone: "info" }
        : state.kind === "read"
          ? { label: labels.read, tone: state.tone }
          : state.kind === "failed"
            ? { label: labels.failed, tone: "attention" }
            : null;
  const sentence = state.kind === "read" || state.kind === "failed" ? state.sentence : hint;
  const busy = state.kind === "sending" || state.kind === "reading";

  return (
    <Box
      component="li"
      className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
      aria-labelledby={`${id}-title`}
    >
      <Box className="flex min-w-0 flex-1 items-start gap-3">
        <Box className={`${TILE_TONE.primary.bg} flex size-10 shrink-0 items-center justify-center rounded-xl`}>
          {icon}
        </Box>
        <Box className="flex min-w-0 flex-1 flex-col gap-1">
          <Box className="flex flex-wrap items-center gap-2">
            <Typography id={`${id}-title`} variant="subtitle2" component="h3" className="mb-0">
              {title}
            </Typography>
            {chip && <StatusChip label={chip.label} tone={chip.tone} />}
          </Box>
          <Typography variant="body2" className="text-text-secondary" aria-live="polite">
            {sentence}
          </Typography>
          {sent && fileName && (
            <Typography variant="caption" className="text-text-secondary truncate">
              {fileName}
            </Typography>
          )}
        </Box>
      </Box>
      <Button
        variant={primary && !sent ? "contained" : "outlined"}
        color={primary && !sent ? "primary" : "grey"}
        size="small"
        disabled={disabled || busy}
        aria-label={`${sent ? labels.again : labels.send}: ${title}`}
        onClick={() => input.current?.click()}
      >
        {state.kind === "sending" ? labels.sending : sent ? labels.again : labels.send}
      </Button>
      <input
        ref={input}
        type="file"
        accept={DOCUMENT_SLOT_ACCEPT}
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </Box>
  );
}
