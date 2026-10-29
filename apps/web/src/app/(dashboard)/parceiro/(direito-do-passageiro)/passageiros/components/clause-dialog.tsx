"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import { saveClause } from "@/modules/direito-do-passageiro/agency/actions";
import { paxErrorKey } from "@/modules/direito-do-passageiro/agency/passengers";

const MOST = 1200;
const LEAST = 40;

/**
 * The clause of the agency's contract the passenger reads on the link, after ONE's own words: the one in force,
 * and, for who manages the agency, a new version. A version is never changed: a passenger agreed to the words they
 * read, which stay on record with their answer.
 */
export default function ClauseDialog({
  clause,
  manager,
  onClose,
  onSaved,
}: {
  clause: { version: number; body: string } | null;
  manager: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [body, setBody] = useState(clause?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const length = body.trim().length;

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    setSaved(null);
    const result = await saveClause(body);
    setBusy(false);
    if (!result.ok) {
      setProblem(t(paxErrorKey(result.code)));
      return;
    }
    setSaved(
      result.code === "unchanged" ? t("pax-clause-unchanged") : t("pax-clause-saved", { version: result.version ?? 1 }),
    );
    onSaved();
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="pax-clause-dialog">
      <DialogHeader
        id="pax-clause-dialog"
        title={t("pax-clause-title")}
        onClose={onClose}
        closeLabel={t("pax-close")}
      />
      <DialogContent>
        <Box className="flex flex-col gap-4">
          <Typography variant="body2" className="text-text-secondary">
            {t("pax-clause-help")}
          </Typography>
          <Typography variant="subtitle2" component="p">
            {clause ? t("pax-clause-version", { version: clause.version }) : t("pax-clause-none")}
          </Typography>
          {manager ? (
            <TextField
              id="pax-clause-body"
              label={t("pax-clause-label")}
              value={body}
              multiline
              minRows={6}
              fullWidth
              disabled={busy}
              error={length > MOST}
              helperText={t("pax-clause-count", { count: length })}
              onChange={(event) => setBody(event.target.value)}
            />
          ) : (
            <>
              {clause && (
                <Typography variant="body1" className="whitespace-pre-line">
                  {clause.body}
                </Typography>
              )}
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("pax-clause-member")}
              </Alert>
            </>
          )}
          {problem && <Alert severity="error">{problem}</Alert>}
          {saved && (
            <Alert severity="success" className="neutral bg-background-paper/60!">
              {saved}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("pax-close")}
        </Button>
        {manager && (
          <Button variant="contained" onClick={() => void submit()} disabled={busy || length < LEAST || length > MOST}>
            {busy ? t("pax-saving") : t("pax-clause-save")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
