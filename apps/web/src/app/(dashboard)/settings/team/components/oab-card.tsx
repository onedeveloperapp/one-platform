"use client";

import { teamErrorKey } from "../team-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  Input,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import NiScale from "@/icons/nexture/ni-scale";
import { addOabRegistration, removeOabRegistration } from "@/lib/firm/actions";
import { formatOab, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";

/** Digits and, in the sections that use one, the letter at the end: what the bar writes. */
const NUMBER_PATTERN = /^[0-9]{1,7}[A-Za-z]?$/;

const cleanNumber = (value: string) => value.replace(/[^0-9A-Za-z]/g, "");

/** The words of each kind of registration (`product` namespace). */
const KIND_LABEL_KEY: Record<OabRegistration["kind"], string> = {
  principal: "team-oab-principal",
  suplementar: "team-oab-suplementar",
};

/**
 * The person's own registrations at the bar. They belong to the lawyer, not to
 * the firm: what the courts publish is found by registration, and the count of
 * cases per state that calls for a supplementary one is per lawyer. One
 * principal, and any number of supplementary ones in other states.
 */
export default function OabCard({
  registrations,
  onChanged,
}: {
  registrations: OabRegistration[];
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const hasPrincipal = registrations.some((registration) => registration.kind === "principal");
  const [adding, setAdding] = useState(false);
  const [uf, setUf] = useState("");
  const [number, setNumber] = useState("");
  const [kind, setKind] = useState<"principal" | "suplementar">(hasPrincipal ? "suplementar" : "principal");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const taken = new Set(registrations.map((registration) => registration.uf));
  const numberOk = NUMBER_PATTERN.test(cleanNumber(number));
  const canSave = Boolean(uf) && numberOk;

  const startAdding = () => {
    setUf("");
    setNumber("");
    setKind(hasPrincipal ? "suplementar" : "principal");
    setTouched(false);
    setErrorCode(null);
    setAdding(true);
  };

  const save = async () => {
    setTouched(true);
    if (!canSave || busy) return;
    setBusy(true);
    setErrorCode(null);
    const result = await addOabRegistration({ uf, number: cleanNumber(number), kind });
    setBusy(false);
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    setAdding(false);
    onChanged();
  };

  const remove = async (registration: OabRegistration) => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    const result = await removeOabRegistration(registration.id);
    setBusy(false);
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    onChanged();
  };

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="team-oab">
        <CardContent className="flex flex-col gap-5">
          <Box className="flex flex-col gap-1">
            <Typography id="team-oab" variant="h5" component="h2" className="mb-0">
              {t("team-oab-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("team-oab-body")}
            </Typography>
          </Box>

          {registrations.length === 0 && !adding ? (
            <EmptyState
              icon={<NiScale size="large" />}
              title={t("team-oab-empty-title")}
              description={t("team-oab-empty-body")}
              action={{ label: t("team-oab-add"), onClick: startAdding }}
              className="py-10"
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {registrations.map((registration) => (
                <Box
                  component="li"
                  key={registration.id}
                  className="border-grey-100 flex flex-row flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
                >
                  <Typography variant="subtitle2" component="p" className="flex-1">
                    {formatOab(registration)}
                  </Typography>
                  <StatusChip
                    label={t(KIND_LABEL_KEY[registration.kind])}
                    tone={registration.kind === "principal" ? "primary" : "neutral"}
                  />
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    onClick={() => void remove(registration)}
                    disabled={busy}
                  >
                    {t("team-oab-remove")}
                  </Button>
                </Box>
              ))}
            </Box>
          )}

          {adding && (
            <Box className="flex flex-col gap-3">
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <FormControl fullWidth className="outlined" variant="standard" error={touched && !uf}>
                    <FormLabel component="label" htmlFor="team-oab-uf">
                      {t("team-oab-uf")}
                    </FormLabel>
                    <Select
                      id="team-oab-uf-select"
                      inputProps={{ id: "team-oab-uf" }}
                      value={uf}
                      displayEmpty
                      onChange={(event) => setUf(String(event.target.value))}
                      disabled={busy}
                    >
                      <MenuItem value="" disabled>
                        {t("team-oab-uf-placeholder")}
                      </MenuItem>
                      {OAB_STATES.map((state) => (
                        <MenuItem key={state} value={state} disabled={taken.has(state)}>
                          {state}
                        </MenuItem>
                      ))}
                    </Select>
                    {touched && !uf ? <FormHelperText>{t("team-oab-uf-required")}</FormHelperText> : null}
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 8 }}>
                  <FormControl
                    fullWidth
                    className="outlined"
                    variant="standard"
                    error={(touched || number.length > 0) && !numberOk}
                  >
                    <FormLabel component="label" htmlFor="team-oab-number">
                      {t("team-oab-number")}
                    </FormLabel>
                    <Input
                      id="team-oab-number"
                      value={number}
                      inputMode="numeric"
                      autoComplete="off"
                      onChange={(event) => setNumber(event.target.value)}
                      onBlur={() => setTouched(true)}
                      disabled={busy}
                      aria-describedby="team-oab-number-help"
                    />
                    <FormHelperText id="team-oab-number-help">
                      {(touched || number.length > 0) && !numberOk
                        ? t("team-error-oab-invalid")
                        : t("team-oab-number-help")}
                    </FormHelperText>
                  </FormControl>
                </Grid>
              </Grid>

              <FormControl component="fieldset">
                <FormLabel component="legend" id="team-oab-kind" className="mb-1">
                  {t("team-oab-kind")}
                </FormLabel>
                <RadioGroup
                  row
                  aria-labelledby="team-oab-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value === "principal" ? "principal" : "suplementar")}
                >
                  <FormControlLabel
                    value="principal"
                    disabled={busy || hasPrincipal}
                    control={<Radio size="small" />}
                    label={t("team-oab-principal")}
                  />
                  <FormControlLabel
                    value="suplementar"
                    disabled={busy}
                    control={<Radio size="small" />}
                    label={t("team-oab-suplementar")}
                  />
                </RadioGroup>
                <FormHelperText>{hasPrincipal ? t("team-oab-kind-help-has") : t("team-oab-kind-help")}</FormHelperText>
              </FormControl>
            </Box>
          )}

          {errorCode && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(teamErrorKey(errorCode))}
            </Alert>
          )}

          {adding ? (
            <Box className="flex flex-row gap-2">
              <Button variant="contained" onClick={() => void save()} disabled={busy}>
                {busy ? t("team-working") : t("team-oab-save")}
              </Button>
              <Button variant="text" color="grey" onClick={() => setAdding(false)} disabled={busy}>
                {t("team-cancel")}
              </Button>
            </Box>
          ) : registrations.length > 0 ? (
            <Box>
              <Button variant="outlined" color="grey" onClick={startAdding} disabled={busy}>
                {t("team-oab-add-another")}
              </Button>
            </Box>
          ) : null}
        </CardContent>
      </Card>
    </Grid>
  );
}
