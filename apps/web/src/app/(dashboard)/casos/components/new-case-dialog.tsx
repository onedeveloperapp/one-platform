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
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import PersonFields from "@/components/cases/person-fields";
import { useViewer } from "@/components/layout/viewer-context";
import DialogHeader from "@/components/product/dialog-header";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiHome from "@/icons/nexture/ni-home";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import NiTicket from "@/icons/nexture/ni-ticket";
import NiUsers from "@/icons/nexture/ni-users";
import { createAreaCase, createCase, finishCaseUpload } from "@/lib/cases/actions";
import type { AreaChoice } from "@/lib/cases/area-choices";
import { caseErrorKey, ORIGIN_KEY, ORIGINS } from "@/lib/cases/cases";
import { caseFactsOf, documentReadingOf, type FlightDayChoice, prefillErrorKey } from "@/lib/cases/document-prefill";
import { type PersonField, personFields, type PersonValues, personValues } from "@/lib/cases/forms";
import { dropUnsaved, sendForKeeping, sendForReading } from "@/lib/cases/prefill-browser";
import { namesMatch } from "@/lib/import/names";
import { caseKindsOf, moduleOf, MODULES } from "@/lib/modules/registry";
import { formatDayBr } from "@flyee/rules/person";

/** Who the client is, at the start: the rest they fill on their link. */
const FIRST_FIELDS = ["full_name", "cpf", "phone", "email"] as const;
/** Where the client lives, as their proof of address says it: shown once one was sent or read. */
const ADDRESS_FIELDS = ["postal_code", "street", "address_number", "complement", "district", "city", "uf"] as const;

/**
 * What a case starts from (migration 0085): the client's identity and proof of address, the trip's document, and,
 * for a proof in somebody else's name, what shows the client's link to its holder (0294).
 */
type DocSlot = "identity" | "address_proof" | "residence_link" | "ticket";
type SentDoc = { fileId: string | null; name: string; state: SlotState };
const DOC_WORDS: Record<DocSlot, { title: string; hint: string; kind: string }> = {
  identity: {
    title: "cases-new-docs-identity",
    hint: "cases-new-docs-identity-hint",
    kind: "cases-new-docs-kind-identity",
  },
  address_proof: {
    title: "people-new-address",
    hint: "cases-new-docs-address-hint",
    kind: "people-new-kind-address",
  },
  residence_link: {
    title: "cases-new-docs-link",
    hint: "cases-new-docs-link-hint",
    kind: "cases-new-docs-kind-link",
  },
  ticket: { title: "cases-new-docs-ticket", hint: "cases-new-docs-ticket-hint", kind: "cases-new-docs-kind-ticket" },
};

/** What a case is of (0292): a module the firm contracted, with its kinds of problem, or an area of the firm's own. */
type Subject =
  | { id: string; kind: "module"; key: string; label: string }
  | { id: string; kind: "area"; area: AreaChoice; label: string };

const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * Opens a case by hand, the exception to the cases ONE opens: what the case is of (a module or an area of the firm,
 * asked only when the firm has more than one), what happened, and who the client is. It starts from the client's
 * documents, which ONE reads into the form; typing is the contingency. Opened from a person's page, the case is that
 * person's, and nothing of them is asked again. The case opens right after, so the next step (sending the client's
 * link) is one click away.
 */
export default function NewCaseDialog({
  airlines,
  areas = [],
  module = null,
  prefill = null,
  person = null,
  onClose,
  onCreated,
}: {
  airlines: AirlineOption[];
  /** The areas of the firm's own a person opens a case of (0292); none under a module's list. */
  areas?: AreaChoice[];
  /** Opened in a module's list (0078): its kinds of problem only; with none, those of every module of the firm. */
  module?: string | null;
  /** From a conversation: the client's name and number as WhatsApp gave them. */
  prefill?: NewCasePrefill;
  /** From a person's page (0292): the case is theirs. */
  person?: { id: string; name: string } | null;
  onClose: () => void;
  onCreated: (caseId: string) => void;
}) {
  const t = useTranslations("product");
  const firmModules = useViewer()?.modules;
  const moduleKeys = module ? [module] : (firmModules ?? MODULES.modules.map((definition) => definition.key));
  const subjects: Subject[] = [
    ...moduleKeys
      .filter((key) => caseKindsOf(key).length > 0)
      .map((key): Subject => {
        const nameKey = moduleOf(key)?.nameKey;
        return { id: `module:${key}`, kind: "module", key, label: nameKey ? t(nameKey) : key };
      }),
    ...(module ? [] : areas).map((area): Subject => ({ id: `area:${area.id}`, kind: "area", area, label: area.name })),
  ];

  const [subjectId, setSubjectId] = useState(subjects.length === 1 ? subjects[0].id : "");
  const subject = subjects.find((entry) => entry.id === subjectId) ?? null;
  const [client, setClient] = useState<PersonValues>(() =>
    personValues(prefill ? { full_name: prefill.name, phone: prefill.phone } : null),
  );
  const [incident, setIncident] = useState("");
  const [caseType, setCaseType] = useState("");
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
  // The days the flight may be, when the ticket does not make it clear (0293): the person chooses.
  const [dayChoices, setDayChoices] = useState<FlightDayChoice[]>([]);
  // Whose name the proof of address is in, as ONE read it (0294).
  const [billHolder, setBillHolder] = useState("");

  // The documents the case starts from: the identity and the proof of address, unless the client is a person the
  // firm has (ONE brings the ones it accepted of them, 0157); the trip's document for the passenger module's case.
  // With none to send, the panel opens on the form.
  // A proof in somebody else's name (0294): the document of the client's link to its holder, or, with none, the
  // residence declaration ONE sends the client to sign.
  const thirdParty =
    Boolean(billHolder) && client.full_name.trim().length >= 3 && !namesMatch(billHolder, client.full_name);
  const slots: DocSlot[] = !subject
    ? []
    : ([
        person ? null : "identity",
        person ? null : "address_proof",
        !person && thirdParty ? "residence_link" : null,
        subject.kind === "module" ? "ticket" : null,
      ].filter(Boolean) as DocSlot[]);
  const addressShown =
    !person && (Boolean(docs.address_proof) || ADDRESS_FIELDS.some((field) => client[field].trim() !== ""));
  const clientShown: PersonField[] = [...FIRST_FIELDS, ...(addressShown ? ADDRESS_FIELDS : [])];
  const shownStage = stage === "documents" && subject && slots.length === 0 ? "form" : stage;
  const kinds = subject?.kind === "module" ? caseKindsOf(subject.key) : [];

  const changeClient = (next: PersonValues) => {
    setReadFrom((current) => {
      const out = new Set(current);
      for (const field of clientShown) if (next[field] !== client[field]) out.delete(field);
      return out;
    });
    setClient(next);
  };

  const changeSubject = (next: string) => {
    setSubjectId(next);
    setIncident("");
    setCaseType("");
    setProblem(null);
  };

  // What shows the link is kept as it is: ONE checks it on the case, against the holder of the bill (0294).
  const keepDocument = async (slot: DocSlot, file: File) => {
    const before = docs[slot]?.fileId;
    setDocs((current) => ({ ...current, [slot]: { fileId: null, name: file.name, state: { kind: "reading" } } }));
    const kept = await sendForKeeping(file);
    if (before) dropUnsaved([before]);
    setDocs((current) => ({
      ...current,
      [slot]: kept.ok
        ? {
            fileId: kept.fileId,
            name: file.name,
            state: { kind: "read", tone: "positive", sentence: t("cases-new-docs-link-kept") },
          }
        : { fileId: null, name: file.name, state: { kind: "failed", sentence: t(prefillErrorKey(kept.code)) } },
    }));
  };

  const sendDocument = async (slot: DocSlot, file: File) => {
    if (slot === "residence_link") return keepDocument(slot, file);
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
    if (slot === "identity" || slot === "address_proof") {
      // A field ONE read fills an empty one, or one it had read before; what a person typed stays theirs.
      const fields: readonly PersonField[] = slot === "identity" ? (["full_name", "cpf"] as const) : ADDRESS_FIELDS;
      const filled = fields.filter((field) => reading.person.values[field] && (!client[field] || readFrom.has(field)));
      found = fields.some((field) => reading.person.values[field]);
      setClient((current) => {
        const next = { ...current };
        for (const field of filled) next[field] = reading.person.values[field] ?? next[field];
        return next;
      });
      setReadFrom((current) => new Set([...current, ...filled]));
      if (slot === "address_proof") setBillHolder(reading.nameOnDocument);
    } else {
      const facts = caseFactsOf(reading, airlines, todayInBrazil());
      found = reading.legs.length > 0;
      if (facts.airline && (!airline || airline === factsRead.airline)) setAirline(facts.airline);
      if (facts.flightDate && (!flightDate || flightDate === factsRead.flightDate)) setFlightDate(facts.flightDate);
      // A day ONE read before and no longer reads is no longer ONE's.
      if (!facts.flightDate && flightDate && flightDate === factsRead.flightDate) setFlightDate("");
      setFactsRead(facts);
      setDayChoices(facts.choices);
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
    if (!subject) {
      setProblem({ code: "area_not_found", field: "area" });
      return;
    }
    if (subject.kind === "module" && !incident) {
      setProblem({ code: "invalid_incident", field: "incident" });
      return;
    }
    if (subject.kind === "module" && dayChoices.length > 0 && !flightDate) {
      setProblem({ code: "flight_day_unclear", field: "flight_day" });
      return;
    }
    if (subject.kind === "area" && !caseType) {
      setProblem({ code: "invalid_case_type", field: "case_type" });
      return;
    }
    setBusy(true);
    setProblem(null);
    const clientFields = person ? {} : personFields(client, clientShown);
    const result =
      subject.kind === "module"
        ? await createCase({
            incident,
            airline: airline || null,
            flightDate: flightDate || null,
            client: clientFields,
            origin: origin || null,
            personId: person?.id ?? null,
          })
        : await createAreaCase({
            areaId: subject.area.id,
            caseType,
            client: clientFields,
            origin: origin || null,
            personId: person?.id ?? null,
          });
    if (!result.ok) {
      setBusy(false);
      setProblem({ code: result.code, field: result.field });
      return;
    }
    // The documents the case came from join it: the identity as the client's, the trip's as the case's ticket.
    // Each one's check runs as on any other, and the legs of an accepted ticket enter the case.
    for (const slot of slots) {
      const doc = docs[slot];
      if (!doc?.fileId) continue;
      const joined = await finishCaseUpload({
        caseId: result.caseId,
        fileId: doc.fileId,
        kind: slot,
        partyId: slot === "ticket" ? null : result.partyId,
      });
      if (!joined.ok) dropUnsaved([doc.fileId]);
    }
    // One sent for a slot the case no longer has (the subject changed after it) goes with the panel.
    dropUnsaved(
      (Object.keys(docs) as DocSlot[]).filter((slot) => !slots.includes(slot)).map((slot) => docs[slot]?.fileId),
    );
    setBusy(false);
    onCreated(result.caseId);
  };

  const sentDocs = slots.map((slot) => docs[slot]).filter(Boolean);
  const reading = Object.values(docs).some((doc) => doc?.state.kind === "reading");
  const anyDone = sentDocs.some((doc) => doc?.state.kind === "read" || doc?.state.kind === "failed");
  const fromDocuments = sentDocs.some((doc) => doc?.state.kind === "read");

  const fieldError = (field: string) => (problem?.field === field ? t(caseErrorKey(problem.code)) : undefined);
  const personError =
    problem?.field && (clientShown as readonly string[]).includes(problem.field) ? problem.field : null;
  // The fields that say their own error; any other is said under the form.
  const fieldsShown: string[] = [
    ...(subjects.length > 1 ? ["area"] : []),
    ...(subject?.kind === "area"
      ? ["case_type"]
      : ["incident", "airline", "flight_date", ...(dayChoices.length > 0 ? ["flight_day"] : [])]),
    ...(person ? [] : clientShown),
  ];

  const docsIntro = !subject
    ? null
    : subject.kind === "area"
      ? "cases-new-docs-intro-identity"
      : person
        ? "cases-new-docs-intro-ticket"
        : "cases-new-docs-intro";

  // What the case is of, asked only when the firm has more than one module or area to open a case of.
  const subjectField =
    subjects.length > 1 ? (
      <TextField
        select
        fullWidth
        size="small"
        id="new-case-subject"
        label={t("cases-new-subject")}
        value={subjectId}
        required
        disabled={busy || reading}
        error={Boolean(fieldError("area"))}
        helperText={fieldError("area")}
        onChange={(event) => changeSubject(event.target.value)}
      >
        {subjects.map((entry) => (
          <MenuItem key={entry.id} value={entry.id}>
            {entry.label}
          </MenuItem>
        ))}
      </TextField>
    ) : null;

  return (
    <Dialog
      open
      onClose={busy || reading ? undefined : close}
      maxWidth="sm"
      fullWidth
      aria-labelledby="new-case-dialog"
    >
      <DialogHeader id="new-case-dialog" title={t("cases-new-title")} onClose={close} closeLabel={t("cases-close")} />
      {subjects.length === 0 && (
        <>
          <DialogContent>
            <Alert severity="info" className="neutral">
              {t("cases-new-nothing")}
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button variant="text" color="grey" onClick={close}>
              {t("cases-close")}
            </Button>
          </DialogActions>
        </>
      )}
      {subjects.length > 0 && shownStage === "documents" && (
        <>
          <DialogContent>
            <Box className="flex flex-col gap-4">
              {subjectField}
              {docsIntro && (
                <Typography variant="body2" className="text-text-secondary">
                  {t(docsIntro)}
                </Typography>
              )}
              {slots.length > 0 && (
                <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                  {slots.map((slot) => (
                    <DocumentSlot
                      key={slot}
                      id={`new-case-doc-${slot}`}
                      icon={
                        slot === "identity" ? (
                          <NiDocumentFull size="medium" className={TILE_TONE.primary.text} />
                        ) : slot === "address_proof" ? (
                          <NiHome size="medium" className={TILE_TONE.primary.text} />
                        ) : slot === "residence_link" ? (
                          <NiUsers size="medium" className={TILE_TONE.primary.text} />
                        ) : (
                          <NiTicket size="medium" className={TILE_TONE.primary.text} />
                        )
                      }
                      title={t(DOC_WORDS[slot].title)}
                      hint={
                        slot === "residence_link"
                          ? t("cases-new-docs-link-hint", { holder: billHolder })
                          : t(DOC_WORDS[slot].hint)
                      }
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
              )}
            </Box>
          </DialogContent>
          <DialogActions className="flex-wrap justify-between gap-2">
            <Button
              variant="text"
              color="grey"
              startIcon={<NiKeyboard size="small" />}
              disabled={reading || !subject}
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
      {subjects.length > 0 && shownStage === "form" && (
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
                  {subjectField && <Grid size={12}>{subjectField}</Grid>}
                  {subject?.kind === "area" && (
                    <Grid size={12}>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        id="new-case-type"
                        label={t("cases-field-case-type")}
                        value={caseType}
                        required
                        disabled={busy}
                        error={Boolean(fieldError("case_type"))}
                        helperText={fieldError("case_type")}
                        onChange={(event) => setCaseType(event.target.value)}
                      >
                        {subject.area.types.map((type) => (
                          <MenuItem key={type.key} value={type.key}>
                            {type.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                  )}
                  {subject?.kind === "module" && (
                    <>
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
                      {dayChoices.length > 0 && (
                        <Grid size={12}>
                          <FormControl error={Boolean(fieldError("flight_day"))} disabled={busy}>
                            <FormLabel id="new-case-flight-day">
                              {dayChoices[0].yearRead
                                ? t("cases-new-day-question-legs")
                                : t("cases-new-day-question-year", {
                                    day: `${dayChoices[0].date.slice(8, 10)}/${dayChoices[0].date.slice(5, 7)}`,
                                  })}
                            </FormLabel>
                            <RadioGroup
                              aria-labelledby="new-case-flight-day"
                              value={String(dayChoices.findIndex((choice) => choice.date === flightDate))}
                              onChange={(event) => {
                                const choice = dayChoices[Number(event.target.value)];
                                if (!choice) return;
                                setFlightDate(choice.date);
                                if (choice.airline) setAirline(choice.airline);
                              }}
                            >
                              {dayChoices.map((choice, index) => (
                                <FormControlLabel
                                  key={`${choice.date}-${choice.flight}`}
                                  value={String(index)}
                                  control={<Radio size="small" />}
                                  label={[
                                    formatDayBr(choice.date) ?? choice.date,
                                    choice.yearRead ? choice.flight : null,
                                    choice.yearRead && choice.origin && choice.destination
                                      ? `${choice.origin} → ${choice.destination}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                />
                              ))}
                            </RadioGroup>
                            {fieldError("flight_day") && <FormHelperText>{fieldError("flight_day")}</FormHelperText>}
                          </FormControl>
                        </Grid>
                      )}
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
                    </>
                  )}
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
                {person ? (
                  <Typography variant="body2">{t("cases-new-person-known", { name: person.name })}</Typography>
                ) : (
                  <>
                    <PersonFields
                      idPrefix="new-case-client"
                      values={client}
                      shown={clientShown}
                      onChange={changeClient}
                      errorField={personError}
                      errorText={problem ? t(caseErrorKey(problem.code)) : null}
                      disabled={busy}
                      read={readFrom}
                    />
                    <Typography variant="body2" className="text-text-secondary">
                      {t("cases-new-client-help")}
                    </Typography>
                  </>
                )}
              </Box>

              {problem && (!problem.field || !fieldsShown.includes(problem.field)) && (
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {t(caseErrorKey(problem.code))}
                </Alert>
              )}
            </Box>
          </DialogContent>
          <DialogActions className="flex-wrap justify-between gap-2">
            {slots.length > 0 ? (
              <Button variant="text" color="grey" disabled={busy} onClick={() => setStage("documents")}>
                {t("prefill-back")}
              </Button>
            ) : (
              <span />
            )}
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
