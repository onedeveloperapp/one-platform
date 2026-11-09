"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, InputAdornment, TextField, Typography } from "@mui/material";

import { CurrencyField } from "@/components/product/fields";
import SidePanel from "@/components/product/side-panel";
import NiSettings from "@/icons/nexture/ni-settings";
import { saveOneWorkEstimates } from "@/lib/one-work/actions";
import {
  changedMinutes,
  estimatesErrorKey,
  hourCentsText,
  minutesDraftOf,
  typedHourCents,
  typedMinutes,
} from "@/lib/one-work/estimates";
import { familyLabelKey, kindLabelKey, ONE_WORK_FAMILIES, type OneWorkKind } from "@/lib/one-work/work";

/**
 * "Ajustar estimativas", for who decides for the firm (migrations 0120 and 0121): how many minutes a person of the firm would
 * take for each task ONE does, grouped by family, each blank where the firm follows ONE's (said beside it), and the
 * average cost of an hour, from which the page says what the hours are worth. Only what changed is sent; the change
 * is on the record, never with the cost.
 */
export default function EstimatesPanel({
  kinds,
  hourCents,
  onClose,
  onSaved,
}: {
  kinds: OneWorkKind[];
  hourCents: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [draft, setDraft] = useState(() => minutesDraftOf(kinds));
  const [cost, setCost] = useState(() => hourCentsText(hourCents));
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const costCents = typedHourCents(cost);

  const save = async () => {
    const minutes = changedMinutes(kinds, draft);
    if (minutes === undefined) return setErrorCode("minutes");
    if (costCents === undefined) return setErrorCode("cost");
    const setCostNow = costCents !== hourCents;
    if (Object.keys(minutes).length === 0 && !setCostNow) return onClose();
    setBusy(true);
    setErrorCode(null);
    try {
      const result = await saveOneWorkEstimates({ minutes, setCost: setCostNow, hourCents: costCents });
      if (result.ok) onSaved();
      else setErrorCode(result.code);
    } catch {
      setErrorCode("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("one-work-close")}
      icon={<NiSettings size="medium" />}
      tone="primary"
      busy={busy}
      title={t("one-work-adjust")}
      description={t("one-work-adjust-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("one-work-saving") : t("one-work-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("one-work-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-6">
        {errorCode ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(estimatesErrorKey(errorCode))}
          </Alert>
        ) : null}

        <Box component="section" aria-labelledby="one-work-cost" className="flex flex-col gap-2">
          <Typography id="one-work-cost" variant="subtitle2" component="h3" className="mb-0">
            {t("one-work-cost-title")}
          </Typography>
          <CurrencyField
            label={t("one-work-cost-field")}
            currencySymbol="R$"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            error={costCents === undefined}
            helperText={costCents === undefined ? t("one-work-error-cost") : t("one-work-cost-help")}
          />
        </Box>

        {ONE_WORK_FAMILIES.map((family) => {
          const ofFamily = kinds.filter((kind) => kind.family === family);
          if (ofFamily.length === 0) return null;
          return (
            <Box
              key={family}
              component="section"
              aria-labelledby={`one-work-minutes-${family}`}
              className="flex flex-col gap-3"
            >
              <Typography id={`one-work-minutes-${family}`} variant="subtitle2" component="h3" className="mb-0">
                {t(familyLabelKey(family))}
              </Typography>
              {ofFamily.map((kind) => {
                const text = draft[kind.key] ?? "";
                const typed = typedMinutes(text);
                return (
                  <TextField
                    key={kind.key}
                    label={t(kindLabelKey(kind.key))}
                    value={text}
                    placeholder={String(kind.defaultMinutes)}
                    onChange={(event) => setDraft((prior) => ({ ...prior, [kind.key]: event.target.value }))}
                    error={typed === undefined}
                    helperText={
                      typed === undefined
                        ? t("one-work-error-minutes")
                        : typed === null
                          ? t("one-work-minutes-default", { minutes: kind.defaultMinutes })
                          : t("one-work-minutes-own", { minutes: kind.defaultMinutes })
                    }
                    slotProps={{
                      htmlInput: { inputMode: "numeric", maxLength: 3 },
                      input: {
                        endAdornment: <InputAdornment position="end">{t("one-work-minutes-unit")}</InputAdornment>,
                      },
                    }}
                  />
                );
              })}
            </Box>
          );
        })}
      </Box>
    </SidePanel>
  );
}
