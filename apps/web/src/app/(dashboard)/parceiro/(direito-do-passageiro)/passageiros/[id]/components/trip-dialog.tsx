"use client";

import { PassengerMultiPicker } from "./passenger-picker";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Grid, TextField, Typography } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import { saveTrip } from "@/modules/direito-do-passageiro/agency/actions";
import {
  emptyLeg,
  legsForSave,
  paxErrorKey,
  type PaxLegForm,
  type PaxPerson,
  type PaxTrip,
} from "@/modules/direito-do-passageiro/agency/passengers";

const MOST_LEGS = 6;

/**
 * A trip of the partnership: its holder (the adult the alerts go to, and who agrees for it), who travels along,
 * its locator and every leg, in the local times the ticket prints. ONE follows its flights once the holder agrees.
 */
export default function TripDialog({
  trip,
  holder,
  onClose,
  onSaved,
}: {
  /** The trip to change, or null for a new one. */
  trip: PaxTrip | null;
  holder: PaxPerson;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [travelers, setTravelers] = useState<PaxPerson[]>(
    () => trip?.travelers.filter((person) => person.id !== holder.id) ?? [],
  );
  const [locator, setLocator] = useState(trip?.locator ?? "");
  const [legs, setLegs] = useState<PaxLegForm[]>(() =>
    trip && trip.legs.length > 0
      ? trip.legs.map((leg) => ({
          flightNumber: leg.flightNumber,
          originIata: leg.originIata,
          destinationIata: leg.destinationIata,
          departure: leg.departure,
          arrival: leg.arrival,
        }))
      : [emptyLeg()],
  );
  const [problem, setProblem] = useState<{ code: string; field?: string | null; position?: number | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const setLeg = (index: number, patch: Partial<PaxLegForm>) =>
    setLegs((current) => current.map((leg, at) => (at === index ? { ...leg, ...patch } : leg)));

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await saveTrip({
      tripId: trip?.id ?? null,
      holderId: holder.id,
      travelerIds: travelers.map((person) => person.id),
      locator,
      legs: legsForSave(legs),
    });
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field, position: result.position });
      return;
    }
    onSaved();
  };

  const legProblem = (index: number) => (problem?.position === index + 1 ? t(paxErrorKey(problem.code)) : undefined);
  const travelersProblem = problem?.field === "travelers" ? t(paxErrorKey(problem.code)) : null;
  const generalProblem =
    problem && !problem.position && problem.field !== "locator" && problem.field !== "travelers"
      ? t(paxErrorKey(problem.code))
      : null;
  const complete = legs.every(
    (leg) =>
      leg.flightNumber.trim() && leg.originIata.trim() && leg.destinationIata.trim() && leg.departure && leg.arrival,
  );

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="pax-trip-dialog">
      <DialogHeader
        id="pax-trip-dialog"
        title={trip ? t("pax-trip-edit-title") : t("pax-trip-new-title")}
        onClose={onClose}
        closeLabel={t("pax-close")}
      />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (complete && !busy) void submit();
        }}
      >
        <DialogContent>
          <Box className="flex flex-col gap-5">
            <Typography variant="body2" className="text-text-secondary">
              {t("pax-trip-holder", { name: holder.fullName })}
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 8 }}>
                <PassengerMultiPicker
                  id="pax-trip-travelers"
                  label={t("pax-trip-travelers")}
                  helperText={travelersProblem ?? t("pax-trip-travelers-help")}
                  error={Boolean(travelersProblem)}
                  value={travelers}
                  exclude={[holder.id]}
                  disabled={busy}
                  onChange={setTravelers}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  id="pax-trip-locator"
                  label={t("pax-trip-locator")}
                  value={locator}
                  size="small"
                  fullWidth
                  disabled={busy}
                  error={problem?.field === "locator"}
                  helperText={problem?.field === "locator" ? t(paxErrorKey(problem.code)) : undefined}
                  slotProps={{ htmlInput: { maxLength: 8, autoCapitalize: "characters" } }}
                  onChange={(event) => setLocator(event.target.value.toUpperCase())}
                />
              </Grid>
            </Grid>

            <Box component="ol" className="m-0 flex list-none flex-col gap-4 p-0">
              {legs.map((leg, index) => (
                <Box
                  component="li"
                  key={index}
                  className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4"
                  aria-label={t("pax-trip-leg", { position: index + 1 })}
                >
                  <Box className="flex items-center justify-between gap-2">
                    <Typography variant="subtitle2" component="h3">
                      {t("pax-trip-leg", { position: index + 1 })}
                    </Typography>
                    {legs.length > 1 && (
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        disabled={busy}
                        onClick={() => setLegs((current) => current.filter((_, at) => at !== index))}
                      >
                        {t("pax-trip-leg-remove")}
                      </Button>
                    )}
                  </Box>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        id={`pax-leg-${index}-flight`}
                        label={t("pax-trip-flight")}
                        value={leg.flightNumber}
                        size="small"
                        fullWidth
                        required
                        disabled={busy}
                        error={Boolean(legProblem(index))}
                        helperText={legProblem(index)}
                        slotProps={{ htmlInput: { maxLength: 8, autoCapitalize: "characters" } }}
                        onChange={(event) => setLeg(index, { flightNumber: event.target.value.toUpperCase() })}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <TextField
                        id={`pax-leg-${index}-origin`}
                        label={t("pax-trip-origin")}
                        value={leg.originIata}
                        size="small"
                        fullWidth
                        required
                        disabled={busy}
                        slotProps={{ htmlInput: { maxLength: 3, autoCapitalize: "characters" } }}
                        onChange={(event) => setLeg(index, { originIata: event.target.value.toUpperCase() })}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <TextField
                        id={`pax-leg-${index}-destination`}
                        label={t("pax-trip-destination")}
                        value={leg.destinationIata}
                        size="small"
                        fullWidth
                        required
                        disabled={busy}
                        slotProps={{ htmlInput: { maxLength: 3, autoCapitalize: "characters" } }}
                        onChange={(event) => setLeg(index, { destinationIata: event.target.value.toUpperCase() })}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        id={`pax-leg-${index}-departure`}
                        type="datetime-local"
                        label={t("pax-trip-departure")}
                        value={leg.departure}
                        size="small"
                        fullWidth
                        required
                        disabled={busy}
                        slotProps={{ inputLabel: { shrink: true } }}
                        onChange={(event) => setLeg(index, { departure: event.target.value })}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        id={`pax-leg-${index}-arrival`}
                        type="datetime-local"
                        label={t("pax-trip-arrival")}
                        value={leg.arrival}
                        size="small"
                        fullWidth
                        required
                        disabled={busy}
                        slotProps={{ inputLabel: { shrink: true } }}
                        onChange={(event) => setLeg(index, { arrival: event.target.value })}
                      />
                    </Grid>
                  </Grid>
                </Box>
              ))}
            </Box>
            <Typography variant="body2" className="text-text-secondary">
              {t("pax-trip-times-help")}
            </Typography>
            {legs.length < MOST_LEGS && (
              <Box>
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={busy}
                  onClick={() => setLegs((current) => [...current, emptyLeg()])}
                >
                  {t("pax-trip-leg-add")}
                </Button>
              </Box>
            )}
            {generalProblem && <Alert severity="error">{generalProblem}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("pax-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !complete}>
            {busy ? t("pax-saving") : t("pax-trip-save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
