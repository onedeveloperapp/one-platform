"use client";

import type { AirlineOption, NewCasePrefill } from "../cases-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import PersonFields from "@/components/cases/person-fields";
import DialogHeader from "@/components/product/dialog-header";
import { createCase } from "@/lib/cases/actions";
import { caseErrorKey, INCIDENT_KEY, INCIDENTS, ORIGIN_KEY, ORIGINS } from "@/lib/cases/cases";
import { personFields, type PersonValues, personValues } from "@/lib/cases/forms";

/** Who the client is, at the start: the rest they fill on their link. */
const FIRST_FIELDS = ["full_name", "cpf", "phone", "email"] as const;

/**
 * Opens a case: what happened, with which airline and when, and who the
 * client is. Only the name is needed to start; the client fills the rest on
 * their link, and the case opens right after so the next step (sending that
 * link) is one click away.
 */
export default function NewCaseDialog({
  airlines,
  prefill,
  onClose,
  onCreated,
}: {
  airlines: AirlineOption[];
  /** From a conversation: the client's name and number as WhatsApp gave them. */
  prefill: NewCasePrefill;
  onClose: () => void;
  onCreated: (caseId: string) => void;
}) {
  const t = useTranslations("product");
  const [client, setClient] = useState<PersonValues>(() =>
    personValues(prefill ? { full_name: prefill.name, phone: prefill.phone } : null),
  );
  const [incident, setIncident] = useState("");
  const [airline, setAirline] = useState("");
  const [flightDate, setFlightDate] = useState("");
  const [origin, setOrigin] = useState("");
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!incident) {
      setProblem({ code: "invalid_incident", field: "incident" });
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await createCase({
      incident,
      airline: airline || null,
      flightDate: flightDate || null,
      client: personFields(client, FIRST_FIELDS),
      origin: origin || null,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    onCreated(result.caseId);
  };

  const fieldError = (field: string) => (problem?.field === field ? t(caseErrorKey(problem.code)) : undefined);
  const personError =
    problem?.field && (FIRST_FIELDS as readonly string[]).includes(problem.field) ? problem.field : null;

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="new-case-dialog">
      <DialogHeader id="new-case-dialog" title={t("cases-new-title")} onClose={onClose} closeLabel={t("cases-close")} />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogContent>
          <Box className="flex flex-col gap-5">
            <Box className="flex flex-col gap-3">
              <Typography variant="subtitle2" component="h3">
                {t("cases-new-what")}
              </Typography>
              <Grid container spacing={2}>
                <Grid size={12}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    id="new-case-incident"
                    label={t("cases-field-incident")}
                    value={incident}
                    required
                    disabled={busy}
                    error={Boolean(fieldError("incident"))}
                    helperText={fieldError("incident")}
                    onChange={(event) => setIncident(event.target.value)}
                  >
                    {INCIDENTS.map((value) => (
                      <MenuItem key={value} value={value}>
                        {t(INCIDENT_KEY[value])}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 7 }}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    id="new-case-airline"
                    label={t("cases-field-airline")}
                    value={airline}
                    disabled={busy}
                    error={Boolean(fieldError("airline"))}
                    helperText={fieldError("airline")}
                    onChange={(event) => setAirline(event.target.value)}
                  >
                    <MenuItem value="">{t("case-field-choose")}</MenuItem>
                    {airlines.map((option) => (
                      <MenuItem key={option.iata} value={option.iata}>
                        {option.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 5 }}>
                  <TextField
                    fullWidth
                    size="small"
                    type="date"
                    id="new-case-flight-date"
                    label={t("cases-field-flight-date")}
                    value={flightDate}
                    disabled={busy}
                    error={Boolean(fieldError("flight_date"))}
                    helperText={fieldError("flight_date")}
                    slotProps={{ inputLabel: { shrink: true } }}
                    onChange={(event) => setFlightDate(event.target.value)}
                  />
                </Grid>
                <Grid size={12}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    id="new-case-origin"
                    label={t("cases-field-origin")}
                    value={origin}
                    disabled={busy}
                    onChange={(event) => setOrigin(event.target.value)}
                  >
                    <MenuItem value="">{t("case-field-choose")}</MenuItem>
                    {ORIGINS.map((value) => (
                      <MenuItem key={value} value={value}>
                        {t(ORIGIN_KEY[value])}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
              </Grid>
            </Box>

            <Box className="flex flex-col gap-3">
              <Typography variant="subtitle2" component="h3">
                {t("cases-new-client")}
              </Typography>
              <PersonFields
                idPrefix="new-case-client"
                values={client}
                shown={FIRST_FIELDS}
                onChange={setClient}
                errorField={personError}
                errorText={problem ? t(caseErrorKey(problem.code)) : null}
                disabled={busy}
              />
              <Typography variant="body2" className="text-text-secondary">
                {t("cases-new-client-help")}
              </Typography>
            </Box>

            {problem && !problem.field && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {t(caseErrorKey(problem.code))}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("cases-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("cases-working") : t("cases-new-submit")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
