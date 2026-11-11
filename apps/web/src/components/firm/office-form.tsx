"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Grid, MenuItem, TextField, Typography } from "@mui/material";

import { CepField } from "@/components/product/fields";
import StateLine from "@/components/product/state-line";
import { UFS } from "@/lib/cases/cases";
import { saveFirmOffice } from "@/lib/firm/actions";
import { type FirmOffice, officeProblem } from "@/lib/firm/office";

const PROBLEM_KEY = {
  address: "office-error-address",
  society: "office-error-society",
  email: "office-error-email",
} as const;

/**
 * Where the firm is, as the power of attorney says it (migration 0217): the address, with the CEP filling the street,
 * the district, the city and the state; the professional e-mail; and the registration at the bar of a society of
 * lawyers. Saved through `set_firm_office`, by who manages the firm account. Shared by "Dados do escritório" and the
 * setup's step of the papers, which opens it over the step.
 */
export default function OfficeForm({
  office,
  disabled,
  onSaved,
}: {
  office: FirmOffice;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [values, setValues] = useState<FirmOffice>(office);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"saved" | "failed" | "not_authorized" | null>(null);
  const problem = officeProblem(values);
  const changed = (Object.keys(values) as (keyof FirmOffice)[]).some((key) => values[key] !== office[key]);
  const off = disabled || busy;

  const set = (field: keyof FirmOffice, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setStatus(null);
  };

  const save = async () => {
    if (problem || !changed || off) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveFirmOffice(values);
      if (result.ok) {
        setStatus("saved");
        onSaved();
      } else setStatus(result.code === "not_authorized" ? "not_authorized" : "failed");
    } catch {
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box className="flex flex-col gap-4">
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <CepField
            id="office-postal-code"
            label={t("office-postal-code")}
            value={values.postalCode}
            invalidMessage={t("office-postal-code-invalid")}
            onChange={(event) => set("postalCode", event.target.value)}
            onAddressFound={(address) =>
              setValues((current) => ({
                ...current,
                postalCode: address.postalCode || current.postalCode,
                street: address.street || current.street,
                district: address.district || current.district,
                city: address.city || current.city,
                uf: address.state || current.uf,
              }))
            }
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField
            id="office-street"
            label={t("office-street")}
            value={values.street}
            autoComplete="address-line1"
            onChange={(event) => set("street", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField
            id="office-number"
            label={t("office-number")}
            value={values.number}
            onChange={(event) => set("number", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <TextField
            id="office-complement"
            label={t("office-complement")}
            value={values.complement}
            autoComplete="address-line2"
            onChange={(event) => set("complement", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <TextField
            id="office-district"
            label={t("office-district")}
            value={values.district}
            onChange={(event) => set("district", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 8, sm: 9 }}>
          <TextField
            id="office-city"
            label={t("office-city")}
            value={values.city}
            autoComplete="address-level2"
            onChange={(event) => set("city", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 4, sm: 3 }}>
          <TextField
            id="office-uf"
            select
            label={t("office-uf")}
            value={values.uf}
            onChange={(event) => set("uf", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          >
            <MenuItem value="">{t("office-uf-none")}</MenuItem>
            {UFS.map((uf) => (
              <MenuItem key={uf} value={uf}>
                {uf}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={12}>
          <TextField
            id="office-email"
            type="email"
            label={t("office-email")}
            value={values.email}
            autoComplete="email"
            onChange={(event) => set("email", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
      </Grid>

      <Box className="flex flex-col gap-2">
        <Typography variant="subtitle2" component="h3" className="mb-0">
          {t("office-society")}
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 4, sm: 3 }}>
            <TextField
              id="office-society-uf"
              select
              label={t("office-society-uf")}
              value={values.societyUf}
              onChange={(event) => set("societyUf", event.target.value)}
              disabled={off}
              fullWidth
              size="small"
            >
              <MenuItem value="">{t("office-uf-none")}</MenuItem>
              {UFS.map((uf) => (
                <MenuItem key={uf} value={uf}>
                  {uf}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 8, sm: 5 }}>
            <TextField
              id="office-society-number"
              label={t("office-society-number")}
              value={values.societyNumber}
              inputMode="numeric"
              onChange={(event) => set("societyNumber", event.target.value)}
              helperText={t("office-society-help")}
              disabled={off}
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>
      </Box>

      {problem && changed ? <StateLine tone="attention">{t(PROBLEM_KEY[problem])}</StateLine> : null}
      {status === "saved" ? <StateLine tone="done">{t("office-saved")}</StateLine> : null}
      {status === "failed" ? <StateLine tone="failed">{t("office-error-failed")}</StateLine> : null}
      {status === "not_authorized" ? <StateLine tone="failed">{t("team-error-not-authorized")}</StateLine> : null}

      <Box>
        <Button variant="contained" onClick={() => void save()} disabled={off || !changed || problem !== null}>
          {busy ? t("team-working") : t("office-save")}
        </Button>
      </Box>
    </Box>
  );
}
