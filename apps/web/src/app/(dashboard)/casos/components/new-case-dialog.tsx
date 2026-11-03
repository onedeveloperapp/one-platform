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

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import PersonFields from "@/components/cases/person-fields";
import { useViewer } from "@/components/layout/viewer-context";
import DialogHeader from "@/components/product/dialog-header";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import NiTicket from "@/icons/nexture/ni-ticket";
import { createCase, finishCaseUpload } from "@/lib/cases/actions";
import { caseErrorKey, ORIGIN_KEY, ORIGINS } from "@/lib/cases/cases";
import { caseFactsOf, documentReadingOf, prefillErrorKey } from "@/lib/cases/document-prefill";
import { type PersonField, personFields, type PersonValues, personValues } from "@/lib/cases/forms";
import { dropUnsaved, sendForReading } from "@/lib/cases/prefill-browser";
import { caseKindsOf, firmCaseKinds } from "@/lib/modules/registry";

/** Who the client is, at the start: the rest they fill on their link. */
const FIRST_FIELDS = ["full_name", "cpf", "phone", "email"] as const;

/** What a case starts from (migration 0085): the client's identity, and the trip's document. */
type DocSlot = "identity" | "ticket";
const DOC_SLOTS: readonly DocSlot[] = ["identity", "ticket"];
type SentDoc = { fileId: string | null; name: string; state: SlotState };
const DOC_WORDS: Record<DocSlot, { title: string; hint: string; kind: string }> = {
  identity: {
    title: "cases-new-docs-identity",
    hint: "cases-new-docs-identity-hint",
    kind: "cases-new-docs-kind-identity",
  },
  ticket: { title: "cases-new-docs-ticket", hint: "cases-new-docs-ticket-hint", kind: "cases-new-docs-kind-ticket" },
};

const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * Opens a case: what happened, with which airline and when, and who the
 * client is. Only the name is needed to start; the client fills the rest on
 * their link, and the case opens right after so the next step (sending that
 * link) is one click away.
 */
export default function NewCaseDialog({
  airlines,
  module = null,
  prefill,
  onClose,
  onCreated,
}: {
  airlines: AirlineOption[];
  /** Opened in a module's list (0078): its kinds of problem only; with none, those of every module of the firm. */
  module?: string | null;
  /** From a conversation: the client's name and number as WhatsApp gave them. */
  prefill: NewCasePrefill;
  onClose: () => void;
  onCreated: (caseId: string) => void;
}) {
  const t = useTranslations("product");
  const firmModules = useViewer()?.modules;
  const kinds = module ? caseKindsOf(module) : firmCaseKinds(firmModules);
  const [client, setClient] = useState<PersonValues>(() =>
    personValues(prefill ? { full_name: prefill.name, phone: prefill.phone } : null),
  );
  const [incident, setIncident] = useState("");
  const [airline, setAirline] = useState("");
  const [flightDate, setFlightDate] = useState("");
  const [origin, setOrigin] = useState("");
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  // The case starts from the client's documents: ONE reads them into the form, which the person confirms; typing is
  // the contingency. What ONE wrote says so until the person writes over it.
  const [stage, setStage] = useState<"documents" | "form">("documents");
  const [docs, setDocs] = useState<Partial<Record<DocSlot, SentDoc>>>({});
  const [readFrom, setReadFrom] = useState<ReadonlySet<PersonField>>(new Set());
  const [factsRead, setFactsRead] = useState<{ airline: string; flightDate: string }>({ airline: "", flightDate: "" });

  const changeClient = (next: PersonValues) => {
    setReadFrom((current) => {
      const out = new Set(current);
      for (const field of FIRST_FIELDS) if (next[field] !== client[field]) out.delete(field);
      return out;
    });
    setClient(next);
  };

  const sendDocument = async (slot: DocSlot, file: File) => {
    const before = docs[slot]?.fileId;
    setDocs((current) => ({ ...current, [slot]: { fileId: null, name: file.name, state: { kind: "reading" } } }));
    const sent = await sendForReading(file, slot);
    if (before) dropUnsaved([before]);
    if (!sent.ok) {
      const sentence = t(prefillErrorKey(sent.code));
      setDocs((current) => ({
        ...current,
        [slot]: { fileId: sent.fileId, name: file.name, state: { kind: "failed", sentence } },
      }));
      return;
    }
    const reading = documentReadingOf(sent.output, todayInBrazil());
    const kind = t(DOC_WORDS[slot].kind);
    let found = false;
    if (slot === "identity") {
      const filled = (["full_name", "cpf"] as const).filter(
        (field) => reading.person.values[field] && (!client[field] || readFrom.has(field)),
      );
      found = reading.person.read.length > 0;
      setClient((current) => {
        const next = { ...current };
        for (const field of filled) next[field] = reading.person.values[field] ?? next[field];
        return next;
      });
      setReadFrom((current) => new Set([...current, ...filled]));
    } else {
      const facts = caseFactsOf(reading, airlines);
      found = reading.legs.length > 0;
      if (facts.airline && (!airline || airline === factsRead.airline)) setAirline(facts.airline);
      if (facts.flightDate && (!flightDate || flightDate === factsRead.flightDate)) setFlightDate(facts.flightDate);
      setFactsRead(facts);
    }
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

  // A document sent and never saved with a case goes with the dialog.
  const close = () => {
    dropUnsaved(Object.values(docs).map((doc) => doc?.fileId));
    onClose();
  };

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
    if (!result.ok) {
      setBusy(false);
      setProblem({ code: result.code, field: result.field });
      return;
    }
    // The documents the case came from join it: the identity as the client's, the trip's as the case's ticket.
    // Each one's check runs as on any other, and the legs of an accepted ticket enter the case.
    for (const slot of DOC_SLOTS) {
      const doc = docs[slot];
      if (!doc?.fileId) continue;
      const joined = await finishCaseUpload({
        caseId: result.caseId,
        fileId: doc.fileId,
        kind: slot === "identity" ? "identity" : "ticket",
        partyId: slot === "identity" ? result.partyId : null,
      });
      if (!joined.ok) dropUnsaved([doc.fileId]);
    }
    setBusy(false);
    onCreated(result.caseId);
  };

  const reading = Object.values(docs).some((doc) => doc?.state.kind === "reading");
  const anyDone = Object.values(docs).some((doc) => doc?.state.kind === "read" || doc?.state.kind === "failed");
  const fromDocuments = Object.values(docs).some((doc) => doc?.state.kind === "read");

  const fieldError = (field: string) => (problem?.field === field ? t(caseErrorKey(problem.code)) : undefined);
  const personError =
    problem?.field && (FIRST_FIELDS as readonly string[]).includes(problem.field) ? problem.field : null;

  return (
    <Dialog
      open
      onClose={busy || reading ? undefined : close}
      maxWidth="sm"
      fullWidth
      aria-labelledby="new-case-dialog"
    >
      <DialogHeader id="new-case-dialog" title={t("cases-new-title")} onClose={close} closeLabel={t("cases-close")} />
      {stage === "documents" && (
        <>
          <DialogContent>
            <Box className="flex flex-col gap-4">
              <Typography variant="body2" className="text-text-secondary">
                {t("cases-new-docs-intro")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                {DOC_SLOTS.map((slot) => (
                  <DocumentSlot
                    key={slot}
                    id={`new-case-doc-${slot}`}
                    icon={
                      slot === "identity" ? (
                        <NiDocumentFull size="medium" className={TILE_TONE.primary.text} />
                      ) : (
                        <NiTicket size="medium" className={TILE_TONE.primary.text} />
                      )
                    }
                    title={t(DOC_WORDS[slot].title)}
                    hint={t(DOC_WORDS[slot].hint)}
                    state={docs[slot]?.state ?? { kind: "empty" }}
                    fileName={docs[slot]?.name}
                    primary={slot === "identity"}
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
            </Box>
          </DialogContent>
          <DialogActions className="flex-wrap justify-between gap-2">
            <Button
              variant="text"
              color="grey"
              startIcon={<NiKeyboard size="small" />}
              disabled={reading}
              onClick={() => setStage("form")}
            >
              {t("prefill-manual")}
            </Button>
            <Box className="flex gap-2">
              <Button variant="text" color="grey" onClick={close} disabled={reading}>
                {t("cases-cancel")}
              </Button>
              <Button variant="contained" disabled={reading || !anyDone} onClick={() => setStage("form")}>
                {t("prefill-continue")}
              </Button>
            </Box>
          </DialogActions>
        </>
      )}
      {stage === "form" && (
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
              {fromDocuments && (
                <Alert severity="info" className="neutral">
                  {t("prefill-confirm-intro")}
                </Alert>
              )}
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
                      {kinds.map((kind) => (
                        <MenuItem key={kind.key} value={kind.key}>
                          {t(kind.labelKey)}
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
                      helperText={
                        fieldError("airline") ??
                        (airline && airline === factsRead.airline ? t("prefill-field-read") : undefined)
                      }
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
                      helperText={
                        fieldError("flight_date") ??
                        (flightDate && flightDate === factsRead.flightDate ? t("prefill-field-read") : undefined)
                      }
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
                  onChange={changeClient}
                  errorField={personError}
                  errorText={problem ? t(caseErrorKey(problem.code)) : null}
                  disabled={busy}
                  read={readFrom}
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
          <DialogActions className="flex-wrap justify-between gap-2">
            <Button variant="text" color="grey" disabled={busy} onClick={() => setStage("documents")}>
              {t("prefill-back")}
            </Button>
            <Box className="flex gap-2">
              <Button variant="text" color="grey" onClick={close} disabled={busy}>
                {t("cases-cancel")}
              </Button>
              <Button type="submit" variant="contained" disabled={busy}>
                {busy ? t("cases-working") : t("cases-new-submit")}
              </Button>
            </Box>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}
