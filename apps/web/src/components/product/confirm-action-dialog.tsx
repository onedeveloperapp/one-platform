"use client";

import { type ReactNode, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Typography,
} from "@mui/material";

/**
 * One confirmation for an operator action that changes someone else's account.
 *
 * Extracted from the mold of `superadmin-dialog.tsx`, which was already the
 * shape this needs: a single component covering BOTH directions of the same
 * action, whose entire text is a function of the direction.
 *
 * The contract it enforces, in this order:
 *  1. Say what the action DOES — `consequences`, spelled out, never implied by
 *     the button label.
 *  2. Say what it does NOT do — `stays`. Half of a dangerous action's risk is
 *     the operator assuming it reaches further than it does; "suspender" that
 *     does not suspend login has to say so, out loud, before the click.
 *  3. Make the operator state a reason, because the audit trail has columns for
 *     who and when but the WHY survives nowhere else (migration 0005).
 *
 * `onConfirm` resolves to an error message or null, so the busy/error cycle
 * stays here and a failure never closes the dialog.
 *
 * The same shape serves a person of a firm acting on a colleague (removing
 * somebody, handing the firm over): there the audit event is written by the
 * database function with who and when, so `requireReason={false}` drops the
 * reason field, and the two button labels come from the message catalog.
 *
 * An act that cannot be undone and takes a whole set of records (clearing a
 * firm's cases and clients) asks the person to type a word too (`typedWord`):
 * the button stays off until it matches, and the word typed goes to
 * `onConfirm` for the server to check again. What the act needs first (the
 * second factor, asked in place) goes in `children`, above the word, with
 * `blocked` keeping the button off until it is met.
 */
export default function ConfirmActionDialog({
  title,
  intro,
  consequences,
  staysTitle = "O que NÃO muda",
  stays,
  reasonLabel = "Por que você está fazendo isto?",
  reasonPlaceholder,
  reasonHelp = "Fica na trilha de auditoria com o seu nome e a data. A trilha registra quem e quando de qualquer jeito, e o motivo é o único lugar onde o porquê sobrevive.",
  reasonMinLength = 8,
  requireReason = true,
  confirmLabel,
  cancelLabel = "Cancelar",
  busyLabel = "Aplicando…",
  tone = "warning",
  typedWord,
  children,
  blocked = false,
  onConfirm,
  onClose,
}: {
  title: string;
  /** One sentence of context, above the consequences. */
  intro?: string;
  /** What this action does. Rendered as a warning list — never leave it empty. */
  consequences: string[];
  staysTitle?: string;
  /** What this action deliberately does NOT do. */
  stays?: string[];
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonHelp?: string;
  /** Same floor as support access and account deletion. */
  reasonMinLength?: number;
  /** False when the action records its own audit event and takes no reason. */
  requireReason?: boolean;
  confirmLabel: string;
  cancelLabel?: string;
  /** What the confirm button says while the action runs. */
  busyLabel?: string;
  /** `danger` paints the confirm button red — for actions that take something away. */
  tone?: "warning" | "danger";
  /** A word the person types to confirm: the button stays off until `matches` says it is the word. */
  typedWord?: { label: string; help?: string; matches: (typed: string) => boolean };
  /** What the act needs first, asked in place (the second factor), above the word. */
  children?: ReactNode;
  /** Keeps the button off while what `children` asks is not met. */
  blocked?: boolean;
  onConfirm: (reason: string, typed: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOk = !requireReason || reason.trim().length >= reasonMinLength;
  const wordOk = !typedWord || typedWord.matches(typed);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const failure = await onConfirm(reason.trim(), typed);
    setBusy(false);
    // A failure keeps the dialog open with the reason still typed: closing it
    // would make the operator write the justification a second time.
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          {intro && (
            <Typography variant="body2" className="text-text-secondary">
              {intro}
            </Typography>
          )}

          <Alert severity="warning" className="neutral bg-background-paper/60!">
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
              {consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </Box>
          </Alert>

          {stays && stays.length > 0 && (
            <Box>
              <Typography variant="body2" className="text-text-primary mb-1 font-medium">
                {staysTitle}
              </Typography>
              <Box component="ul" className="text-text-secondary m-0 flex list-disc flex-col gap-1 pl-4">
                {stays.map((line) => (
                  <Typography component="li" variant="body2" key={line}>
                    {line}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}

          {children}

          {typedWord && (
            <FormControl className="outlined" variant="standard">
              <FormLabel htmlFor="confirm-action-word">{typedWord.label}</FormLabel>
              <Input
                id="confirm-action-word"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={busy || blocked}
                autoComplete="off"
                inputProps={{ spellCheck: false, autoCapitalize: "none", maxLength: 40 }}
                aria-describedby={typedWord.help ? "confirm-action-word-help" : undefined}
              />
              {typedWord.help ? (
                <Typography id="confirm-action-word-help" variant="body2" className="text-text-secondary mt-1">
                  {typedWord.help}
                </Typography>
              ) : null}
            </FormControl>
          )}

          {requireReason && (
            <FormControl className="outlined" variant="standard">
              <FormLabel htmlFor="confirm-action-reason">{reasonLabel}</FormLabel>
              <Input
                id="confirm-action-reason"
                placeholder={reasonPlaceholder}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy}
                autoFocus
                aria-describedby="confirm-action-reason-help"
              />
              {/* body2, not caption: the sentence that says where this text ends
                up is consequence copy, and caption renders below 12px. */}
              <Typography id="confirm-action-reason-help" variant="body2" className="text-text-secondary mt-1">
                {reasonHelp}
              </Typography>
            </FormControl>
          )}

          {error && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={close} disabled={busy}>
          {cancelLabel}
        </Button>
        {/* Disabled until the reason is there — and the helper above says why,
            so the button never sits dead without an explanation. */}
        <Button
          variant="contained"
          color={tone === "danger" ? "error" : "primary"}
          onClick={confirm}
          disabled={busy || blocked || !reasonOk || !wordOk}
        >
          {busy ? busyLabel : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
