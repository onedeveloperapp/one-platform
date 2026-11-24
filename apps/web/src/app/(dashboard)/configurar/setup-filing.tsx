"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Typography } from "@mui/material";

import {
  EMPTY_LAWYER_DRAFT,
  ExtensionLinkBox,
  filingErrorKey,
  FIRM_WAY_WORDS,
  firmDraftOf,
  type FirmWayDraft,
  FirmWayFields,
  type LawyerWayDraft,
  LawyerWayRows,
  saveFirmChoice,
  saveLawyerChoice,
} from "@/components/firm/filing-way-form";
import SectionTitle from "@/components/product/section-title";
import type { WizardStep } from "@/components/product/setup-wizard";
import StateLine from "@/components/product/state-line";
import { type FilingWaysData, systemsToChoose, type Way, workingSystems } from "@/lib/filing-ways/ways";

/**
 * The step "Como o escritório protocola" of the firm's setup and "Como você protocola" of each lawyer's (the owner's
 * three ways to file, 2026-11-20: everything they need is asked in the onboarding, never left to be found in the
 * settings; and the canvas of 2026-11-24, which cut it from 620 words to about 200). Who decides for the firm chooses
 * the firm's way, none marked before the choice, with the firm's acknowledgment of an automated one under it; a
 * lawyer chooses their own way at each system they are asked about (`systemsFor`: their states, their lawsuits, else
 * every one ONE works on), one line per court, the court login only where ONE's browser files with it, one
 * acknowledgment naming the courts, and the extension's link once. One "Continuar" saves it all, the firm's first: a
 * lawyer's way is never beyond it.
 */
export function useFilingStep(input: {
  /** What the ways read; null when it could not be read, and the step says so without holding the setup. */
  filing: FilingWaysData | null;
  /** The firm's own way is chosen here: by who decides for the firm, in a person's setup only while it has none. */
  firmForm: boolean;
  /** The states of who answers, the registration given in the step before included: their own courts. */
  myStates: readonly string[];
  blocked: boolean;
  onSaved: () => void;
}): Pick<WizardStep, "content"> & { canAdvance: boolean; onPrimary: () => Promise<boolean>; owed: boolean } {
  const t = useTranslations("product");
  const filing = input.filing;
  const [firmDraft, setFirmDraft] = useState<FirmWayDraft>(() => firmDraftOf(filing?.firmWay ?? null));
  const [drafts, setDrafts] = useState<Record<string, LawyerWayDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The firm's way the lawyer's choices are made under: the one being chosen on this screen, else the one saved.
  const firmWay: Way | null = input.firmForm ? firmDraft.way : (filing?.firmWay ?? null);
  const mine = filing && filing.lawyer ? systemsToChoose(filing, input.myStates, firmWay) : [];
  const courts = filing ? workingSystems(filing.systems) : [];
  const owed =
    filing !== null &&
    ((input.firmForm && filing.firmWay === null) || mine.some((system) => !filing.myWays[system.key]));

  const change = (key: string, draft: LawyerWayDraft) => {
    setDrafts((current) => ({ ...current, [key]: draft }));
    setError(null);
  };

  /** Saves the firm's way, then the lawyer's at each court: what "Continuar" and linking the extension both need. */
  const saveAll = async (): Promise<{ ok: true } | { ok: false; code: string }> => {
    if (!filing || input.blocked) return { ok: true };
    if (input.firmForm) {
      const saved = await saveFirmChoice({ draft: firmDraft, saved: filing.firmWay, term: filing.terms.firm });
      if (!saved.ok) return saved;
    }
    for (const system of mine) {
      const done = await saveLawyerChoice({
        system,
        firmWay,
        saved: filing.myWays[system.key],
        draft: drafts[system.key] ?? EMPTY_LAWYER_DRAFT,
        login: filing.logins.find((row) => row.system === system.key) ?? null,
        term: filing.terms.lawyer,
      });
      // The password never stays in the page, whatever the answer.
      setDrafts((current) =>
        current[system.key] ? { ...current, [system.key]: { ...current[system.key], password: "" } } : current,
      );
      if (!done.ok) return done;
    }
    return { ok: true };
  };

  const onPrimary = async (): Promise<boolean> => {
    setError(null);
    if (!filing || input.blocked) return true;
    setBusy(true);
    try {
      const saved = await saveAll();
      if (!saved.ok) {
        setError(t(filingErrorKey(saved.code)));
        return false;
      }
      setDrafts({});
      setFirmDraft((current) => ({ ...current, aware: false }));
      input.onSaved();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const disabled = input.blocked || busy;
  const content = !filing ? (
    <Alert severity="error" className="neutral bg-background-paper/60!">
      {t("setup-filing-read-error")}
    </Alert>
  ) : (
    <Box className="flex flex-col gap-5">
      {input.firmForm ? (
        <Box component="section" aria-labelledby="setup-filing-firm" className="flex flex-col gap-3">
          <SectionTitle
            id="setup-filing-firm"
            title={t("filing-ways-firm-choice")}
            description={
              courts.length > 0
                ? t("setup-filing-courts-list", {
                    courts: new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(
                      courts.map((system) => system.name),
                    ),
                  })
                : undefined
            }
            as="h3"
            variant="subtitle1"
          />
          <FirmWayFields
            draft={firmDraft}
            saved={filing.firmWay}
            term={filing.terms.firm}
            onChange={(next) => {
              setFirmDraft(next);
              setError(null);
            }}
            disabled={disabled}
          />
          {firmDraft.way === "hand" ? <StateLine tone="info">{t("setup-filing-hand")}</StateLine> : null}
        </Box>
      ) : mine.length === 0 ? (
        // Who does not decide for the firm reads its way; a lawyer of it sees it marked among their own ways.
        <StateLine tone="info">
          {filing.firmWay
            ? t("filing-ways-firm-chosen", { way: t(FIRM_WAY_WORDS[filing.firmWay].label) })
            : t("setup-filing-not-decider")}
        </StateLine>
      ) : null}

      {mine.length > 0 ? (
        <Box component="section" aria-labelledby="setup-filing-mine" className="flex flex-col gap-3">
          <SectionTitle
            id="setup-filing-mine"
            title={t("setup-filing-mine-title")}
            description={t("setup-filing-mine-info")}
            as="h3"
            variant="subtitle1"
          />
          {input.firmForm && firmDraft.way === null ? (
            // The firm's way is the most a lawyer of it may choose: theirs comes once the firm's is chosen.
            <Typography variant="body2" className="text-text-secondary">
              {t("setup-filing-firm-first")}
            </Typography>
          ) : (
            <LawyerWayRows
              systems={mine}
              firmWay={firmWay}
              saved={filing.myWays}
              drafts={drafts}
              logins={filing.logins}
              term={filing.terms.lawyer}
              onChange={change}
              extension={
                <ExtensionLinkBox link={filing.link} prepare={saveAll} onChanged={input.onSaved} disabled={disabled} />
              }
              disabled={disabled}
            />
          )}
        </Box>
      ) : null}

      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {error}
        </Alert>
      ) : null}
    </Box>
  );

  return { content, canAdvance: !disabled, onPrimary, owed };
}
