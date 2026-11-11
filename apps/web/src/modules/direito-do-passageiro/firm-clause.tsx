"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, TextField } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import WordDownloadButton from "@/components/product/word-download-button";
import { paxErrorKey } from "@/modules/direito-do-passageiro/agency/passengers";
import { CLAUSE_MOST, clauseChange, clauseText } from "@/modules/direito-do-passageiro/agency/setup";
import { saveFirmClause } from "@/modules/direito-do-passageiro/setup-actions";

/** The words the firm gave its agencies, in force; null with none. */
export type FirmClause = { version: number; body: string } | null;

/**
 * The words of the clause the firm's partner agencies register (migration 0081) as a form holds them: untouched, the
 * words in force or ONE's proposal as the page reads them now; what changed of them, and the save of a new version.
 * One draft for the module's setup (saved on its step's button) and for the module's settings (saved on its own).
 */
export function useFirmClause({
  clause,
  proposal,
  editable,
  onSaved,
}: {
  clause: FirmClause;
  proposal: string | null;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const inForce = clause?.body ?? null;
  // Untouched (null), the field shows the words in force or ONE's proposal as the page reads them now.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? inForce ?? proposal ?? "";
  const [error, setError] = useState<string | null>(null);
  const change = clauseChange(text, inForce);
  const fromOne = !inForce && proposal !== null && clauseText(text) === clauseText(proposal);
  /** Registers the words as a new version when they changed; false, with the error said, when they could not be. */
  const save = async (): Promise<boolean> => {
    setError(null);
    if (!editable || change.kind === "same") return true;
    if (change.kind === "invalid") {
      setError(t("partner-setup-clause-invalid"));
      return false;
    }
    const result = await saveFirmClause(change.text).catch(() => ({ ok: false as const, code: "failed" }));
    if (!result.ok) {
      setError(t(paxErrorKey(result.code)));
      return false;
    }
    setDraft(null);
    onSaved();
    return true;
  };
  return {
    inForce,
    text,
    change,
    fromOne,
    error,
    editable,
    edit: (value: string) => {
      setDraft(value);
      if (error) setError(null);
    },
    save,
  };
}

export type FirmClauseDraft = ReturnType<typeof useFirmClause>;

/**
 * The clause as the firm reads and writes it: the version in force, who may change it, that ONE proposed the words
 * (and may err), that the words in force could not be read, the field, the words as a Word file and the way back to
 * ONE's proposal.
 */
export default function FirmClauseFields({
  draft,
  clause,
  clauseRead,
  proposal,
  decides,
}: {
  draft: FirmClauseDraft;
  clause: FirmClause;
  clauseRead: boolean;
  proposal: string | null;
  decides: boolean;
}) {
  const t = useTranslations("product");
  return (
    <Box className="flex flex-col gap-4">
      {clause ? (
        <Box>
          <StatusChip tone="positive" label={t("pax-clause-version", { version: clause.version })} />
        </Box>
      ) : null}
      {!decides ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("pax-setup-clause-not-partner")}
        </Alert>
      ) : draft.fromOne ? (
        // What ONE proposes is said as ONE's, with what to check: the firm registers the words.
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("pax-setup-clause-from-one")}
        </Alert>
      ) : null}
      {!clauseRead ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("partner-setup-clause-unread")}
        </Alert>
      ) : null}
      <TextField
        id="module-clause"
        label={t("pax-clause-label")}
        value={draft.text}
        multiline
        minRows={8}
        fullWidth
        disabled={!draft.editable}
        error={Boolean(draft.error) || clauseText(draft.text).length > CLAUSE_MOST}
        helperText={draft.error ?? t("pax-clause-count", { count: clauseText(draft.text).length })}
        onChange={(event) => draft.edit(event.target.value)}
      />
      <Box className="flex flex-wrap items-center gap-2">
        <WordDownloadButton name={t("pax-setup-clause-file")} text={clauseText(draft.text)} />
        {proposal !== null && !draft.fromOne && draft.editable ? (
          <Button variant="text" color="grey" size="small" onClick={() => draft.edit(proposal)}>
            {t("partner-setup-clause-restore")}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}
