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
  LawyerWayFields,
  saveFirmChoice,
  saveLawyerChoice,
} from "@/components/firm/filing-way-form";
import SectionTitle from "@/components/product/section-title";
import type { WizardStep } from "@/components/product/setup-wizard";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiCheck from "@/icons/nexture/ni-check";
import { type FilingWaysData, type ScreenSystem, systemsIn, systemsToChoose, type Way } from "@/lib/filing-ways/ways";

/**
 * The step "Como o escritório protocola" of the firm's setup and "Como você protocola" of each lawyer's (the owner's
 * three ways to file, 2026-11-20, and the canvas the owner approved: everything they need is asked in the onboarding,
 * never left to be found in the settings). Who decides for the firm chooses the firm's way, with the firm's
 * acknowledgment of an automated one, the courts of the firm's lawyers in sight; a lawyer chooses their own way at
 * each system of their states, the firm's marked, with their court login for ONE's browser and their own
 * acknowledgment. One "Continuar" saves it all, the firm's first: a lawyer's way is never beyond it.
 */
export function useFilingStep(input: {
  /** What the ways read; null when it could not be read, and the step says so without holding the setup. */
  filing: FilingWaysData | null;
  /** The firm's own way is chosen here: by who decides for the firm, in a person's setup only while it has none. */
  firmForm: boolean;
  /** The states of the firm's lawyers, whose courts the firm's choice is shown for. */
  firmStates: readonly string[];
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
  const mine = filing && filing.lawyer ? systemsToChoose(filing.systems, input.myStates, firmWay) : [];
  const courts = filing ? systemsIn(filing.systems, input.firmStates) : [];
  const owed =
    filing !== null &&
    ((input.firmForm && filing.firmWay === null) || mine.some((system) => !filing.myWays[system.key]));

  const draftOf = (key: string) => drafts[key] ?? EMPTY_LAWYER_DRAFT;
  const change = (key: string, draft: LawyerWayDraft) => {
    setDrafts((current) => ({ ...current, [key]: draft }));
    setError(null);
  };

  // Linking the extension in the step: its code is asked once the way is saved, the firm's first.
  const prepareExtension = async (system: ScreenSystem): Promise<{ ok: true } | { ok: false; code: string }> => {
    if (!filing || input.blocked) return { ok: false, code: "not_authorized" };
    if (input.firmForm) {
      const firm = await saveFirmChoice({ draft: firmDraft, saved: filing.firmWay, term: filing.terms.firm });
      if (!firm.ok) return firm;
    }
    return saveLawyerChoice({
      system,
      firmWay,
      saved: filing.myWays[system.key],
      draft: draftOf(system.key),
      login: filing.logins.find((row) => row.system === system.key) ?? null,
      term: filing.terms.lawyer,
    });
  };

  const onPrimary = async (): Promise<boolean> => {
    setError(null);
    if (!filing || input.blocked) return true;
    setBusy(true);
    try {
      if (input.firmForm) {
        const saved = await saveFirmChoice({ draft: firmDraft, saved: filing.firmWay, term: filing.terms.firm });
        if (!saved.ok) {
          setError(t(filingErrorKey(saved.code)));
          return false;
        }
      }
      for (const system of mine) {
        const done = await saveLawyerChoice({
          system,
          firmWay,
          saved: filing.myWays[system.key],
          draft: draftOf(system.key),
          login: filing.logins.find((row) => row.system === system.key) ?? null,
          term: filing.terms.lawyer,
        });
        // The password never stays in the page, whatever the answer.
        setDrafts((current) => ({ ...current, [system.key]: { ...draftOf(system.key), password: "" } }));
        if (!done.ok) {
          setError(t(filingErrorKey(done.code)));
          return false;
        }
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
        <>
          {courts.length > 0 ? (
            <Box className="flex flex-row flex-wrap items-center gap-2">
              <Typography variant="subtitle2" component="span">
                {t("setup-filing-courts")}
              </Typography>
              {courts.map((system) => (
                <StatusChip
                  key={system.key}
                  tone="positive"
                  icon={<NiCheck size="small" />}
                  label={t("setup-filing-court", { system: system.name, uf: system.uf ?? "" })}
                />
              ))}
            </Box>
          ) : input.firmStates.length > 0 ? (
            <StateLine tone="info">{t("setup-filing-no-court")}</StateLine>
          ) : null}
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
          {firmDraft.way === "hand" ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("setup-filing-hand")}
            </Typography>
          ) : null}
        </>
      ) : mine.length === 0 ? (
        // Who does not decide for the firm reads its way; a lawyer of it sees it marked among their own ways.
        <StateLine tone="info">
          {filing.firmWay
            ? t("filing-ways-firm-chosen", { way: t(FIRM_WAY_WORDS[filing.firmWay].label) })
            : t("setup-filing-not-decider")}
        </StateLine>
      ) : null}

      {mine.map((system) => (
        <LawyerWayFields
          key={system.key}
          system={system}
          firmWay={firmWay}
          saved={filing.myWays[system.key]}
          draft={draftOf(system.key)}
          login={filing.logins.find((row) => row.system === system.key) ?? null}
          term={filing.terms.lawyer}
          onChange={(next) => change(system.key, next)}
          heading={
            <SectionTitle
              id={`setup-filing-${system.key}`}
              title={t("filing-ways-choose", { system: system.name })}
              as="h3"
              variant="subtitle1"
            />
          }
          extension={
            <Box className="flex flex-col gap-2">
              <Typography variant="body2" className="text-text-secondary">
                {t("setup-filing-extension")}
              </Typography>
              <ExtensionLinkBox
                link={filing.link}
                prepare={() => prepareExtension(system)}
                onChanged={input.onSaved}
                disabled={disabled}
              />
            </Box>
          }
          disabled={disabled}
        />
      ))}

      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {error}
        </Alert>
      ) : null}
    </Box>
  );

  return { content, canAdvance: !disabled, onPrimary, owed };
}
