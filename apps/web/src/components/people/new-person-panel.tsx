"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import PersonFields from "@/components/cases/person-fields";
import { personStepsOf } from "@/components/people/module-people";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiHome from "@/icons/nexture/ni-home";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import NiUserPlus from "@/icons/nexture/ni-user-plus";
import { documentReadingOf, prefillErrorKey } from "@/lib/cases/document-prefill";
import { type PersonField, personFields, type PersonValues, personValues } from "@/lib/cases/forms";
import { dropUnsaved, sendForReading } from "@/lib/cases/prefill-browser";
import { createFirmPerson } from "@/lib/people/actions";

/** Who the person is, how to reach them and where they live: what the documents give, and what a person adds. */
const FIELDS: readonly PersonField[] = [
  "full_name",
  "cpf",
  "birth_date",
  "phone",
  "email",
  "postal_code",
  "street",
  "address_number",
  "complement",
  "district",
  "city",
  "uf",
];

type Slot = "identity" | "address_proof";
const SLOTS: readonly Slot[] = ["identity", "address_proof"];
const SLOT_WORDS: Record<Slot, { kind: string; title: string; hint: string }> = {
  identity: { kind: "people-new-kind-identity", title: "people-new-identity", hint: "people-new-identity-hint" },
  address_proof: { kind: "people-new-kind-address", title: "people-new-address", hint: "people-new-address-hint" },
};

type SentDoc = { fileId: string | null; name: string; state: SlotState };

const ERROR_KEY: Record<string, string> = {
  invalid_data: "people-new-error-invalid",
  support_visit: "people-new-error-support",
  not_found: "people-new-error-failed",
  failed: "people-new-error-failed",
};

const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * "Nova pessoa" (the owner, 2026-11-11): anybody the firm registers itself, with any module or none. The document
 * first (the identity, and if at hand a proof of address): ONE reads it into the form, which the person confirms or
 * corrects, typing being the contingency. The person enters as a contact, and their point in the funnel moves by what
 * happens to them, never by a choice here. Then "E agora?": each step the firm's modules offer for a new person
 * ("Acompanhar uma viagem"), or nothing more. The documents read go with what a module does, or are dropped.
 */
export default function NewPersonPanel({
  modules,
  onClose,
  onDone,
}: {
  modules: readonly string[] | null | undefined;
  /** Closed before anything was written, or after the person was written with nothing more. */
  onClose: (personId: string | null) => void;
  /** The person was written and the flow ended: their page opens. */
  onDone: (personId: string) => void;
}) {
  const t = useTranslations("product");
  const steps = personStepsOf(modules);
  const [stage, setStage] = useState<"documents" | "form" | "next">("documents");
  const [docs, setDocs] = useState<Partial<Record<Slot, SentDoc>>>({});
  const [person, setPerson] = useState<PersonValues>(() => personValues(null));
  const [readFrom, setReadFrom] = useState<ReadonlySet<PersonField>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field: string | null; personId: string | null } | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const sentFiles = () => Object.values(docs).map((doc) => doc?.fileId);
  const carried = SLOTS.flatMap((slot) => {
    const fileId = docs[slot]?.fileId;
    return fileId ? [{ fileId, kind: slot }] : [];
  });

  const changePerson = (next: PersonValues) => {
    setReadFrom((current) => {
      const out = new Set(current);
      for (const field of FIELDS) if (next[field] !== person[field]) out.delete(field);
      return out;
    });
    setPerson(next);
  };

  const sendDocument = async (slot: Slot, file: File) => {
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
    // A field ONE read fills an empty one, or one it had read before; what a person typed stays theirs.
    const filled = FIELDS.filter((field) => reading.person.values[field] && (!person[field] || readFrom.has(field)));
    setPerson((current) => {
      const next = { ...current };
      for (const field of filled) next[field] = reading.person.values[field] ?? next[field];
      return next;
    });
    setReadFrom((current) => new Set([...current, ...filled]));
    const kind = t(SLOT_WORDS[slot].kind);
    const found = reading.person.read.length > 0;
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

  const save = async () => {
    if (person.full_name.trim().length < 3) {
      setProblem({ code: "invalid_data", field: "full_name", personId: null });
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await createFirmPerson(personFields(person, FIELDS)).catch(() => ({
      ok: false as const,
      code: "failed",
      field: null,
      personId: null,
    }));
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field, personId: result.personId });
      return;
    }
    setSaved({ id: result.personId, name: person.full_name.trim() });
    setStage("next");
  };

  // What was read and never kept with a module's step goes with the panel.
  const close = () => {
    dropUnsaved(sentFiles());
    onClose(saved?.id ?? null);
  };
  const finish = () => {
    if (!saved) return;
    dropUnsaved(sentFiles());
    onDone(saved.id);
  };

  const reading = Object.values(docs).some((doc) => doc?.state.kind === "reading");
  const anyDone = Object.values(docs).some((doc) => doc?.state.kind === "read" || doc?.state.kind === "failed");
  const fieldProblem = problem?.field && (FIELDS as readonly string[]).includes(problem.field) ? problem.field : null;

  const Step = steps.find((item) => item.key === step)?.Panel ?? null;
  if (saved && Step) {
    return (
      <Step
        personId={saved.id}
        personName={saved.name}
        documents={carried}
        onClose={() => setStep(null)}
        onDone={(personId) => onDone(personId)}
      />
    );
  }

  return (
    <SidePanel
      onClose={busy || reading ? () => undefined : close}
      closeLabel={t("people-new-close")}
      title={stage === "next" ? t("people-new-next-title") : t("people-new")}
      description={stage === "next" ? undefined : t("people-new-intro")}
      icon={<NiUserPlus size="medium" />}
      tone="primary"
      busy={busy}
      onSubmit={stage === "form" ? () => void save() : undefined}
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
        ) : stage === "form" ? (
          <Box className="flex w-full flex-wrap justify-between gap-2">
            <Button variant="text" color="grey" disabled={busy} onClick={() => setStage("documents")}>
              {t("prefill-back")}
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? t("people-new-saving") : t("people-new-save")}
            </Button>
          </Box>
        ) : (
          <Box className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="outlined" color="grey" onClick={finish}>
              {t("people-new-next-only")}
            </Button>
          </Box>
        )
      }
    >
      {stage === "documents" ? (
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {SLOTS.map((slot) => (
            <DocumentSlot
              key={slot}
              id={`person-doc-${slot}`}
              icon={
                slot === "identity" ? (
                  <NiDocumentFull size="medium" className={TILE_TONE.secondary.text} />
                ) : (
                  <NiHome size="medium" className={TILE_TONE.secondary.text} />
                )
              }
              title={t(SLOT_WORDS[slot].title)}
              hint={t(SLOT_WORDS[slot].hint)}
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
      ) : stage === "form" ? (
        <Box className="flex flex-col gap-5">
          {anyDone ? (
            <Alert severity="info" className="neutral">
              {t("prefill-confirm-intro")}
            </Alert>
          ) : null}
          <PersonFields
            idPrefix="new-person"
            values={person}
            shown={FIELDS}
            onChange={changePerson}
            errorField={fieldProblem}
            errorText={problem ? t(ERROR_KEY[problem.code] ?? "people-new-error-failed") : null}
            disabled={busy}
            read={readFrom}
          />
          <StateLine tone="info">{t("people-new-contact")}</StateLine>
          {problem?.code === "cpf_taken" && problem.personId ? (
            <Alert
              severity="warning"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={() => onDone(problem.personId as string)}>
                  {t("people-new-open")}
                </Button>
              }
            >
              {t("people-new-cpf-taken")}
            </Alert>
          ) : problem && !fieldProblem ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(ERROR_KEY[problem.code] ?? "people-new-error-failed")}
            </Alert>
          ) : null}
        </Box>
      ) : (
        <Box className="flex flex-col gap-4">
          <StateLine tone="done">{t("people-new-next-saved", { name: saved?.name ?? "" })}</StateLine>
          {steps.length > 0 ? (
            <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
              {steps.map((item) => (
                <Box component="li" key={item.key}>
                  <Button
                    variant="outlined"
                    color="primary"
                    fullWidth
                    className="flex flex-col items-start gap-1 rounded-xl p-4 text-left normal-case"
                    onClick={() => setStep(item.key)}
                  >
                    <Typography variant="subtitle2" component="span">
                      {t(item.label)}
                    </Typography>
                    <Typography variant="body2" component="span" className="text-text-secondary font-normal">
                      {t(item.description)}
                    </Typography>
                  </Button>
                </Box>
              ))}
            </Box>
          ) : null}
          <Typography variant="body2" className="text-text-secondary">
            {t("people-new-next-only-body")}
          </Typography>
        </Box>
      )}
    </SidePanel>
  );
}
