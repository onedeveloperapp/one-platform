"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Grid, IconButton, MenuItem, TextField, Typography } from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import PersonFields from "@/components/cases/person-fields";
import OutcomeDialog, { type OutcomeLine } from "@/components/product/outcome-dialog";
import SidePanel from "@/components/product/side-panel";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFolder from "@/icons/nexture/ni-folder";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import NiLuggage from "@/icons/nexture/ni-luggage";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiPlus from "@/icons/nexture/ni-plus";
import NiTicket from "@/icons/nexture/ni-ticket";
import { documentReadingOf, prefillErrorKey } from "@/lib/cases/document-prefill";
import { type PersonField, personFields, type PersonValues, personValues } from "@/lib/cases/forms";
import { dropUnsaved, sendForReading } from "@/lib/cases/prefill-browser";
import type { PersonStepPanelProps } from "@/lib/modules/types";
import { passengerConsentWords, registerPassenger } from "@/modules/direito-do-passageiro/passengers/actions";
import {
  AGREEMENT_HOW_KEY,
  AGREEMENT_HOWS,
  type AgreementHow,
  emptyLeg,
  legOfReading,
  legReady,
  legToSend,
  passengerErrorKey,
  type PassengerLeg,
} from "@/modules/direito-do-passageiro/passengers/passengers";

/** Who the passenger is: the WhatsApp is where ONE tells them of a problem. */
const FIELDS = ["full_name", "cpf", "phone", "email"] as const;

type DocSlot = "identity" | "ticket";
type SentDoc = { fileId: string | null; name: string; state: SlotState };

const SLOT_WORDS: Record<DocSlot, { kind: string; title: string; hint: string }> = {
  identity: {
    kind: "passenger-doc-kind-identity",
    title: "passenger-doc-identity",
    hint: "passenger-doc-identity-hint",
  },
  ticket: { kind: "passenger-doc-kind-ticket", title: "passenger-doc-ticket", hint: "passenger-doc-ticket-hint" },
};

const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * A passenger of the firm's own (migration 0170), registered as an agency registers one: the identity and the ticket
 * first, ONE reading the person and the legs into the form, which the person confirms (typing is the contingency);
 * then the way the passenger agreed to be followed, and ONE follows the trip. The documents stay with the trip and go
 * into the case the passenger's yes opens. For a person of the firm already, only the trip is asked.
 */
export default function NewPassengerPanel({
  personId = null,
  personName = null,
  documents: carried = [],
  onClose,
  onDone,
}: PersonStepPanelProps) {
  const t = useTranslations("product");
  const known = Boolean(personId);
  const slots: readonly DocSlot[] = known ? ["ticket"] : ["identity", "ticket"];
  const [stage, setStage] = useState<"documents" | "form">("documents");
  const [docs, setDocs] = useState<Partial<Record<DocSlot, SentDoc>>>({});
  const [person, setPerson] = useState<PersonValues>(() => personValues(null));
  const [readFrom, setReadFrom] = useState<ReadonlySet<PersonField>>(new Set());
  const [legs, setLegs] = useState<PassengerLeg[]>([emptyLeg()]);
  const [legsRead, setLegsRead] = useState(false);
  const [how, setHow] = useState<AgreementHow | "">("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);
  const [outcome, setOutcome] = useState<{ personId: string; reused: boolean; test: boolean } | null>(null);
  // The person a try wrote before its trip was refused: the next try follows the trip of that very person.
  const [saved, setSaved] = useState<string | null>(null);
  // The words the database records with the agreement, read where it keeps them.
  const [words, setWords] = useState<string | null>(null);
  useEffect(() => {
    void passengerConsentWords().then(setWords, () => setWords(null));
  }, []);

  const changePerson = (next: PersonValues) => {
    setReadFrom((current) => {
      const out = new Set(current);
      for (const field of FIELDS) if (next[field] !== person[field]) out.delete(field);
      return out;
    });
    setPerson(next);
  };

  const sendDocument = async (slot: DocSlot, file: File) => {
    const before = docs[slot]?.fileId;
    setDocs((current) => ({ ...current, [slot]: { fileId: null, name: file.name, state: { kind: "reading" } } }));
    const sent = await sendForReading(file, slot);
    if (before) dropUnsaved([before]);
    if (!sent.ok) {
      setDocs((current) => ({
        ...current,
        [slot]: {
          fileId: sent.fileId,
          name: file.name,
          state: { kind: "failed", sentence: t(prefillErrorKey(sent.code)) },
        },
      }));
      return;
    }
    const reading = documentReadingOf(sent.output, todayInBrazil());
    let found = false;
    if (slot === "identity") {
      const filled = (["full_name", "cpf"] as const).filter(
        (field) => reading.person.values[field] && (!person[field] || readFrom.has(field)),
      );
      found = reading.person.read.length > 0;
      setPerson((current) => {
        const next = { ...current };
        for (const field of filled) next[field] = reading.person.values[field] ?? next[field];
        return next;
      });
      setReadFrom((current) => new Set([...current, ...filled]));
    } else {
      found = reading.legs.length > 0;
      if (found) {
        setLegs(reading.legs.slice(0, 6).map(legOfReading));
        setLegsRead(true);
      }
    }
    const kind = t(SLOT_WORDS[slot].kind);
    const sentence = !reading.matches
      ? t("prefill-read-other", { kind, identified: reading.identified || t("prefill-read-unknown") })
      : !reading.legible
        ? [t("prefill-read-illegible"), reading.note].filter(Boolean).join(" ")
        : !found
          ? [t("prefill-read-nothing"), reading.note].filter(Boolean).join(" ")
          : [t("prefill-read-ok", { identified: reading.identified || kind }), reading.note].filter(Boolean).join(" ");
    const good = reading.matches && reading.legible && found;
    setDocs((current) => ({
      ...current,
      [slot]: {
        fileId: sent.fileId,
        name: file.name,
        state: { kind: "read", tone: good ? "positive" : "attention", sentence },
      },
    }));
  };

  // A document sent and never kept with a trip goes with the panel.
  const close = () => {
    dropUnsaved(Object.values(docs).map((doc) => doc?.fileId));
    onClose();
  };

  const setLeg = (index: number, field: keyof PassengerLeg, value: string) => {
    setLegsRead(false);
    setLegs((current) => current.map((leg, at) => (at === index ? { ...leg, [field]: value } : leg)));
  };

  const submit = async () => {
    const sent = legs.map(legToSend).filter((leg): leg is PassengerLeg => leg !== null);
    if (!known && !saved && person.full_name.trim().length < 3) {
      setProblem({ code: "invalid_data", field: "full_name" });
      return;
    }
    if (!known && !saved && person.phone.replace(/\D/g, "").length < 10) {
      setProblem({ code: "no_phone", field: "phone" });
      return;
    }
    if (sent.length === 0 || !sent.every(legReady)) {
      setProblem({ code: "invalid_data", field: "legs" });
      return;
    }
    if (!how) {
      setProblem({ code: "invalid_data", field: "how" });
      return;
    }
    setBusy(true);
    setProblem(null);
    // The documents the core read the person from (the identity) go with the trip too, into the case its yes opens.
    const documents = [
      ...carried,
      ...slots
        .map((slot) => ({ fileId: docs[slot]?.fileId ?? null, kind: slot }))
        .filter((item): item is { fileId: string; kind: DocSlot } => Boolean(item.fileId)),
    ];
    const result = await registerPassenger({
      personId: personId ?? saved,
      person: known || saved ? undefined : personFields(person, FIELDS),
      legs: sent,
      how,
      documents,
    }).catch(() => ({ ok: false as const, code: "failed", field: null, personId: null }));
    setBusy(false);
    if (!result.ok) {
      if (!known && result.personId) setSaved(result.personId);
      setProblem({ code: result.code, field: result.field ?? null });
      return;
    }
    setOutcome({ personId: result.personId, reused: result.reused && !known && !saved, test: result.test });
  };

  const reading = Object.values(docs).some((doc) => doc?.state.kind === "reading");
  const anyDone = Object.values(docs).some((doc) => doc?.state.kind === "read" || doc?.state.kind === "failed");

  if (outcome) {
    const lines: OutcomeLine[] = [
      { key: "alert", icon: <NiMessageDots size="medium" />, text: t("passenger-done-alert") },
      { key: "case", icon: <NiFolder size="medium" />, text: t("passenger-done-case") },
      ...(outcome.reused
        ? [{ key: "reused", icon: <NiDocumentFull size="medium" />, text: t("passenger-done-reused") }]
        : []),
      ...(outcome.test ? [{ key: "test", icon: <NiLuggage size="medium" />, text: t("passenger-done-test") }] : []),
    ];
    return (
      <OutcomeDialog
        open
        title={t("passenger-done-title")}
        lines={lines}
        closeLabel={t("passenger-done-close")}
        onClose={() => onDone(outcome.personId)}
      />
    );
  }

  return (
    <SidePanel
      onClose={busy || reading ? () => undefined : close}
      closeLabel={t("passenger-close")}
      title={known ? t("passenger-trip-title", { name: personName ?? "" }) : t("passenger-new-title")}
      description={t("passenger-new-intro")}
      icon={<NiLuggage size="medium" />}
      tone="secondary"
      busy={busy}
      onSubmit={stage === "form" ? () => void submit() : undefined}
      actions={
        stage === "documents" ? (
          <Box className="flex w-full flex-wrap justify-between gap-2">
            <Button
              variant="text"
              color="grey"
              startIcon={<NiKeyboard size="small" />}
              disabled={reading}
              onClick={() => setStage("form")}
            >
              {t("prefill-manual")}
            </Button>
            <Button variant="contained" disabled={reading || !anyDone} onClick={() => setStage("form")}>
              {t("prefill-continue")}
            </Button>
          </Box>
        ) : (
          <Box className="flex w-full flex-wrap justify-between gap-2">
            <Button variant="text" color="grey" disabled={busy} onClick={() => setStage("documents")}>
              {t("prefill-back")}
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? t("passenger-working") : t("passenger-submit")}
            </Button>
          </Box>
        )
      }
    >
      {stage === "documents" ? (
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {slots.map((slot) => (
            <DocumentSlot
              key={slot}
              id={`passenger-doc-${slot}`}
              icon={
                slot === "identity" ? (
                  <NiDocumentFull size="medium" className={TILE_TONE.secondary.text} />
                ) : (
                  <NiTicket size="medium" className={TILE_TONE.secondary.text} />
                )
              }
              title={t(SLOT_WORDS[slot].title)}
              hint={t(SLOT_WORDS[slot].hint)}
              state={docs[slot]?.state ?? { kind: "empty" }}
              fileName={docs[slot]?.name}
              primary={slot === slots[0]}
              disabled={busy}
              labels={{
                send: t("prefill-send"),
                again: t("prefill-again"),
                sending: t("prefill-sending"),
                reading: t("prefill-reading"),
                read: t("prefill-read"),
                failed: t("prefill-failed"),
              }}
              onFile={(file) => void sendDocument(slot, file)}
            />
          ))}
        </Box>
      ) : (
        <Box className="flex flex-col gap-5">
          {anyDone ? (
            <Alert severity="info" className="neutral">
              {t("prefill-confirm-intro")}
            </Alert>
          ) : null}
          {known ? null : (
            <Box className="flex flex-col gap-3">
              <Typography variant="subtitle2" component="h3">
                {t("passenger-who")}
              </Typography>
              <PersonFields
                idPrefix="passenger"
                values={person}
                shown={FIELDS}
                onChange={changePerson}
                errorField={
                  problem?.field && (FIELDS as readonly string[]).includes(problem.field) ? problem.field : null
                }
                errorText={problem ? t(passengerErrorKey(problem.code, problem.field)) : null}
                disabled={busy || Boolean(saved)}
                read={readFrom}
              />
              <Typography variant="body2" className="text-text-secondary">
                {t("passenger-phone-why")}
              </Typography>
            </Box>
          )}

          <Box className="flex flex-col gap-3">
            <Typography variant="subtitle2" component="h3">
              {t("passenger-legs")}
            </Typography>
            {legsRead ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("passenger-legs-read")}
              </Typography>
            ) : null}
            {legs.map((leg, index) => (
              <Box key={index} className="border-grey-100 flex flex-col gap-2 rounded-lg border p-3">
                <Box className="flex items-center justify-between gap-2">
                  <Typography variant="body2" className="font-semibold">
                    {t("passenger-leg", { number: index + 1 })}
                  </Typography>
                  {legs.length > 1 ? (
                    <IconButton
                      size="small"
                      aria-label={t("passenger-leg-remove", { number: index + 1 })}
                      disabled={busy}
                      onClick={() => setLegs((current) => current.filter((_, at) => at !== index))}
                    >
                      <NiBinEmpty size="small" />
                    </IconButton>
                  ) : null}
                </Box>
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label={t("passenger-leg-flight")}
                      value={leg.flight_number}
                      disabled={busy}
                      onChange={(event) => setLeg(index, "flight_number", event.target.value.slice(0, 8))}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label={t("passenger-leg-origin")}
                      value={leg.origin_iata}
                      disabled={busy}
                      onChange={(event) => setLeg(index, "origin_iata", event.target.value.slice(0, 3).toUpperCase())}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label={t("passenger-leg-destination")}
                      value={leg.destination_iata}
                      disabled={busy}
                      onChange={(event) =>
                        setLeg(index, "destination_iata", event.target.value.slice(0, 3).toUpperCase())
                      }
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="datetime-local"
                      label={t("passenger-leg-departure")}
                      value={leg.scheduled_departure_local}
                      disabled={busy}
                      slotProps={{ inputLabel: { shrink: true } }}
                      onChange={(event) => setLeg(index, "scheduled_departure_local", event.target.value.slice(0, 16))}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="datetime-local"
                      label={t("passenger-leg-arrival")}
                      value={leg.scheduled_arrival_local}
                      disabled={busy}
                      slotProps={{ inputLabel: { shrink: true } }}
                      onChange={(event) => setLeg(index, "scheduled_arrival_local", event.target.value.slice(0, 16))}
                    />
                  </Grid>
                </Grid>
              </Box>
            ))}
            {legs.length < 6 ? (
              <Box>
                <Button
                  variant="text"
                  size="small"
                  startIcon={<NiPlus size="small" />}
                  disabled={busy}
                  onClick={() => setLegs((current) => [...current, emptyLeg()])}
                >
                  {t("passenger-leg-add")}
                </Button>
              </Box>
            ) : null}
            <Typography variant="body2" className="text-text-secondary">
              {t("passenger-legs-local")}
            </Typography>
          </Box>

          <Box className="flex flex-col gap-3">
            <Typography variant="subtitle2" component="h3">
              {t("passenger-agreement")}
            </Typography>
            {words ? (
              <Typography variant="body2" className="bg-grey-25 rounded-lg p-3">
                {words}
              </Typography>
            ) : null}
            <TextField
              select
              fullWidth
              size="small"
              id="passenger-how"
              label={t("passenger-agreement-how")}
              value={how}
              disabled={busy}
              error={problem?.field === "how"}
              helperText={problem?.field === "how" ? t("passenger-error-how") : undefined}
              onChange={(event) => setHow(event.target.value as AgreementHow)}
            >
              {AGREEMENT_HOWS.map((option) => (
                <MenuItem key={option} value={option}>
                  {t(AGREEMENT_HOW_KEY[option])}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="body2" className="text-text-secondary">
              {t("passenger-agreement-after")}
            </Typography>
          </Box>

          {problem && problem.field !== "how" && !(FIELDS as readonly string[]).includes(problem.field ?? "") ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(passengerErrorKey(problem.code, problem.field))}
            </Alert>
          ) : null}
        </Box>
      )}
    </SidePanel>
  );
}
