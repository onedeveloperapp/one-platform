"use client";

import { PassengerPicker } from "../[id]/components/passenger-picker";
import TripDialog from "../[id]/components/trip-dialog";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Typography,
} from "@mui/material";

import PersonFields from "@/components/cases/person-fields";
import DialogHeader from "@/components/product/dialog-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiHome from "@/icons/nexture/ni-home";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import NiTicket from "@/icons/nexture/ni-ticket";
import {
  emptyPerson,
  PERSON_FIELDS,
  type PersonField,
  personFields,
  type PersonValues,
  personValues,
} from "@/lib/cases/forms";
import {
  attachTripDocuments,
  confirmPassenger,
  readDocumentLegs,
  readPassengerDraft,
  savePassenger,
  saveTrip,
  startPassengerDraft,
} from "@/modules/direito-do-passageiro/agency/actions";
import FileButton from "@/modules/direito-do-passageiro/agency/file-button";
import {
  DOCUMENT_KIND_KEY,
  type DocumentLegs,
  legsForSave,
  localTimeLabel,
  PAX_ADULT_FORM,
  PAX_MINOR_FORM,
  type PaxDetail,
  type PaxDocument,
  type PaxDocumentKind,
  paxErrorKey,
  type PaxPerson,
  paxPersonData,
  READING_KEY,
  READING_STATES,
  readingErrorKey,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { sendAgencyFile } from "@/modules/direito-do-passageiro/agency/send-files";
import { isMinorOn } from "@flyee/rules/person";

/** Who the passenger is, typed: the contingency, when the documents are not at hand. */
const FIRST_FIELDS: readonly PersonField[] = ["full_name", "cpf", "birth_date", "phone", "email"];

/** The documents a passenger starts from, each read by ONE: who they are, where they live, and their trip. */
type Slot = "identity" | "address" | "trip";
const SLOTS: readonly Slot[] = ["identity", "address", "trip"];
const SLOT_KIND: Record<Slot, PaxDocumentKind> = { identity: "identity", address: "address_proof", trip: "ticket" };
const SLOT_WORDS: Record<Slot, { title: string; hint: string }> = {
  identity: { title: "pax-new-slot-identity", hint: "pax-new-slot-identity-hint" },
  address: { title: "pax-new-slot-address", hint: "pax-new-slot-address-hint" },
  trip: { title: "pax-new-slot-trip", hint: "pax-new-slot-trip-hint" },
};
const SLOT_ICON: Record<Slot, ReactNode> = {
  identity: <NiDocumentFull size="medium" className={TILE_TONE.secondary.text} />,
  address: <NiHome size="medium" className={TILE_TONE.secondary.text} />,
  trip: <NiTicket size="medium" className={TILE_TONE.secondary.text} />,
};

/** How often the dialog asks what ONE read, for how long, and after how long a reading on its way lets it go on. */
const LOOK_EVERY_MS = 2500;
const LOOK_FOR_MS = 4 * 60 * 1000;
const SLOW_AFTER_MS = 45 * 1000;

const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** The draft's record as the form holds it; the name only once the identity gave one (it starts under no person's). */
function draftValues(detail: PaxDetail | null): PersonValues {
  if (!detail) return emptyPerson();
  const values = personValues(paxPersonData(detail.traveler));
  if (!detail.traveler.readFields.includes("full_name")) values.full_name = "";
  return values;
}

type Translate = ReturnType<typeof useTranslations>;

/** Where one document stands, as a chip and a sentence: on its way, being read, read (and what), or not read. */
function slotState(
  t: Translate,
  document: PaxDocument | null,
  slot: Slot,
): { label: string; tone: StatusTone; sentence: string | null } {
  if (!document || document.reading === "pending" || document.reading === "working") {
    const reading = document?.reading ?? READING_STATES[0];
    return { label: t(READING_KEY[reading]), tone: "info", sentence: null };
  }
  if (document.reading === "failed") {
    return { label: t(READING_KEY.failed), tone: "attention", sentence: t(readingErrorKey(document.readingError)) };
  }
  const read = document.read;
  if (read?.legible === false) {
    return {
      label: t(READING_KEY.done),
      tone: "attention",
      sentence: [t("pax-read-illegible"), read.note].filter(Boolean).join(" "),
    };
  }
  const kind = t(DOCUMENT_KIND_KEY[SLOT_KIND[slot]]);
  return {
    label: t(READING_KEY.done),
    tone: "positive",
    sentence: read ? t("pax-read-ok", { identified: read.identified || kind }) : null,
  };
}

/**
 * Adds a passenger to the partnership from their documents (the owner's premise of 2026-11-03, migration 0083): the
 * agency sends the identity, and if it has them the proof of address and the trip's ticket (a screenshot of the
 * booking or a photo of a printed one will do); ONE reads each into a draft, the agency confirms what ONE read and
 * adds what no document carries, and the trip read from the ticket is registered with it. Typing everything stays,
 * as the contingency ("Preencher à mão").
 */
export default function NewPassengerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (travelerId: string) => void;
}) {
  const t = useTranslations("product");
  const today = useMemo(todayInBrazil, []);
  const [phase, setPhase] = useState<"documents" | "confirm" | "manual">("documents");

  // ---- The documents, sent to a draft started at the first one.
  const draft = useRef<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [sent, setSent] = useState<Partial<Record<Slot, { documentId: string; name: string }>>>({});
  const [sending, setSending] = useState<Slot | null>(null);
  const [sendProblem, setSendProblem] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaxDetail | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; fullName: string } | null>(null);
  const [legs, setLegs] = useState<DocumentLegs | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [slowSince, setSlowSince] = useState<number | null>(null);

  const documentOf = (slot: Slot): PaxDocument | null =>
    detail?.documents.find((document) => document.id === sent[slot]?.documentId) ?? null;
  const readingNow = SLOTS.some((slot) => {
    if (!sent[slot]) return false;
    const document = documentOf(slot);
    return !document || document.reading === "pending" || document.reading === "working";
  });
  const slow = readingNow && since !== null && slowSince === since;
  const anySent = SLOTS.some((slot) => sent[slot]);

  const look = useCallback(async (id: string) => {
    const answer = await readPassengerDraft(id);
    if (!answer.ok) return;
    setDetail(answer.detail);
    setDuplicate(answer.duplicate);
  }, []);

  // While ONE reads what was sent, the dialog asks what it read, for a while; then it lets the agency go on.
  useEffect(() => {
    if (!draftId || !readingNow || since === null) return;
    const timer = setInterval(() => {
      if (Date.now() - since <= LOOK_FOR_MS) void look(draftId);
    }, LOOK_EVERY_MS);
    const slowTimer = setTimeout(() => setSlowSince(since), Math.max(0, since + SLOW_AFTER_MS - Date.now()));
    return () => {
      clearInterval(timer);
      clearTimeout(slowTimer);
    };
  }, [draftId, readingNow, since, look]);

  // The trip's legs, once ONE read its document.
  const tripSent = sent.trip?.documentId ?? null;
  const tripReading = documentOf("trip")?.reading ?? null;
  useEffect(() => {
    if (!tripSent || (tripReading !== "done" && tripReading !== "failed")) return;
    let live = true;
    void readDocumentLegs(tripSent).then((answer) => {
      if (live && answer.ok) setLegs(answer.legs);
    });
    return () => {
      live = false;
    };
  }, [tripSent, tripReading]);

  const send = async (slot: Slot, file: File) => {
    setSending(slot);
    setSendProblem(null);
    let id = draft.current;
    if (!id) {
      const started = await startPassengerDraft();
      if (!started.ok) {
        setSending(null);
        setSendProblem(t(paxErrorKey(started.code)));
        return;
      }
      id = started.travelerId;
      draft.current = id;
      setDraftId(id);
    }
    const result = await sendAgencyFile(file, { travelerId: id, kind: SLOT_KIND[slot], tripId: null });
    setSending(null);
    if (!result.ok || !result.documentId) {
      const code = result.ok ? "failed" : result.code;
      setSendProblem(t(paxErrorKey(code)));
      return;
    }
    const documentId = result.documentId;
    setSent((current) => ({ ...current, [slot]: { documentId, name: file.name } }));
    if (slot === "trip") setLegs(null);
    setSince(Date.now());
    void look(id);
  };

  // ---- The confirmation: what ONE read, with what the agency wrote over it.
  const [edits, setEdits] = useState<Partial<Record<PersonField, string>>>({});
  const base = useMemo(() => draftValues(detail), [detail]);
  const values = useMemo(() => ({ ...base, ...edits }) as PersonValues, [base, edits]);
  const read = useMemo(
    () => new Set<PersonField>((detail?.traveler.readFields ?? []).filter((field) => !(field in edits))),
    [detail, edits],
  );
  const [guardian, setGuardian] = useState<PaxPerson | null>(null);
  const [withTrip, setWithTrip] = useState(true);
  const [problem, setProblem] = useState<{ code: string; field?: string | null; holderId?: string | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [tripFor, setTripFor] = useState<{ holder: PaxPerson; documentId: string } | null>(null);
  const minor = isMinorOn(values.birth_date || null, today) === true;
  const shown = minor ? PAX_MINOR_FORM : PAX_ADULT_FORM;

  const change = (next: PersonValues) =>
    setEdits((current) => {
      const out = { ...current };
      for (const field of PERSON_FIELDS) if (next[field] !== values[field]) out[field] = next[field];
      return out;
    });

  const confirm = async () => {
    if (!draftId) return;
    setBusy(true);
    setProblem(null);
    // The name, and what the agency wrote: what ONE read and nobody touched stays as read, with its mark.
    const result = await confirmPassenger({
      travelerId: draftId,
      fields: personFields(
        values,
        shown.filter((field) => field === "full_name" || field in edits),
      ),
      guardianId: minor ? (guardian?.id ?? null) : null,
    });
    if (!result.ok) {
      setBusy(false);
      setProblem({ code: result.code, field: result.field, holderId: result.holderId });
      return;
    }
    const holder = { id: result.travelerId, fullName: values.full_name.trim() };
    if (sent.trip && withTrip && !minor) {
      if (legs?.state === "read" && legs.clean) {
        const trip = await saveTrip({
          tripId: null,
          holderId: holder.id,
          travelerIds: [],
          locator: legs.locator,
          legs: legsForSave(legs.legs),
        });
        if (trip.ok) {
          await attachTripDocuments(trip.tripId, [sent.trip.documentId]);
          onCreated(holder.id);
          return;
        }
      }
      // A trip ONE could not read whole, or that its checks refused, opens for the agency to correct.
      setBusy(false);
      setTripFor({ holder, documentId: sent.trip.documentId });
      return;
    }
    onCreated(holder.id);
  };

  // ---- Typing, the contingency.
  const [manual, setManual] = useState<PersonValues>(emptyPerson);
  const saveByHand = async () => {
    setBusy(true);
    setProblem(null);
    const result = await savePassenger({
      travelerId: null,
      fields: personFields(manual, FIRST_FIELDS),
      guardianId: null,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    onCreated(result.travelerId);
  };

  if (tripFor) {
    return (
      <TripDialog
        trip={null}
        holder={tripFor.holder}
        documentId={tripFor.documentId}
        onClose={() => onCreated(tripFor.holder.id)}
        onSaved={() => onCreated(tripFor.holder.id)}
      />
    );
  }

  const fieldsShown = phase === "manual" ? FIRST_FIELDS : shown;
  const fieldProblem =
    problem?.field && (fieldsShown as readonly string[]).includes(problem.field) ? problem.field : null;
  const nothingRead = detail !== null && !readingNow && detail.traveler.readFields.length === 0;

  return (
    <Dialog
      open
      onClose={busy || sending ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="pax-new-dialog"
    >
      <DialogHeader id="pax-new-dialog" title={t("pax-new-title")} onClose={onClose} closeLabel={t("pax-close")} />

      {phase === "documents" && (
        <>
          <DialogContent>
            <Box className="flex flex-col gap-4">
              <Typography variant="body2" className="text-text-secondary">
                {t("pax-new-docs-intro")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                {SLOTS.map((slot) => {
                  const was = sent[slot];
                  const state = was ? slotState(t, documentOf(slot), slot) : null;
                  return (
                    <Box
                      component="li"
                      key={slot}
                      className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
                    >
                      <Box className="flex min-w-0 flex-1 items-start gap-3">
                        <Box
                          className={`${TILE_TONE.secondary.bg} flex size-10 shrink-0 items-center justify-center rounded-xl`}
                        >
                          {SLOT_ICON[slot]}
                        </Box>
                        <Box className="flex min-w-0 flex-1 flex-col gap-1">
                          <Box className="flex flex-wrap items-center gap-2">
                            <Typography variant="subtitle2" component="h3" className="mb-0">
                              {t(SLOT_WORDS[slot].title)}
                            </Typography>
                            {sending === slot ? (
                              <StatusChip label={t("pax-document-sending")} tone="info" />
                            ) : (
                              state && <StatusChip label={state.label} tone={state.tone} />
                            )}
                          </Box>
                          <Typography variant="body2" className="text-text-secondary">
                            {state?.sentence ?? t(SLOT_WORDS[slot].hint)}
                          </Typography>
                          {was && (
                            <Typography variant="caption" className="text-text-secondary truncate">
                              {was.name}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                      <FileButton
                        variant={slot === "identity" && !was ? "contained" : "outlined"}
                        color={slot === "identity" && !was ? "primary" : "grey"}
                        size="small"
                        disabled={sending !== null}
                        label={
                          sending === slot
                            ? t("pax-document-sending")
                            : was
                              ? t("pax-new-slot-again")
                              : t("pax-new-slot-send")
                        }
                        aria-label={`${was ? t("pax-new-slot-again") : t("pax-new-slot-send")}: ${t(SLOT_WORDS[slot].title)}`}
                        onFile={(file) => void send(slot, file)}
                      />
                    </Box>
                  );
                })}
              </Box>
              {sendProblem && <Alert severity="error">{sendProblem}</Alert>}
              {readingNow && (
                <Box role="status" aria-live="polite" className="text-text-secondary flex items-center gap-2">
                  <CircularProgress size={16} aria-hidden />
                  <Typography variant="body2" className="mb-0">
                    {slow ? t("pax-new-slow") : t("pax-new-waiting")}
                  </Typography>
                </Box>
              )}
            </Box>
          </DialogContent>
          <DialogActions className="flex-wrap justify-between gap-2">
            {anySent ? (
              <span />
            ) : (
              <Button
                variant="text"
                color="grey"
                startIcon={<NiKeyboard size="small" />}
                disabled={sending !== null}
                onClick={() => {
                  setProblem(null);
                  setPhase("manual");
                }}
              >
                {t("pax-new-manual")}
              </Button>
            )}
            <Box className="flex gap-2">
              <Button variant="text" color="grey" onClick={onClose} disabled={sending !== null}>
                {t("pax-cancel")}
              </Button>
              <Button
                variant="contained"
                disabled={!anySent || sending !== null || (readingNow && !slow) || !detail}
                onClick={() => {
                  setProblem(null);
                  setPhase("confirm");
                }}
              >
                {readingNow ? t("pax-new-continue-anyway") : t("pax-new-continue")}
              </Button>
            </Box>
          </DialogActions>
        </>
      )}

      {phase === "confirm" && (
        <Box
          component="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && values.full_name.trim() !== "") void confirm();
          }}
        >
          <DialogContent>
            <Box className="flex flex-col gap-4">
              <Alert severity="info" className="neutral">
                {nothingRead ? t("pax-new-confirm-nothing") : t("pax-new-confirm-intro")}
              </Alert>
              {duplicate && (
                <Alert
                  severity="warning"
                  action={
                    <Button color="inherit" size="small" onClick={() => onCreated(duplicate.id)}>
                      {t("pax-new-duplicate-open", { name: duplicate.fullName })}
                    </Button>
                  }
                >
                  {t("pax-new-duplicate", { name: duplicate.fullName })}
                </Alert>
              )}
              {readingNow && (
                <Box role="status" aria-live="polite" className="text-text-secondary flex items-center gap-2">
                  <CircularProgress size={16} aria-hidden />
                  <Typography variant="body2" className="mb-0">
                    {t("pax-new-still-reading")}
                  </Typography>
                </Box>
              )}
              <PersonFields
                idPrefix="pax-new"
                values={values}
                shown={shown}
                onChange={change}
                errorField={fieldProblem}
                errorText={problem ? t(paxErrorKey(problem.code)) : null}
                disabled={busy}
                read={read}
              />
              {minor && (
                <PassengerPicker
                  id="pax-new-guardian"
                  label={t("pax-person-guardian")}
                  helperText={t("pax-person-guardian-help")}
                  value={guardian}
                  adultsOnly
                  disabled={busy}
                  onChange={setGuardian}
                />
              )}
              {sent.trip && (
                <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
                  <Box className="flex items-center gap-2">
                    <NiTicket size="small" className={TILE_TONE.secondary.text} />
                    <Typography variant="subtitle2" component="h3" className="mb-0">
                      {t("pax-new-trip-title")}
                    </Typography>
                  </Box>
                  {minor ? (
                    <Typography variant="body2" className="text-text-secondary">
                      {t("pax-new-trip-minor")}
                    </Typography>
                  ) : legs === null ? (
                    <Typography variant="body2" className="text-text-secondary">
                      {t("pax-new-trip-reading")}
                    </Typography>
                  ) : (
                    <>
                      {legs.state === "read" ? (
                        <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                          {legs.legs.map((leg, index) => (
                            <Typography key={index} component="li" variant="body2">
                              {t("pax-new-trip-leg", {
                                flight: leg.flightNumber || "?",
                                from: leg.originIata || "?",
                                to: leg.destinationIata || "?",
                                departure: localTimeLabel(leg.departure) || "?",
                              })}
                            </Typography>
                          ))}
                          {legs.locator && (
                            <Typography component="li" variant="body2" className="text-text-secondary">
                              {t("pax-new-trip-locator", { locator: legs.locator })}
                            </Typography>
                          )}
                        </Box>
                      ) : (
                        <Typography variant="body2" className="text-text-secondary">
                          {[t("pax-new-trip-none"), legs.state === "none" ? legs.note : null].filter(Boolean).join(" ")}
                        </Typography>
                      )}
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={withTrip}
                            disabled={busy}
                            onChange={(event) => setWithTrip(event.target.checked)}
                          />
                        }
                        label={legs.state === "read" && legs.clean ? t("pax-new-trip-save") : t("pax-new-trip-later")}
                      />
                      {legs.state === "read" && !legs.clean && withTrip && (
                        <Typography variant="body2" className="text-text-secondary">
                          {t("pax-new-trip-review")}
                        </Typography>
                      )}
                    </>
                  )}
                </Box>
              )}
              {problem && !fieldProblem && (
                <Alert
                  severity="error"
                  action={
                    problem.holderId ? (
                      <Button color="inherit" size="small" onClick={() => onCreated(problem.holderId as string)}>
                        {t("pax-new-in-use-open")}
                      </Button>
                    ) : undefined
                  }
                >
                  {t(paxErrorKey(problem.code))}
                </Alert>
              )}
            </Box>
          </DialogContent>
          <DialogActions className="flex-wrap justify-between gap-2">
            <Button variant="text" color="grey" disabled={busy} onClick={() => setPhase("documents")}>
              {t("pax-new-back")}
            </Button>
            <Box className="flex gap-2">
              <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
                {t("pax-cancel")}
              </Button>
              <Button type="submit" variant="contained" disabled={busy || values.full_name.trim() === ""}>
                {busy ? t("pax-new-confirming") : t("pax-new-confirm")}
              </Button>
            </Box>
          </DialogActions>
        </Box>
      )}

      {phase === "manual" && (
        <Box
          component="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && manual.full_name.trim() !== "") void saveByHand();
          }}
        >
          <DialogContent>
            <Box className="flex flex-col gap-4">
              <PersonFields
                idPrefix="pax-new-manual"
                values={manual}
                shown={FIRST_FIELDS}
                onChange={setManual}
                errorField={fieldProblem}
                errorText={problem ? t(paxErrorKey(problem.code)) : null}
                disabled={busy}
              />
              <Typography variant="body2" className="text-text-secondary">
                {t("pax-new-help")}
              </Typography>
              {problem && !fieldProblem && <Alert severity="error">{t(paxErrorKey(problem.code))}</Alert>}
            </Box>
          </DialogContent>
          <DialogActions className="flex-wrap justify-between gap-2">
            <Button variant="text" color="grey" disabled={busy} onClick={() => setPhase("documents")}>
              {t("pax-new-back")}
            </Button>
            <Box className="flex gap-2">
              <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
                {t("pax-cancel")}
              </Button>
              <Button type="submit" variant="contained" disabled={busy || manual.full_name.trim() === ""}>
                {busy ? t("pax-saving") : t("pax-new-save")}
              </Button>
            </Box>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}
