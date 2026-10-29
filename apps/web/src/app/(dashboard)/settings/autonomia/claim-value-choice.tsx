"use client";

import { useTranslations } from "next-intl";

import { Box, FormControl, FormControlLabel, FormLabel, Grid, Radio, RadioGroup, Typography } from "@mui/material";

import { CurrencyField } from "@/components/product/fields";
import type { ClaimChoice } from "@/lib/firm/autonomy";
import type { CaseKind } from "@/lib/modules/types";

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
  kinds,
  disabled,
  onChoice,
  onTyped,
}: {
  /** Names the legend and the fields of this form on its screen. */
  id: string;
  choice: ClaimChoice;
  /** Each kind's value as its field holds it (reais with their decimals). */
  typed: Partial<Record<string, string>>;
  /** The kinds of problem of the firm's modules (lib/modules/registry.ts), in their order. */
  kinds: readonly CaseKind[];
  disabled: boolean;
  onChoice: (choice: ClaimChoice) => void;
  onTyped: (incident: string, value: string) => void;
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
          {kinds.map((kind) => (
            <Grid key={kind.key} size={{ xs: 12, sm: 6 }}>
              <CurrencyField
                size="small"
                fullWidth
                id={`${id}-${kind.key}`}
                name={`${id}-${kind.key}`}
                label={t(kind.labelKey)}
                currencySymbol="R$"
                value={typed[kind.key] ?? ""}
                disabled={disabled}
                onChange={(event) => onTyped(kind.key, event.target.value)}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
