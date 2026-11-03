"use client";

import { PassengerMultiPicker } from "./passenger-picker";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Grid,
  TextField,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import NiTicket from "@/icons/nexture/ni-ticket";
import { attachTripDocuments, readDocumentLegs, saveTrip } from "@/modules/direito-do-passageiro/agency/actions";
import FileButton from "@/modules/direito-do-passageiro/agency/file-button";
import {
  type DocumentLegs,
  emptyLeg,
  legsForSave,
  paxErrorKey,
  type PaxLegForm,
  type PaxPerson,
  type PaxTrip,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { sendAgencyFile } from "@/modules/direito-do-passageiro/agency/send-files";

const MOST_LEGS = 6;
/** How often the dialog asks what ONE read of the trip's document, and for how long before it lets typing go on. */
const LOOK_EVERY_MS = 2500;
const LOOK_FOR_MS = 3 * 60 * 1000;
/** After how long a reading on its way also offers typing. */
const SLOW_AFTER_MS = 30 * 1000;

/** A new trip starts from its document; one being read waits for ONE; the form is the trip, read or typed. */
type Stage = "document" | "reading" | "form";
/** What came of the document's reading, for the form: ONE's legs, none, or a reading that took too long. */
type Outcome = DocumentLegs | { state: "late" };

/**
 * A trip of the partnership: its holder (the adult the alerts go to, and who agrees for it), who travels along,
 * its locator and every leg, in the local times the ticket prints. ONE follows its flights once the holder agrees.
 * A new trip starts from its document (the ticket, the boarding pass, a screenshot of the booking or a photo of a
 * printed one, migration 0083): ONE reads its legs and locator into the form for the agency to confirm, and the
 * document joins the trip once it is saved. Typing is the contingency.
 */
export default function TripDialog({
  trip,
  holder,
  documentId = null,
  onClose,
  onSaved,
}: {
  /** The trip to change, or null for a new one. */
  trip: PaxTrip | null;
  holder: PaxPerson;
  /** A document of the trip the agency already sent (a new passenger's ticket): its legs are read, never asked for. */
  documentId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [stage, setStage] = useState<Stage>(trip ? "form" : documentId ? "reading" : "document");
  // The document being read, and every document of the trip sent here, which join it once it is saved.
  const [reading, setReading] = useState<string | null>(trip ? null : documentId);
  const [documents, setDocuments] = useState<string[]>(() => (!trip && documentId ? [documentId] : []));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sending, setSending] = useState(false);
  const [sendProblem, setSendProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
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

  // While ONE reads the document, the dialog asks for its legs; what came of it fills the form, which the agency
  // confirms. A reading that takes too long lets the agency type, the document still joining the trip.
  useEffect(() => {
    if (stage !== "reading" || !reading) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const settle = (next: Outcome) => {
      setOutcome(next);
      if (next.state === "read") {
        setLegs(next.legs.slice(0, MOST_LEGS));
        if (next.locator) setLocator(next.locator);
      }
      setStage("form");
    };
    const look = async () => {
      const answer = await readDocumentLegs(reading);
      if (!live) return;
      if (answer.ok && answer.legs.state !== "reading") return settle(answer.legs);
      if (Date.now() - started > LOOK_FOR_MS) return settle({ state: "late" });
      timer = setTimeout(() => void look(), LOOK_EVERY_MS);
    };
    timer = setTimeout(() => void look(), 0);
    const slowTimer = setTimeout(() => {
      if (live) setSlow(true);
    }, SLOW_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(slowTimer);
    };
  }, [stage, reading]);

  const send = async (file: File) => {
    setSending(true);
    setSendProblem(null);
    const sent = await sendAgencyFile(file, { travelerId: holder.id, kind: "ticket", tripId: null });
    setSending(false);
    if (!sent.ok || !sent.documentId) {
      const code = sent.ok ? "failed" : sent.code;
      setSendProblem(t(paxErrorKey(code)));
      return;
    }
    const sentId = sent.documentId;
    setDocuments((current) => [...current, sentId]);
    setReading(sentId);
    setOutcome(null);
    setSlow(false);
    setStage("reading");
  };

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
    if (!result.ok) {
      setBusy(false);
      setProblem({ code: result.code, field: result.field, position: result.position });
      return;
    }
    // The documents the trip came from are the trip's now; one that could not join stays with its passenger.
    if (documents.length > 0) await attachTripDocuments(result.tripId, documents);
    setBusy(false);
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

  // What the form came from, said above it: ONE's reading (and that ONE may err), what it could not read, or a wait.
  const sendOther = (
    <FileButton
      variant="outlined"
      color="grey"
      size="small"
      disabled={sending || busy}
      label={sending ? t("pax-document-sending") : t("pax-trip-send-other")}
      onFile={(file) => void send(file)}
    />
  );
  const banner =
    outcome === null ? null : outcome.state === "read" ? (
      <Alert severity={outcome.clean ? "info" : "warning"} className={outcome.clean ? "neutral" : undefined}>
        {outcome.clean ? t("pax-trip-read-ok") : t("pax-trip-read-review")}
      </Alert>
    ) : (
      <Alert severity="warning" action={sendOther}>
        {outcome.state === "late"
          ? t("pax-trip-read-late")
          : [t("pax-trip-read-none"), outcome.state === "none" ? outcome.note : null].filter(Boolean).join(" ")}
      </Alert>
    );

  return (
    <Dialog
      open
      onClose={busy || sending ? undefined : onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="pax-trip-dialog"
    >
      <DialogHeader
        id="pax-trip-dialog"
        title={trip ? t("pax-trip-edit-title") : t("pax-trip-new-title")}
        onClose={onClose}
        closeLabel={t("pax-close")}
      />
      {stage === "document" && (
        <>
          <DialogContent>
            <Box className="flex flex-col items-center gap-4 py-4 text-center">
              <Box className={`${TILE_TONE.secondary.bg} flex items-center justify-center rounded-2xl p-3`}>
                <NiTicket size="large" className={TILE_TONE.secondary.text} />
              </Box>
              <Typography variant="h6" component="p" className="mb-0">
                {t("pax-trip-docs-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary max-w-lg">
                {t("pax-trip-docs-body", { name: holder.fullName })}
              </Typography>
              <FileButton
                variant="contained"
                disabled={sending}
                label={sending ? t("pax-document-sending") : t("pax-trip-docs-send")}
                onFile={(file) => void send(file)}
              />
              {sendProblem && (
                <Alert severity="error" className="w-full text-left">
                  {sendProblem}
                </Alert>
              )}
            </Box>
          </DialogContent>
          <DialogActions className="justify-between">
            <Button
              variant="text"
              color="grey"
              startIcon={<NiKeyboard size="small" />}
              disabled={sending}
              onClick={() => setStage("form")}
            >
              {t("pax-trip-manual")}
            </Button>
            <Button variant="text" color="grey" onClick={onClose} disabled={sending}>
              {t("pax-cancel")}
            </Button>
          </DialogActions>
        </>
      )}
      {stage === "reading" && (
        <>
          <DialogContent>
            <Box className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
              <CircularProgress size={32} aria-hidden />
              <Typography variant="body1" className="mb-0">
                {t("pax-trip-reading")}
              </Typography>
              {slow && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("pax-trip-reading-slow")}
                </Typography>
              )}
            </Box>
          </DialogContent>
          <DialogActions className="justify-between">
            <Button
              variant="text"
              color="grey"
              startIcon={<NiKeyboard size="small" />}
              onClick={() => {
                setOutcome({ state: "late" });
                setStage("form");
              }}
            >
              {t("pax-trip-manual")}
            </Button>
            <Button variant="text" color="grey" onClick={onClose}>
              {t("pax-cancel")}
            </Button>
          </DialogActions>
        </>
      )}
      {stage === "form" && (
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
              {banner}
              {sendProblem && <Alert severity="error">{sendProblem}</Alert>}
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
      )}
    </Dialog>
  );
}
