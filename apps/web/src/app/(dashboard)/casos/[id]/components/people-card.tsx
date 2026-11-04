"use client";

import type { CaseParty, CasePerson, CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import PersonFields from "@/components/cases/person-fields";
import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiHome from "@/icons/nexture/ni-home";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import {
  checkCpf,
  confirmPersonReadFields,
  finishCaseUpload,
  removeCaseParty,
  saveCasePerson,
} from "@/lib/cases/actions";
import { caseErrorKey, missingFields, PERSON_FIELD_KEY } from "@/lib/cases/cases";
import { documentReadingOf, prefillErrorKey } from "@/lib/cases/document-prefill";
import {
  ADULT_FORM,
  MINOR_FORM,
  PERSON_FIELDS,
  type PersonField,
  personFields,
  type PersonValues,
  personValues,
} from "@/lib/cases/forms";
import { dropUnsaved, sendForReading } from "@/lib/cases/prefill-browser";
import { READ_ITEM_KEY, readItems } from "@/lib/cases/read-fields";
import { opensOnArrival } from "@/lib/cases/sections";
import { formatCpf, formatPhoneBr } from "@flyee/fields";
import { ageOn, formatDayBr, isMinorOn } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;
type Problem = { code: string; field?: string | null } | null;

/** One person, with every role they take in the case. */
type Member = { person: CasePerson; parties: CaseParty[] };

const membersOf = (parties: CaseParty[]): Member[] => {
  const byPerson = new Map<string, Member>();
  for (const party of parties) {
    const member = byPerson.get(party.person.person_id) ?? { person: party.person, parties: [] };
    member.parties.push(party);
    byPerson.set(party.person.person_id, member);
  }
  return [...byPerson.values()];
};

/** What the registry said, as a named state. */
function registryChip(person: CasePerson): { key: string; tone: StatusTone; values?: Record<string, string> } {
  const registry = person.registry;
  if (!registry) return { key: "case-cpf-unchecked", tone: "neutral" };
  if (registry.result === "not_found") return { key: "case-cpf-not-found", tone: "attention" };
  if (registry.result === "birth_date_mismatch") return { key: "case-cpf-birth-differs", tone: "attention" };
  if (registry.result === "minor") return { key: "case-cpf-minor", tone: "attention" };
  if (registry.regular === false) {
    return { key: "case-cpf-irregular", tone: "attention", values: { situation: registry.situation ?? "" } };
  }
  if (registry.nameMatches === false) return { key: "case-cpf-name-differs", tone: "attention" };
  return { key: "case-cpf-checked", tone: "positive" };
}

/**
 * Who is in the case: the passengers who claim (adults, and minors with who
 * answers for them) and the guardians. The firm fills or corrects their data
 * (the client does the same on their link), asks the registry about a CPF,
 * and adds a child or a guardian.
 */
export default function PeopleCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    | { kind: "error"; code: string }
    | { kind: "checked"; result: string; matches: boolean | null }
    | { kind: "confirmed" }
    | null
  >(null);

  const members = membersOf(state.parties);
  const list = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });
  const nameOfParty = (partyId: string | null) =>
    state.parties.find((party) => party.partyId === partyId)?.person.full_name ?? "";
  const minor = (person: CasePerson) => isMinorOn(person.birth_date, state.today) === true;
  // What is still missing of a person: a child has a shorter form, and an adult's contact is never required.
  const leftOf = (person: CasePerson) =>
    missingFields(
      person,
      minor(person)
        ? MINOR_FORM
        : ADULT_FORM.filter((field) => field !== "complement" && field !== "email" && field !== "phone"),
    );
  const incomplete = members.filter((member) => leftOf(member.person).length > 0).length;

  const roleLine = (member: Member) =>
    member.parties
      .map((party) =>
        party.role === "guardian"
          ? t("case-role-guardian")
          : party.guardianPartyId
            ? t("case-role-minor", { guardian: nameOfParty(party.guardianPartyId) })
            : t("case-role-claimant"),
      )
      .join(" · ");

  const check = async (member: Member) => {
    setBusy(member.person.person_id);
    setNotice(null);
    const result = await checkCpf(state.case.id, member.person.person_id);
    setBusy(null);
    setNotice(
      result.ok
        ? { kind: "checked", result: result.result, matches: result.matches }
        : { kind: "error", code: result.code },
    );
    if (result.ok) onChanged();
  };

  // What ONE read of a person, said by a person of the firm to agree with the documents (0094).
  const confirmRead = async (member: Member) => {
    setBusy(member.person.person_id);
    setNotice(null);
    const result = await confirmPersonReadFields(state.case.id, member.person.person_id);
    setBusy(null);
    setNotice(result.ok ? { kind: "confirmed" } : { kind: "error", code: result.code });
    if (result.ok) onChanged();
  };

  const remove = async (member: Member) => {
    setBusy(member.person.person_id);
    setNotice(null);
    // The claimant party first: a case keeps at least one, and the database says so.
    const ordered = [...member.parties].sort(
      (a, b) => (a.role === "claimant" ? -1 : 1) - (b.role === "claimant" ? -1 : 1),
    );
    for (const party of ordered) {
      const result = await removeCaseParty(state.case.id, party.partyId);
      if (!result.ok) {
        setNotice({ kind: "error", code: result.code });
        break;
      }
    }
    setBusy(null);
    onChanged();
  };

  return (
    <CollapsibleCard
      id="case-people"
      title={t("case-people-title")}
      summary={
        members.length === 0
          ? t("case-people-summary-none")
          : members.length <= 3
            ? members.map((member) => member.person.full_name).join(", ")
            : t("case-people-summary-many", {
                names: members
                  .slice(0, 2)
                  .map((member) => member.person.full_name)
                  .join(", "),
                count: members.length - 2,
              })
      }
      chip={
        incomplete > 0 ? (
          <StatusChip tone="attention" label={t("case-people-summary-incomplete", { count: incomplete })} />
        ) : null
      }
      description={t("case-people-body")}
      action={
        writable ? (
          <Button variant="outlined" color="grey" size="small" onClick={() => setEditing("new")}>
            {t("case-people-add")}
          </Button>
        ) : null
      }
      defaultOpen={opensOnArrival(state.case.status, "people", incomplete > 0)}
    >
      {notice?.kind === "error" && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
          {t(caseErrorKey(notice.code))}
        </Alert>
      )}
      {notice?.kind === "confirmed" && (
        <Alert severity="success" className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
          {t("case-person-read-confirmed")}
        </Alert>
      )}
      {notice?.kind === "checked" && (
        <Alert
          severity={notice.result === "found" && notice.matches !== false ? "success" : "warning"}
          className="neutral bg-background-paper/60!"
          onClose={() => setNotice(null)}
        >
          {notice.result !== "found"
            ? t("case-cpf-done-refused")
            : notice.matches === false
              ? t("case-cpf-done-differs")
              : t("case-cpf-done")}
        </Alert>
      )}

      {members.map((member) => {
        const person = member.person;
        const isMinor = minor(person);
        const left = leftOf(person);
        const chip = registryChip(person);
        const age = ageOn(person.birth_date, state.today);
        const facts = [
          person.cpf ? formatCpf(person.cpf) : null,
          person.birth_date
            ? `${formatDayBr(person.birth_date)}${age !== null ? ` (${t("case-age", { age })})` : ""}`
            : null,
          person.phone ? formatPhoneBr(person.phone.replace(/^55(?=\d{10,11}$)/, "")) : null,
          person.email,
          [person.city, person.uf].filter(Boolean).join("/") || null,
        ].filter(Boolean);
        const mayCheck = state.cpfLookup && !isMinor && Boolean(person.cpf) && Boolean(person.birth_date);
        return (
          <Box key={person.person_id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
            <Box className="flex flex-wrap items-start justify-between gap-2">
              <Box className="flex min-w-0 flex-col">
                <Typography variant="body1" className="font-semibold break-words">
                  {person.full_name}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {roleLine(member)}
                </Typography>
              </Box>
              {/* The registry's word, where this environment can ask it: with no lookup here, nothing waits on it. */}
              {!isMinor && (state.cpfLookup || person.registry) && (
                <StatusChip tone={chip.tone} label={t(chip.key, chip.values ?? {})} />
              )}
            </Box>
            {facts.length > 0 && (
              <Typography variant="body2" className="break-words">
                {facts.join(" · ")}
              </Typography>
            )}
            {person.registry?.name && person.registry.nameMatches === false && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-cpf-registry-name", { name: person.registry.name })}
              </Typography>
            )}
            {left.length > 0 && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-person-missing", {
                  fields: left.map((field) => t(PERSON_FIELD_KEY[field as PersonField])).join(", "),
                })}
              </Typography>
            )}
            {person.updatedVia === "client" && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-person-by-client")}
              </Typography>
            )}
            {readItems(person.readFields).length > 0 && (
              // What ONE read waits for a person's look: confirmed here in one click, or by saving the person (0094).
              <StateLine
                tone="attention"
                action={
                  writable ? (
                    <Button
                      variant="outlined"
                      color="grey"
                      size="small"
                      disabled={busy !== null}
                      onClick={() => void confirmRead(member)}
                    >
                      {busy === person.person_id ? t("cases-working") : t("case-person-read-confirm")}
                    </Button>
                  ) : undefined
                }
              >
                {t("case-person-read", {
                  items: list.format(readItems(person.readFields).map((item) => t(READ_ITEM_KEY[item]))),
                })}
              </StateLine>
            )}
            {writable && (
              <Box className="flex flex-wrap gap-2 pt-1">
                <Button variant="outlined" color="grey" size="small" onClick={() => setEditing(member)}>
                  {t("case-person-edit")}
                </Button>
                {mayCheck && (
                  <Button variant="text" size="small" disabled={busy !== null} onClick={() => void check(member)}>
                    {busy === person.person_id ? t("cases-working") : t("case-cpf-check")}
                  </Button>
                )}
                {members.length > 1 && (
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    disabled={busy !== null}
                    onClick={() => void remove(member)}
                  >
                    {t("case-person-remove")}
                  </Button>
                )}
              </Box>
            )}
          </Box>
        );
      })}
      {!state.cpfLookup && (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-cpf-not-configured")}
        </Typography>
      )}

      {editing && (
        <PersonDialog
          key={editing === "new" ? "new" : editing.person.person_id}
          state={state}
          member={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </CollapsibleCard>
  );
}

type NewRole = "adult" | "minor" | "guardian";

/** The documents a new person of the case starts from (migration 0085). */
type DocSlot = "identity" | "address";
type SentDoc = { fileId: string | null; name: string; state: SlotState };
const DOC_WORDS: Record<DocSlot, { title: string; hint: string; kind: string }> = {
  identity: {
    title: "case-person-docs-identity",
    hint: "case-person-docs-identity-hint",
    kind: "case-person-docs-kind-identity",
  },
  address: {
    title: "case-person-docs-address",
    hint: "case-person-docs-address-hint",
    kind: "case-person-docs-kind-address",
  },
};

function PersonDialog({
  state,
  member,
  onClose,
  onSaved,
}: {
  state: Ready;
  member: Member | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const start = personValues(member?.person ?? null);
  const [values, setValues] = useState<PersonValues>(start);
  const [role, setRole] = useState<NewRole>("adult");
  // A new person starts from their documents: ONE reads them into the form, which the person confirms; typing is
  // the contingency. The fields ONE read say so under them until somebody writes over them.
  const [stage, setStage] = useState<"documents" | "form">(member ? "form" : "documents");
  const [docs, setDocs] = useState<Partial<Record<DocSlot, SentDoc>>>({});
  const [readFrom, setReadFrom] = useState<ReadonlySet<PersonField>>(
    () => new Set(Object.keys(member?.person.readFields ?? {}) as PersonField[]),
  );
  const minorParty = member?.parties.find((party) => party.role === "claimant" && party.guardianPartyId) ?? null;
  // Who may answer for a minor: any adult already in the case.
  const adults = membersOf(state.parties).filter(
    (other) =>
      other.person.person_id !== member?.person.person_id && isMinorOn(other.person.birth_date, state.today) !== true,
  );
  const [guardian, setGuardian] = useState<string>(
    minorParty
      ? (state.parties.find((party) => party.partyId === minorParty.guardianPartyId)?.person.person_id ?? "")
      : (adults[0]?.person.person_id ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

  const isMinorNow = member
    ? isMinorOn(values.birth_date, state.today) === true || Boolean(minorParty)
    : role === "minor";
  const shown: readonly PersonField[] = isMinorNow ? MINOR_FORM : ADULT_FORM;
  // A minor who claims needs who answers for them: also one the case had with no guardian yet.
  const claims = member ? member.parties.some((party) => party.role === "claimant") : role !== "guardian";
  const needsGuardian = member ? claims && isMinorNow : role === "minor";
  // With no adult in the case yet, a child's data is still saved; the guardian comes after.
  const guardianRequired = needsGuardian && adults.length > 0;

  /** The guardian party of a person of the case, created when they have none yet. */
  const guardianPartyOf = async (personId: string): Promise<string | null> => {
    const existing = state.parties.find((party) => party.person.person_id === personId && party.role === "guardian");
    if (existing) return existing.partyId;
    const result = await saveCasePerson({ caseId: state.case.id, personId, fields: {}, role: "guardian" });
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return null;
    }
    return result.partyId;
  };

  const change = (next: PersonValues) => {
    setReadFrom((current) => {
      const out = new Set(current);
      for (const field of PERSON_FIELDS) if (next[field] !== values[field]) out.delete(field);
      return out;
    });
    setValues(next);
  };

  const sendDocument = async (slot: DocSlot, file: File) => {
    const before = docs[slot]?.fileId;
    setDocs((current) => ({ ...current, [slot]: { fileId: null, name: file.name, state: { kind: "reading" } } }));
    const sent = await sendForReading(file, slot === "identity" ? "identity" : "address_proof");
    if (before) dropUnsaved([before]);
    if (!sent.ok) {
      const sentence = t(prefillErrorKey(sent.code));
      setDocs((current) => ({
        ...current,
        [slot]: { fileId: sent.fileId, name: file.name, state: { kind: "failed", sentence } },
      }));
      return;
    }
    const reading = documentReadingOf(sent.output, state.today);
    const kind = t(DOC_WORDS[slot].kind);
    const filled = reading.person.read.filter((field) => !values[field] || readFrom.has(field));
    setValues((current) => {
      const next = { ...current };
      for (const field of filled) next[field] = reading.person.values[field] ?? next[field];
      return next;
    });
    setReadFrom((current) => new Set([...current, ...filled]));
    const sentence = !reading.matches
      ? t("prefill-read-other", { kind, identified: reading.identified || t("prefill-read-unknown") })
      : !reading.legible
        ? [t("prefill-read-illegible"), reading.note].filter(Boolean).join(" ")
        : reading.person.read.length === 0
          ? [t("prefill-read-nothing"), reading.note].filter(Boolean).join(" ")
          : [t("prefill-read-ok", { identified: reading.identified || kind }), reading.note].filter(Boolean).join(" ");
    const good = reading.matches && reading.legible && reading.person.read.length > 0;
    setDocs((current) => ({
      ...current,
      [slot]: {
        fileId: sent.fileId,
        name: file.name,
        state: { kind: "read", tone: good ? "positive" : "attention", sentence },
      },
    }));
  };

  // A document sent and never saved with the person goes with the dialog.
  const close = () => {
    dropUnsaved(Object.values(docs).map((doc) => doc?.fileId));
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    let guardianParty: string | null = null;
    if (guardianRequired) {
      if (!guardian) {
        setBusy(false);
        setProblem({ code: "guardian_not_found" });
        return;
      }
      guardianParty = await guardianPartyOf(guardian);
      if (!guardianParty) {
        setBusy(false);
        setProblem((current) => current ?? { code: "guardian_not_found" });
        return;
      }
    }
    const result = await saveCasePerson({
      caseId: state.case.id,
      personId: member?.person.person_id ?? null,
      fields: personFields(values, shown, member ? start : undefined),
      role: member ? null : role === "guardian" ? "guardian" : "claimant",
      guardianPartyId: guardianParty,
    });
    if (!result.ok) {
      setBusy(false);
      setProblem({ code: result.code, field: result.field });
      return;
    }
    // The documents the person came from join the case as theirs, where the check of each runs as on any other.
    for (const slot of ["identity", "address"] as const) {
      const doc = docs[slot];
      if (!doc?.fileId) continue;
      const joined = await finishCaseUpload({
        caseId: state.case.id,
        fileId: doc.fileId,
        kind: slot === "identity" ? "identity" : "address_proof",
        partyId: result.partyId,
      });
      if (!joined.ok) dropUnsaved([doc.fileId]);
    }
    // Saving a person whose data ONE read says somebody looked at them: the marks left go (0094). Best effort: the
    // save went through, and the card still offers the confirmation if this did not.
    if (member && readFrom.size > 0) {
      await confirmPersonReadFields(state.case.id, member.person.person_id).catch(() => null);
    }
    setBusy(false);
    onSaved();
  };

  const slotLabels = {
    send: t("prefill-send"),
    again: t("prefill-again"),
    sending: t("prefill-sending"),
    reading: t("prefill-reading"),
    read: t("prefill-read"),
    failed: t("prefill-failed"),
  };
  const slots: DocSlot[] = role === "minor" ? ["identity"] : ["identity", "address"];
  const reading = Object.values(docs).some((doc) => doc?.state.kind === "reading");
  const anyDone = Object.values(docs).some((doc) => doc?.state.kind === "read" || doc?.state.kind === "failed");
  const fromDocuments = Object.values(docs).some((doc) => doc?.state.kind === "read");

  return (
    <Dialog
      open
      onClose={busy || reading ? undefined : close}
      maxWidth="md"
      fullWidth
      aria-labelledby="case-person-dialog"
    >
      <DialogHeader
        id="case-person-dialog"
        title={member ? member.person.full_name : t("case-people-add")}
        onClose={close}
        closeLabel={t("cases-close")}
      />
      {stage === "documents" && (
        <>
          <DialogContent>
            <Box className="flex flex-col gap-4">
              <RadioGroup
                aria-label={t("case-people-role")}
                value={role}
                onChange={(event) => setRole(event.target.value as NewRole)}
              >
                <FormControlLabel value="adult" control={<Radio size="small" />} label={t("case-people-role-adult")} />
                <FormControlLabel
                  value="minor"
                  control={<Radio size="small" />}
                  label={t("case-people-role-minor")}
                  disabled={adults.length === 0}
                />
                <FormControlLabel
                  value="guardian"
                  control={<Radio size="small" />}
                  label={t("case-people-role-guardian")}
                />
              </RadioGroup>
              <Typography variant="body2" className="text-text-secondary">
                {t("case-person-docs-intro")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                {slots.map((slot) => (
                  <DocumentSlot
                    key={slot}
                    id={`case-person-doc-${slot}`}
                    icon={
                      slot === "identity" ? (
                        <NiDocumentFull size="medium" className={TILE_TONE.primary.text} />
                      ) : (
                        <NiHome size="medium" className={TILE_TONE.primary.text} />
                      )
                    }
                    title={t(DOC_WORDS[slot].title)}
                    hint={t(DOC_WORDS[slot].hint)}
                    state={docs[slot]?.state ?? { kind: "empty" }}
                    fileName={docs[slot]?.name}
                    primary={slot === "identity"}
                    disabled={busy}
                    labels={slotLabels}
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
            <Box className="flex flex-col gap-4">
              {fromDocuments && (
                <Alert severity="info" className="neutral">
                  {t("prefill-confirm-intro")}
                </Alert>
              )}
              {member && readFrom.size > 0 && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("case-person-read-save-confirms")}
                </Typography>
              )}
              {!member && (
                <RadioGroup
                  aria-label={t("case-people-role")}
                  value={role}
                  onChange={(event) => setRole(event.target.value as NewRole)}
                >
                  <FormControlLabel
                    value="adult"
                    control={<Radio size="small" />}
                    label={t("case-people-role-adult")}
                  />
                  <FormControlLabel
                    value="minor"
                    control={<Radio size="small" />}
                    label={t("case-people-role-minor")}
                    disabled={adults.length === 0}
                  />
                  <FormControlLabel
                    value="guardian"
                    control={<Radio size="small" />}
                    label={t("case-people-role-guardian")}
                  />
                </RadioGroup>
              )}
              {needsGuardian && !guardianRequired && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("case-people-guardian-none")}
                </Typography>
              )}
              {guardianRequired && (
                <TextField
                  select
                  size="small"
                  fullWidth
                  id="case-person-guardian"
                  label={t("case-people-guardian")}
                  helperText={t("case-people-guardian-help")}
                  value={guardian}
                  disabled={busy}
                  onChange={(event) => setGuardian(event.target.value)}
                >
                  {adults.map((adult) => (
                    <MenuItem key={adult.person.person_id} value={adult.person.person_id}>
                      {adult.person.full_name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <PersonFields
                idPrefix={`case-person-${member?.person.person_id ?? "new"}`}
                values={values}
                shown={shown}
                onChange={change}
                errorField={problem?.field}
                errorText={problem ? t(caseErrorKey(problem.code)) : null}
                disabled={busy}
                read={readFrom}
              />
              {member?.person.registry && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("case-cpf-change-clears")}
                </Typography>
              )}
              {problem && !problem.field && (
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {t(caseErrorKey(problem.code))}
                </Alert>
              )}
            </Box>
          </DialogContent>
          <DialogActions className="flex-wrap justify-between gap-2">
            {member ? (
              <span />
            ) : (
              <Button variant="text" color="grey" disabled={busy} onClick={() => setStage("documents")}>
                {t("prefill-back")}
              </Button>
            )}
            <Box className="flex gap-2">
              <Button variant="text" color="grey" onClick={close} disabled={busy}>
                {t("cases-cancel")}
              </Button>
              <Button type="submit" variant="contained" disabled={busy}>
                {busy ? t("cases-working") : t("cases-save")}
              </Button>
            </Box>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}
