"use client";

import { useTranslations } from "next-intl";

import { Box, FormControl, FormControlLabel, FormLabel, Grid, Radio, RadioGroup, Typography } from "@mui/material";

import { CurrencyField } from "@/components/product/fields";
import { type Incident, INCIDENT_KEY, INCIDENTS } from "@/lib/cases/cases";
import type { ClaimChoice } from "@/lib/firm/autonomy";

/**
 * The firm's choice of the Valor da Causa Pedido (migrations 0052 and 0064):
 * a value for each kind of problem, which each claimant of a case of that
 * kind asks unless somebody wrote another on the case, or no value, and the
 * lawsuits go with none for the judge to define; a kind left blank goes
 * with none too. The same form in the setup of the firm and in what ONE
 * decides alone, each saving it its own way: it only holds what is chosen
 * and typed.
 */
export default function ClaimValueChoice({
  id,
  choice,
  typed,
  disabled,
  onChoice,
  onTyped,
}: {
  /** Names the legend and the fields of this form on its screen. */
  id: string;
  choice: ClaimChoice;
  /** Each kind's value as its field holds it (reais with their decimals). */
  typed: Partial<Record<Incident, string>>;
  disabled: boolean;
  onChoice: (choice: ClaimChoice) => void;
  onTyped: (incident: Incident, value: string) => void;
}) {
  const t = useTranslations("product");

  return (
    <Box className="flex flex-col gap-4">
      <FormControl component="fieldset" disabled={disabled}>
        <FormLabel component="legend" id={`${id}-legend`} className="sr-only">
          {t("claims-choice-legend")}
        </FormLabel>
        <RadioGroup
          aria-labelledby={`${id}-legend`}
          className="gap-3"
          value={choice}
          onChange={(event) => onChoice(event.target.value === "define" ? "define" : "judge")}
        >
          <FormControlLabel
            value="define"
            control={<Radio />}
            label={
              <Box className="flex flex-col">
                <Typography variant="subtitle2">{t("claims-choice-define")}</Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("claims-choice-define-help")}
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            value="judge"
            control={<Radio />}
            label={
              <Box className="flex flex-col">
                <Typography variant="subtitle2">{t("claims-choice-judge")}</Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("claims-choice-judge-help")}
                </Typography>
              </Box>
            }
          />
        </RadioGroup>
      </FormControl>

      {choice === "define" && (
        <Grid container spacing={3}>
          {INCIDENTS.map((incident) => (
            <Grid key={incident} size={{ xs: 12, sm: 6 }}>
              <CurrencyField
                size="small"
                fullWidth
                id={`${id}-${incident}`}
                name={`${id}-${incident}`}
                label={t(INCIDENT_KEY[incident])}
                currencySymbol="R$"
                value={typed[incident] ?? ""}
                disabled={disabled}
                onChange={(event) => onTyped(incident, event.target.value)}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
