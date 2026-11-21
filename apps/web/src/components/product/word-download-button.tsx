"use client";

import { useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useState } from "react";

import { Button, type ButtonProps } from "@mui/material";

import { firmLetterheadBytes } from "@/lib/brand/letterhead-download";
import { downloadWord } from "@/lib/library/word-download";

/**
 * "Baixar em Word": a text the firm gives ONE to work with (a model of the
 * library, the paper its clients sign, the clause of an agency's contract)
 * saved by the person as a Word document, written in their browser. Every
 * such text offers it, where it is listed and where it is written (the owner,
 * 2026-11-03). The text is the one in hand, or read when the button is
 * pressed, since a list never reads every text whole; the marks the platform
 * fills stay as they are, so the file is the model itself.
 *
 * It is the small grey text button of a row's actions ("Editar", "Remover"),
 * which nothing in the catalog wraps: what it adds is the reading, the file
 * written in the browser and the snackbar when it cannot be.
 */
export default function WordDownloadButton({
  name,
  text,
  read,
  label,
  ariaLabel,
  disabled = false,
  variant = "text",
  letterhead = false,
}: {
  /** The document's name: the file's, and what the button's accessible name says. */
  name: string;
  /** The text in hand. */
  text?: string;
  /** How the text is read when it is not in hand: null when it could not be. */
  read?: () => Promise<string | null>;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  variant?: ButtonProps["variant"];
  /** A text of the firm's: written into its own Word document on its letterhead, where it has one (0260). */
  letterhead?: boolean;
}) {
  const t = useTranslations("product");
  const { enqueueSnackbar } = useSnackbar();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const handed = await downloadWord(
        name,
        text ?? read ?? "",
        t("word-download-fallback"),
        letterhead ? firmLetterheadBytes : null,
      );
      if (!handed) enqueueSnackbar(t("word-download-failed"), { variant: "error" });
    } catch {
      enqueueSnackbar(t("word-download-failed"), { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant={variant}
      color="grey"
      size="small"
      disabled={disabled || busy}
      onClick={() => void download()}
      aria-label={ariaLabel ?? t("word-download-label", { name })}
    >
      {label ?? t("word-download")}
    </Button>
  );
}
