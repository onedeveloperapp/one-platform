"use client";

import type { CaseState } from "../case-types";
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

import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import { updateCase } from "@/lib/cases/actions";
import { caseErrorKey, CAUSE_KEY, CAUSES, ORIGIN_KEY, ORIGINS } from "@/lib/cases/cases";
import { opensOnArrival } from "@/lib/cases/sections";
import { caseKindLabelKey, caseKindsOf } from "@/lib/modules/registry";
import { formatDayBr } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

/**
 * What the case is about, as the firm records it: the incident, the airline
 * and the day of the flight, the cause as far as is known, how the client
 * came, who of the firm answers for it, and the firm's own note (never shown
 * to the client).
 */
export default function SummaryCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [editing, setEditing] = useState(false);
  const current = state.case;
  const airline = state.airlines.find((option) => option.iata === current.airlineIata)?.name ?? current.airlineIata;
  const responsible = state.team.find((member) => member.userId === current.responsibleId)?.name ?? null;
  const kindKey = caseKindLabelKey(current.incident);

  const facts: { label: string; value: string | null }[] = [
    { label: t("cases-field-incident"), value: kindKey ? t(kindKey) : null },
    { label: t("cases-field-airline"), value: airline },
    { label: t("cases-field-flight-date"), value: current.flightDate ? formatDayBr(current.flightDate) : null },
    { label: t("case-field-cause"), value: t(CAUSE_KEY[current.cause]) },
    { label: t("cases-field-origin"), value: current.origin ? t(ORIGIN_KEY[current.origin]) : null },
    { label: t("case-field-agency"), value: current.agency },
    { label: t("case-field-responsible"), value: responsible },
  ];

  return (
    <CollapsibleCard
      id="case-summary"
      title={t("case-summary-title")}
      summary={[kindKey ? t(kindKey) : null, airline, current.flightDate ? formatDayBr(current.flightDate) : null]
        .filter(Boolean)
        .join(" · ")}
      summaryClosedOnly
      action={
        writable ? (
          <Button variant="outlined" color="grey" size="small" onClick={() => setEditing(true)}>
            {t("client-edit")}
          </Button>
        ) : null
      }
      defaultOpen={opensOnArrival(state.case.status, "summary", false)}
      bodyClassName="gap-3"
    >
      <Box component="dl" className="m-0 flex flex-col gap-2">
        {facts
          .filter((fact) => fact.value)
          .map((fact) => (
            <Box key={fact.label} className="flex flex-col">
              <Typography variant="body2" component="dt" className="text-text-secondary">
                {fact.label}
              </Typography>
              <Typography variant="body1" component="dd" className="m-0">
                {fact.value}
              </Typography>
            </Box>
          ))}
      </Box>
      {current.summary && (
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="text-text-secondary">
            {t("case-field-summary")}
          </Typography>
          <Typography variant="body1" className="break-words whitespace-pre-line">
            {current.summary}
          </Typography>
        </Box>
      )}

      {editing && (
        <SummaryDialog
          state={state}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </CollapsibleCard>
  );
}

function SummaryDialog({ state, onClose, onSaved }: { state: Ready; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("product");
  const current = state.case;
  const start = {
    incident: current.incident as string,
    airline_iata: current.airlineIata ?? "",
    flight_date: current.flightDate ?? "",
    cause: current.cause as string,
    origin: current.origin ?? "",
    responsible_id: current.responsibleId ?? "",
    summary: current.summary ?? "",
  };
  const [values, setValues] = useState(start);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);
  const set = (field: keyof typeof start, value: string) => setValues((before) => ({ ...before, [field]: value }));
  const errorOf = (field: string) => (problem?.field === field ? t(caseErrorKey(problem.code)) : undefined);

  const submit = async () => {
    // Only what changed: the timeline names the fields that did.
    const changed = Object.fromEntries(
      (Object.keys(values) as (keyof typeof start)[])
        .filter((field) => values[field] !== start[field])
        .map((field) => [field, values[field] === "" ? null : values[field]]),
    );
    if (Object.keys(changed).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await updateCase(current.id, changed);
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    onSaved();
  };

  const select = (
    field: keyof typeof start,
    label: string,
    options: { value: string; label: string }[],
    empty: boolean,
  ) => (
    <TextField
      select
      fullWidth
      size="small"
      id={`case-summary-${field}`}
      label={label}
      value={values[field]}
      disabled={busy}
      error={Boolean(errorOf(field))}
      helperText={errorOf(field)}
      onChange={(event) => set(field, event.target.value)}
    >
      {empty && <MenuItem value="">{t("case-field-choose")}</MenuItem>}
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="case-summary-dialog">
      <DialogHeader
        id="case-summary-dialog"
        title={t("case-summary-title")}
        onClose={onClose}
        closeLabel={t("cases-close")}
      />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogContent>
          <Grid container spacing={2} className="pt-1">
            <Grid size={12}>
              {select(
                "incident",
                t("cases-field-incident"),
                caseKindsOf(current.module).map((kind) => ({ value: kind.key, label: t(kind.labelKey) })),
                false,
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 7 }}>
              {select(
                "airline_iata",
                t("cases-field-airline"),
                state.airlines.map((option) => ({ value: option.iata, label: option.name })),
                true,
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                id="case-summary-flight-date"
                label={t("cases-field-flight-date")}
                value={values.flight_date}
                disabled={busy}
                error={Boolean(errorOf("flight_date"))}
                helperText={errorOf("flight_date")}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(event) => set("flight_date", event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {select(
                "cause",
                t("case-field-cause"),
                CAUSES.map((value) => ({ value, label: t(CAUSE_KEY[value]) })),
                false,
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {select(
                "origin",
                t("cases-field-origin"),
                ORIGINS.map((value) => ({ value, label: t(ORIGIN_KEY[value]) })),
                true,
              )}
            </Grid>
            <Grid size={12}>
              {select(
                "responsible_id",
                t("case-field-responsible"),
                state.team.map((member) => ({ value: member.userId, label: member.name })),
                true,
              )}
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                size="small"
                id="case-summary-note"
                label={t("case-field-summary")}
                helperText={errorOf("summary") ?? t("case-field-summary-help")}
                error={Boolean(errorOf("summary"))}
                value={values.summary}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 4000 } }}
                onChange={(event) => set("summary", event.target.value)}
              />
            </Grid>
            {problem && !problem.field && (
              <Grid size={12}>
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {t(caseErrorKey(problem.code))}
                </Alert>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("cases-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("cases-working") : t("cases-save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
