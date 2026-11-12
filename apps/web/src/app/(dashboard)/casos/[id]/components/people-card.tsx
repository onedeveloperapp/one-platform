"use client";

import type { CaseParty, CasePerson, CaseState } from "../case-types";
import { sentence, useCaseAction } from "./case-action";
import { useClientAsked } from "./client-asked";
import PersonReadCheck, { ADDRESS_FIELDS, addressLine, readFacts, sourceOf } from "./person-read-check";
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
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import FactGrid, { type Fact } from "@/components/product/fact-grid";
import QuickActions from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiClock from "@/icons/nexture/ni-clock";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiHome from "@/icons/nexture/ni-home";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import NiPlus from "@/icons/nexture/ni-plus";
import {
  checkCpf,
  confirmPersonReadFields,
  finishCaseUpload,
  removeCaseParty,
  saveCasePerson,
} from "@/lib/cases/actions";
import {
  caseErrorKey,
  MARITAL_KEY,
  MARITAL_STATUSES,
  type MaritalStatus,
  missingFields,
  PERSON_FIELD_KEY,
} from "@/lib/cases/cases";
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
import { readItems } from "@/lib/cases/read-fields";
import { opensOnArrival } from "@/lib/cases/sections";
import { formatCpf, formatPhoneBr } from "@flyee/fields";
import { ageOn, formatDayBr, isMinorOn } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

const isMarital = (value: string): value is MaritalStatus => (MARITAL_STATUSES as readonly string[]).includes(value);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
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
  // One action at a time on the case: while one runs, every control waits, and the result shows before they come back.
  const action = useCaseAction("people");
  const words = {
    check: { doing: t("case-action-cpf-doing"), failed: t("case-action-cpf-failed") },
    read: { doing: t("case-action-read-doing"), failed: t("case-action-read-failed") },
    remove: {
      doing: t("case-action-person-remove-doing"),
      done: t("case-action-person-remove-done"),
      failed: t("case-action-person-remove-failed"),
    },
  };
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
  // What ONE read waits for a look of the firm.
  const toCheck = members.some((member) => readItems(member.person.readFields).length > 0);

  // What is missing of a person is the client's to give on their link, said with who answers and since when.
  const asked = useClientAsked(state);
  const [checking, setChecking] = useState<Member | null>(null);

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

  const check = (member: Member) =>
    action.run(`cpf-${member.person.person_id}`, words.check, async () => {
      setNotice(null);
      const result = await checkCpf(state.case.id, member.person.person_id);
      setNotice(
        result.ok
          ? { kind: "checked", result: result.result, matches: result.matches }
          : { kind: "error", code: result.code },
      );
      return result.ok;
    });

  // What ONE read of a person, said by a person of the firm to agree with the documents (0094).
  const confirmRead = (member: Member) =>
    action.run(`read-${member.person.person_id}`, words.read, async () => {
      setNotice(null);
      const result = await confirmPersonReadFields(state.case.id, member.person.person_id);
      setNotice(result.ok ? { kind: "confirmed" } : { kind: "error", code: result.code });
      return result.ok;
    });

  // Taking a person out of the case is said before it is done: what goes with them, what stays.
  const [removing, setRemoving] = useState<Member | null>(null);

  const remove = async (member: Member) => {
    const removed = { any: false };
    const ok = await action.run(`remove-${member.person.person_id}`, words.remove, async () => {
      setNotice(null);
      // The claimant party first: a case keeps at least one, and the database says so.
      const ordered = [...member.parties].sort(
        (a, b) => (a.role === "claimant" ? -1 : 1) - (b.role === "claimant" ? -1 : 1),
      );
      for (const party of ordered) {
        const result = await removeCaseParty(state.case.id, party.partyId);
        if (!result.ok) {
          setNotice({ kind: "error", code: result.code });
          return false;
        }
        removed.any = true;
      }
      return true;
    });
    // Taken out of one role and refused the other: what was done shows all the same.
    if (!ok && removed.any) onChanged();
  };

  const removingDialog = removing ? (
    <ConfirmActionDialog
      title={t("case-person-remove-title", { name: removing.person.full_name })}
      consequences={[t("case-person-remove-consequence-link"), t("case-person-remove-consequence-answers")]}
      staysTitle={t("confirm-stays")}
      stays={[t("case-person-remove-stays")]}
      requireReason={false}
      confirmLabel={t("case-person-remove")}
      cancelLabel={t("cases-cancel")}
      busyLabel={t("cases-working")}
      tone="danger"
      onConfirm={async () => {
        await remove(removing);
        return null;
      }}
      onClose={() => setRemoving(null)}
    />
  ) : null;

  return (
    <CollapsibleCard
      id="case-people"
      title={t("case-people-title")}
      summary={[
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
              }),
        incomplete > 0 ? t("case-people-summary-owed", { count: incomplete }) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      ask={
        writable && toCheck
          ? { tone: "firm", label: t("card-state-people-firm") }
          : incomplete > 0
            ? { tone: "client", label: t("card-state-client") }
            : null
      }
      description={t("case-people-body")}
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
        const marks = person.readFields;
        const owedChip = <StatusChip tone="info" icon={<NiClock size="small" />} label={t("case-person-owed-chip")} />;
        const owes = (field: PersonField) => (left.includes(field) ? owedChip : undefined);
        const address = addressLine(person);
        const facts: Fact[] = [
          {
            key: "cpf",
            label: t(PERSON_FIELD_KEY.cpf),
            value: person.cpf ? formatCpf(person.cpf) : null,
            read: Boolean(marks.cpf),
            owed: owes("cpf"),
          },
          {
            key: "birth_date",
            label: t(PERSON_FIELD_KEY.birth_date),
            value: person.birth_date
              ? `${formatDayBr(person.birth_date)}${age !== null ? ` · ${t("case-age", { age })}` : ""}`
              : null,
            read: Boolean(marks.birth_date),
            owed: owes("birth_date"),
          },
          ...(isMinor
            ? []
            : [
                {
                  key: "nationality",
                  label: t(PERSON_FIELD_KEY.nationality),
                  value: person.nationality,
                  read: Boolean(marks.nationality),
                  owed: owes("nationality"),
                },
                {
                  key: "marital_status",
                  label: t(PERSON_FIELD_KEY.marital_status),
                  value:
                    person.marital_status && isMarital(person.marital_status)
                      ? t(MARITAL_KEY[person.marital_status])
                      : person.marital_status,
                  owed: owes("marital_status"),
                },
                {
                  key: "profession",
                  label: t(PERSON_FIELD_KEY.profession),
                  value: person.profession,
                  owed: owes("profession"),
                },
                {
                  key: "phone",
                  label: t(PERSON_FIELD_KEY.phone),
                  value: person.phone ? formatPhoneBr(person.phone.replace(/^55(?=\d{10,11}$)/, "")) : null,
                },
                { key: "email", label: t(PERSON_FIELD_KEY.email), value: person.email },
                {
                  key: "address",
                  label: t("case-person-fact-address"),
                  value: address,
                  read: ADDRESS_FIELDS.some((field) => marks[field]),
                  owed:
                    left.some((field) => (ADDRESS_FIELDS as readonly string[]).includes(field)) && !address
                      ? owedChip
                      : undefined,
                  wide: true,
                },
              ]),
        ];
        const read = readFacts(person, marks, (field) => t(PERSON_FIELD_KEY[field]));
        const readSources = [...new Set(read.map((fact) => fact.kind))].map((kind) => t(sourceOf(kind).from));
        const mayCheck = state.cpfLookup && !isMinor && Boolean(person.cpf) && Boolean(person.birth_date);
        const missingWords = list.format(left.map((field) => t(PERSON_FIELD_KEY[field as PersonField]).toLowerCase()));
        const owedText = left.length > 0 ? asked(person.person_id, capitalize(missingWords)) : null;
        const more = [
          ...(writable && members.length > 1
            ? [
                {
                  key: "remove",
                  label: t("case-person-remove"),
                  icon: <NiCrossSquare size="medium" />,
                  onClick: () => setRemoving(member),
                },
              ]
            : []),
        ];
        return (
          <Box key={person.person_id} className="border-grey-100 flex flex-col gap-4 rounded-2xl border p-4">
            <Box className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Box className="flex min-w-0 flex-1 basis-56 flex-col">
                <Typography variant="body1" className="font-semibold break-words">
                  {person.full_name}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {roleLine(member)}
                </Typography>
              </Box>
              {/* The registry's word, where this environment can ask it; never asked yet, the way to ask it. */}
              {!isMinor && person.registry ? (
                <StatusChip tone={chip.tone} label={t(chip.key, chip.values ?? {})} />
              ) : null}
              {writable && mayCheck && !person.registry ? (
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  disabled={action.busy}
                  loading={action.pending(`cpf-${person.person_id}`)}
                  loadingPosition="start"
                  onClick={() => void check(member)}
                >
                  {action.pending(`cpf-${person.person_id}`) ? sentence(words.check.doing) : t("case-cpf-check")}
                </Button>
              ) : null}
              {writable ? (
                <Button variant="outlined" color="grey" size="small" onClick={() => setEditing(member)}>
                  {t("case-person-edit")}
                </Button>
              ) : null}
              {more.length > 0 ? (
                <QuickActions label={t("case-person-more", { name: person.full_name })} actions={more} />
              ) : null}
            </Box>

            <FactGrid facts={facts} />

            {person.registry?.name && person.registry.nameMatches === false && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-cpf-registry-name", { name: person.registry.name })}
              </Typography>
            )}
            {person.updatedVia === "client" && (
              <Typography variant="caption" className="text-text-secondary">
                {t("case-person-by-client")}
              </Typography>
            )}

            {read.length > 0 || owedText ? (
              <Box className="border-grey-100 flex flex-col gap-3 border-t pt-4">
                {read.length > 0 ? (
                  // What ONE read waits for a person's look, with the documents in front of them (0094).
                  <StateLine
                    tone="attention"
                    action={
                      writable ? (
                        <Button
                          variant="outlined"
                          color="grey"
                          size="small"
                          disabled={action.busy}
                          onClick={() => setChecking(member)}
                        >
                          {t("case-person-read-open")}
                        </Button>
                      ) : undefined
                    }
                  >
                    {t("case-person-read-check", { count: read.length, sources: list.format(readSources) })}
                  </StateLine>
                ) : null}
                {owedText ? (
                  // What is missing is the client's to give on their link (`WAIT_PLACE.case_incomplete`): said with
                  // who answers and since when, the firm's own way in as the exception it is.
                  <StateLine
                    tone="waiting"
                    action={
                      writable ? (
                        <Button variant="text" color="grey" size="small" onClick={() => setEditing(member)}>
                          {t("case-person-fill-for-client")}
                        </Button>
                      ) : undefined
                    }
                  >
                    {owedText}
                  </StateLine>
                ) : null}
              </Box>
            ) : null}
          </Box>
        );
      })}

      {checking && (
        <PersonReadCheck
          key={checking.person.person_id}
          person={checking.person}
          marks={checking.person.readFields}
          documents={state.documents}
          busy={action.pending(`read-${checking.person.person_id}`)}
          onConfirm={() =>
            void confirmRead(checking).then((ok) => {
              if (ok) setChecking(null);
            })
          }
          onCorrect={() => {
            const member = checking;
            setChecking(null);
            setEditing(member);
          }}
          onClose={() => setChecking(null)}
        />
      )}

      {writable ? (
        <Box>
          <Button
            variant="text"
            color="grey"
            size="small"
            startIcon={<NiPlus size="small" />}
            onClick={() => setEditing("new")}
          >
            {t("case-people-add")}
          </Button>
        </Box>
      ) : null}

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
      {removingDialog}
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
