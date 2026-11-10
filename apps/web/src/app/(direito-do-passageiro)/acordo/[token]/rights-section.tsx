"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
} from "@mui/material";

import CardTitle from "@/components/product/card-title";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiCheck from "@/icons/nexture/ni-check";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import NiLock from "@/icons/nexture/ni-lock";
import { downloadJson } from "@/modules/direito-do-passageiro/agency/download-json";
import { exportAgreement, forgetAgreement } from "@/modules/direito-do-passageiro/agency/link-actions";
import { paxErrorKey } from "@/modules/direito-do-passageiro/agency/passengers";

/**
 * The passenger's rights over what the agency keeps of them (migrations 0072 and 0074): a file with all of it, or
 * its deletion, theirs and the children's they answer for. On the open link, after their data went to the firm
 * (the agency's copy, kept a few days) and after the partnership ended, while the agency still keeps them. The
 * deletion names what it ends before it runs, and once it ran the page shows nothing of the passenger again. The
 * card leads with its lock; the download is the quiet way, the deletion the one in red, since it cannot be undone.
 */
export default function RightsSection({
  token,
  agency,
  firm,
  variant,
  onGone,
}: {
  token: string;
  agency: string;
  firm: string | null;
  variant: "open" | "handed_over" | "ended";
  /** Called once the deletion ran; with none, the section says so in its place. */
  onGone?: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<"download" | "forget" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const status = useRef<HTMLDivElement>(null);

  const fail = (code: string) => {
    setProblem(t(paxErrorKey(code)));
    setTimeout(() => status.current?.focus(), 0);
  };

  const download = async () => {
    setBusy("download");
    setProblem(null);
    const result = await exportAgreement(token);
    setBusy(null);
    if (!result.ok) return fail(result.code);
    downloadJson(result.data, "meus-dados.json");
  };

  const forget = async () => {
    setBusy("forget");
    const result = await forgetAgreement(token);
    setBusy(null);
    setConfirming(false);
    if (!result.ok) return fail(result.code);
    if (onGone) onGone();
    else setGone(true);
  };

  if (gone) {
    return (
      <Paper elevation={0} className="bg-background-paper flex flex-col gap-3 rounded-4xl px-6 py-8 sm:px-12">
        <span
          aria-hidden
          className="bg-success/15 text-success flex h-12 w-12 items-center justify-center rounded-full"
        >
          <NiCheck size="medium" />
        </span>
        <Typography variant="h4" component="h2" className="mb-0">
          {t("pax-link-gone-title")}
        </Typography>
        <Typography variant="body1">{t("pax-link-gone-body", { agency })}</Typography>
      </Paper>
    );
  }

  const body =
    variant === "handed_over"
      ? t("pax-link-rights-handed-body", { agency, firm: firm ?? "" })
      : variant === "ended"
        ? t("pax-link-rights-ended-body", { agency })
        : t("pax-link-rights-body", { agency });
  const forgetBody =
    variant === "handed_over"
      ? t("pax-link-forget-handed-body", { agency, firm: firm ?? "" })
      : variant === "ended"
        ? t("pax-link-forget-ended-body", { agency })
        : t("pax-link-forget-body", { agency, firm: firm ?? "" });

  return (
    <Paper
      component="section"
      aria-labelledby="pax-link-rights"
      elevation={0}
      className="bg-background-paper flex flex-col gap-3 rounded-4xl px-6 py-8 sm:px-12"
    >
      <CardTitle
        id="pax-link-rights"
        icon={<NiLock size="medium" />}
        tone="accent-1"
        title={t("pax-link-rights-title")}
        detail={body}
      />
      <Box ref={status} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {problem && <Alert severity="error">{problem}</Alert>}
      </Box>
      <Box className="flex flex-wrap gap-2">
        <Button
          variant="outlined"
          color="grey"
          disabled={busy !== null}
          startIcon={<NiDownloadCloud size="small" />}
          onClick={() => void download()}
        >
          {busy === "download" ? t("pax-privacy-downloading") : t("pax-link-rights-download")}
        </Button>
        <Button
          variant="text"
          color="error"
          disabled={busy !== null}
          startIcon={<NiBinEmpty size="small" />}
          onClick={() => setConfirming(true)}
        >
          {t("pax-link-rights-forget")}
        </Button>
      </Box>

      {confirming && (
        <Dialog open onClose={busy ? undefined : () => setConfirming(false)} aria-labelledby="pax-link-forget-title">
          <DialogTitle id="pax-link-forget-title">{t("pax-link-forget-title")}</DialogTitle>
          <DialogContent>
            <Typography variant="body1">{forgetBody}</Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="text" color="grey" disabled={busy !== null} onClick={() => setConfirming(false)}>
              {t("pax-link-forget-keep")}
            </Button>
            <Button variant="contained" color="error" disabled={busy !== null} onClick={() => void forget()}>
              {busy === "forget" ? t("pax-link-forgetting") : t("pax-link-forget-confirm")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Paper>
  );
}
