"use client";

import type { CaseParty, CasePerson, CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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

import PersonFields from "@/components/cases/person-fields";
import DialogHeader from "@/components/product/dialog-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { checkCpf, removeCaseParty, saveCasePerson } from "@/lib/cases/actions";
import { caseErrorKey, missingFields, PERSON_FIELD_KEY } from "@/lib/cases/cases";
import {
  ADULT_FORM,
  MINOR_FORM,
  type PersonField,
  personFields,
  type PersonValues,
  personValues,
} from "@/lib/cases/forms";
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
    { kind: "error"; code: string } | { kind: "checked"; result: string; matches: boolean | null } | null
  >(null);

  const members = membersOf(state.parties);
  const nameOfParty = (partyId: string | null) =>
    state.parties.find((party) => party.partyId === partyId)?.person.full_name ?? "";
  const minor = (person: CasePerson) => isMinorOn(person.birth_date, state.today) === true;

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
    <Card component="section" aria-labelledby="case-people">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-wrap items-start justify-between gap-2">
          <Box className="flex flex-col gap-1">
            <Typography id="case-people" variant="h5" component="h2" className="mb-0">
              {t("case-people-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("case-people-body")}
            </Typography>
          </Box>
          {writable && (
            <Button variant="outlined" color="grey" size="small" onClick={() => setEditing("new")}>
              {t("case-people-add")}
            </Button>
          )}
        </Box>

        {notice?.kind === "error" && (
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
            {t(caseErrorKey(notice.code))}
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
          const left = missingFields(
            person,
            isMinor
              ? MINOR_FORM
              : ADULT_FORM.filter((field) => field !== "complement" && field !== "email" && field !== "phone"),
          );
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
                {!isMinor && <StatusChip tone={chip.tone} label={t(chip.key, chip.values ?? {})} />}
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
      </CardContent>

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
    </Card>
  );
}

type NewRole = "adult" | "minor" | "guardian";

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
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="case-person-dialog">
      <DialogHeader
        id="case-person-dialog"
        title={member ? member.person.full_name : t("case-people-add")}
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
          <Box className="flex flex-col gap-4">
            {!member && (
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
              onChange={setValues}
              errorField={problem?.field}
              errorText={problem ? t(caseErrorKey(problem.code)) : null}
              disabled={busy}
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
