"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

import {
  EMPTY_LAWYER_DRAFT,
  ExtensionLinkBox,
  filingErrorKey,
  FIRM_WAY_WORDS,
  firmDraftOf,
  type FirmWayDraft,
  FirmWayFields,
  type LawyerWayDraft,
  LawyerWayFields,
  saveFirmChoice,
  saveLawyerChoice,
} from "@/components/firm/filing-way-form";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import { readMyFilingWays } from "@/lib/filing-ways/actions";
import { type FilingWaysData, type Way, waysOffered } from "@/lib/filing-ways/ways";

/**
 * How the person files at one court's screen, chosen where a lawsuit waits for it (the owner's test of 2026-11-23: a
 * case whose package was ready showed only the steps by hand, while ONE could file it once its lawyer chose): the
 * firm's way first where who decides for the firm reads it and none was chosen, then the person's own way at that
 * system when they sign the lawsuit, with the same fields as the setups and the settings
 * (`components/firm/filing-way-form.tsx`). What it needs is read as it opens; a choice saved closes it, and the case
 * says what follows.
 */
export default function FilingChoiceDialog({
  systemKey,
  signs,
  onClose,
  onSaved,
}: {
  /** The screen system of the lawsuit's court (`court_screen_systems.key`). */
  systemKey: string;
  /** The person signs the lawsuit: their own way at the system is asked. */
  signs: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [data, setData] = useState<FilingWaysData | null | undefined>(undefined);
  const [firmDraft, setFirmDraft] = useState<FirmWayDraft>(() => firmDraftOf(null));
  const [draft, setDraft] = useState<LawyerWayDraft>(EMPTY_LAWYER_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    const ways = await readMyFilingWays().catch(() => null);
    setData(ways);
    if (ways) setFirmDraft(firmDraftOf(ways.firmWay));
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  const system = data?.systems.find((row) => row.key === systemKey) ?? null;
  const firmForm = Boolean(data?.decidesForFirm && data.firmWay === null);
  // The firm's way the person's choice is made under: the one being chosen here, else the one saved.
  const firmWay: Way | null = firmForm ? firmDraft.way : (data?.firmWay ?? null);
  const ownForm = Boolean(data?.lawyer && signs && system && waysOffered(system, firmWay).length > 1);
  const saved = system ? data?.myWays[system.key] : undefined;
  const login = system ? (data?.logins.find((row) => row.system === system.key) ?? null) : null;

  const save = async (): Promise<{ ok: true } | { ok: false; code: string }> => {
    if (!data || !system) return { ok: false, code: "failed" };
    if (firmForm) {
      const firm = await saveFirmChoice({ draft: firmDraft, saved: data.firmWay, term: data.terms.firm });
      if (!firm.ok) return firm;
    }
    if (!ownForm) return { ok: true };
    return saveLawyerChoice({ system, firmWay, saved, draft, login, term: data.terms.lawyer });
  };

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const done = await save();
      // The password never stays in the page, whatever the answer.
      setDraft((current) => ({ ...current, password: "" }));
      if (!done.ok) return setError(t(filingErrorKey(done.code)));
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const title = firmForm ? t("setup-filing-title") : t("filing-ways-choose", { system: system?.name ?? "" });

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="filing-choice-title">
      <DialogTitle id="filing-choice-title">{title}</DialogTitle>
      <DialogContent className="flex flex-col gap-5">
        {data === undefined ? (
          <Box className="flex flex-row items-center gap-3 py-4" role="status">
            <CircularProgress size={20} />
            <Typography variant="body2">{t("loading")}</Typography>
          </Box>
        ) : !data || !system ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t("filing-ways-read-error")}
          </Alert>
        ) : (
          <>
            {firmForm ? (
              <FirmWayFields
                draft={firmDraft}
                saved={data.firmWay}
                term={data.terms.firm}
                onChange={(next) => {
                  setFirmDraft(next);
                  setError(null);
                }}
                disabled={busy}
              />
            ) : null}
            {ownForm ? (
              <LawyerWayFields
                system={system}
                firmWay={firmWay}
                saved={saved}
                draft={draft}
                login={login}
                term={data.terms.lawyer}
                onChange={(next) => {
                  setDraft(next);
                  setError(null);
                }}
                heading={
                  firmForm ? (
                    <SectionTitle
                      id="filing-choice-own"
                      title={t("filing-ways-choose", { system: system.name })}
                      as="h3"
                      variant="subtitle1"
                    />
                  ) : undefined
                }
                extension={
                  <ExtensionLinkBox
                    link={data.link}
                    // The code is asked once the choice is saved: then the dialog reads what was saved.
                    prepare={async () => {
                      const done = await save();
                      if (done.ok) void read();
                      return done;
                    }}
                    onChanged={() => {
                      onSaved();
                      void read();
                    }}
                    disabled={busy}
                  />
                }
                disabled={busy}
              />
            ) : null}
            {!firmForm && !ownForm ? (
              // Nothing left to choose here: the firm's way, or the person's place in the lawsuit, changed meanwhile.
              <StateLine tone="info">
                {data.firmWay
                  ? t("filing-ways-firm-chosen", { way: t(FIRM_WAY_WORDS[data.firmWay].label) })
                  : t("filing-ways-firm-none")}
              </StateLine>
            ) : null}
            {error ? (
              <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
                {error}
              </Alert>
            ) : null}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="grey" onClick={onClose} disabled={busy}>
          {firmForm || ownForm ? t("cancel") : t("close")}
        </Button>
        {data && system && (firmForm || ownForm) ? (
          <Button variant="contained" onClick={() => void submit()} disabled={busy}>
            {busy ? t("saving") : t("filing-ways-save")}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
