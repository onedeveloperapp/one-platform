"use client";

import type { CaseState } from "../case-types";
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
  Link,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import StatusChip from "@/components/product/status-chip";
import { caseErrorKey } from "@/lib/cases/cases";
import { type CivilCourtNeed, COURT_NOTE_STANCE_KEY, type CourtNote, noteForState } from "@/lib/cases/family";
import { recordCivilCourtAnswer, setFamilyChoice } from "@/lib/cases/rule-actions";
import type { FamilyPlan } from "@flyee/rules/proceedings";

type Ready = Extract<CaseState, { kind: "ready" }>;

/** How an acceptance is said: given on the client's own link, or recorded by the firm. */
const acceptedKey = (source: CivilCourtNeed["source"]): string =>
  source === "client" ? "case-civil-accepted-link" : "case-civil-accepted-firm";

/** What to do after a "no": a minor's claim cannot leave the civil court, an adult's may with a split. */
const declinedHintKey = (minor: boolean): string =>
  minor ? "case-civil-declined-hint-minor" : "case-civil-declined-hint-adult";

/** A refusal of the family's choice, in the words of the family: the rest are the case's own. */
const familyErrorKey = (code: string): string =>
  code === "not_a_lawyer" ? "case-family-not-lawyer" : caseErrorKey(code);

const day = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso))
    : "";

/** What the platform read of the court a family's lawsuits go to, with its sources. */
function CourtNoteBox({ note }: { note: CourtNote }) {
  const t = useTranslations("product");
  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
      <Box className="flex flex-wrap items-center gap-2">
        <StatusChip tone="attention" label={t(COURT_NOTE_STANCE_KEY[note.stance], { court: note.court })} />
        <Typography variant="caption" className="text-text-secondary">
          {t("case-family-note-read", { date: day(note.readOn) })}
        </Typography>
      </Box>
      <Typography variant="body2">{note.summary}</Typography>
      <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
        {note.sources.map((source) => (
          <Typography component="li" variant="body2" key={source.url}>
            <Link href={source.url} target="_blank" rel="noopener noreferrer">
              {source.label}
            </Link>
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

/**
 * How the family goes to court, under the lawsuits the rule plans: together
 * in the civil court when a minor is among the claimants (the default), or
 * split by a lawyer, with the reason and what the court of the domicile
 * decided of a split. Before the lawsuits are planned the choice plans them;
 * once some are, it records what they are, and the box says when the
 * lawsuits planned and the choice disagree (adults planned in the
 * small-claims court before a minor joined): no package leaves so.
 */
export function FamilyPlanBox({
  state,
  family,
  writable,
  onChanged,
}: {
  state: Ready;
  family: FamilyPlan;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [splitting, setSplitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (family === "single") return null;

  const chosen = state.rules.family;
  const chooser = state.team.find((member) => member.userId === chosen.byId)?.name ?? "";
  const note = noteForState(state.rules.courtNotes, state.courts, state.rules.domicile?.uf ?? null);
  const planned = state.proceedings.filter((proceeding) => proceeding.status === "planned");
  const plannedJuizado = planned.some((proceeding) => proceeding.kind === "juizado");
  // Once a lawsuit of the family is in court, how it went is a fact: nothing is chosen any more.
  const filed = state.proceedings.some((proceeding) => proceeding.status !== "planned");
  // A choice that agrees with what is planned: a split beside a small-claims lawsuit planned already, or
  // before anything is; the family together while none is planned in the small-claims court.
  const canSplit = family === "together" && (planned.length === 0 || plannedJuizado);
  const canJoin = family === "split" && !plannedJuizado;
  // Once a lawsuit is filed nothing is chosen any more, unless adults planned in the small-claims court still wait
  // beside a minor whose lawsuit went first: then the split is recorded for them.
  const lawyerHere = writable && state.lawyer && (!filed || plannedJuizado);
  const mismatch = family === "together" && plannedJuizado;

  const together = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setFamilyChoice(state.case.id, "together", null);
      if (!result.ok) setProblem(result.code);
      else onChanged();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box className="flex flex-col gap-2">
      {mismatch ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("case-family-mismatch")}
        </Alert>
      ) : family === "together" ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-family-together")}
        </Typography>
      ) : (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          <Box className="flex flex-col gap-2">
            <Typography variant="body2">
              {chooser
                ? t("case-family-split", { name: chooser, date: day(chosen.at), reason: chosen.reason ?? "" })
                : t("case-family-split-unnamed", { reason: chosen.reason ?? "" })}
            </Typography>
            <Typography variant="body2">{t("case-family-split-guide")}</Typography>
          </Box>
        </Alert>
      )}
      {family === "split" && note && <CourtNoteBox note={note} />}
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(familyErrorKey(problem))}
        </Alert>
      )}
      {lawyerHere && (canSplit || canJoin) ? (
        <Box>
          {canSplit ? (
            <Button variant="outlined" color="grey" size="small" disabled={busy} onClick={() => setSplitting(true)}>
              {t("case-family-split-action")}
            </Button>
          ) : (
            <Button variant="outlined" color="grey" size="small" disabled={busy} onClick={() => void together()}>
              {busy ? t("cases-working") : t("case-family-together-action")}
            </Button>
          )}
        </Box>
      ) : lawyerHere ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-family-planned")}
        </Typography>
      ) : null}
      {splitting && (
        <SplitDialog
          caseId={state.case.id}
          note={note}
          onClose={() => setSplitting(false)}
          onSaved={() => {
            setSplitting(false);
            onChanged();
          }}
        />
      )}
    </Box>
  );
}

/** A lawyer splits the family, with the reason, told first what the court of the domicile decided of a split. */
function SplitDialog({
  caseId,
  note,
  onClose,
  onSaved,
}: {
  caseId: string;
  note: CourtNote | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setFamilyChoice(caseId, "split", reason);
      if (!result.ok) setProblem(result.code);
      else onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="family-split-dialog">
      <DialogHeader
        id="family-split-dialog"
        title={t("case-family-split-title")}
        onClose={onClose}
        closeLabel={t("hearing-close")}
      />
      <DialogContent className="flex flex-col gap-3">
        <Typography variant="body2" className="text-text-secondary">
          {t("case-family-split-body")}
        </Typography>
        {note ? (
          <CourtNoteBox note={note} />
        ) : (
          <Typography variant="body2" className="text-text-secondary">
            {t("case-family-note-none")}
          </Typography>
        )}
        <Typography variant="body2">{t("case-family-split-guide")}</Typography>
        <TextField
          size="small"
          id="family-split-reason"
          label={t("case-family-split-reason")}
          value={reason}
          disabled={busy}
          multiline
          minRows={2}
          onChange={(event) => setReason(event.target.value.slice(0, 1000))}
        />
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(familyErrorKey(problem))}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("hearing-cancel")}
        </Button>
        <Button variant="contained" disabled={busy || reason.trim().length < 8} onClick={() => void submit()}>
          {busy ? t("cases-working") : t("case-family-split-confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Each claimant of a lawsuit in the civil court, and their word on it: asked
 * while the lawsuit is planned (given on their link, recorded by the firm
 * with how, or still missing), kept as the firm's record once it is filed.
 * A "no" holds the filing until somebody talks it over. Anybody of the firm
 * records a word given some other way.
 */
export function CivilCourtAnswers({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  // The claimant whose word is being recorded: what the dialog shows is read from the case on every render, so a
  // newer answer or newer words reach it without closing it.
  const [recording, setRecording] = useState<string | null>(null);
  if (state.civilCourt.length === 0) return null;
  const recordingNeed = state.civilCourt.find((need) => need.partyId === recording && need.planned) ?? null;

  const partyName = (partyId: string) =>
    state.parties.find((party) => party.partyId === partyId)?.person.full_name ?? "";
  const personName = (personId: string | null) =>
    state.parties.find((party) => party.person.person_id === personId)?.person.full_name ?? "";

  return (
    <Box className="border-grey-100 flex flex-col gap-3 border-t pt-5">
      <Typography variant="subtitle2" component="h3" className="mb-0">
        {t("case-civil-title")}
      </Typography>
      <Typography variant="body2" className="text-text-secondary">
        {t("case-civil-body")}
      </Typography>
      <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
        {state.civilCourt.map((need) => (
          <Box
            component="li"
            key={need.partyId}
            className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <Box className="flex flex-col gap-1">
              <Typography variant="body1">
                {need.minor && need.answererId
                  ? t("case-civil-person-minor", {
                      name: partyName(need.partyId),
                      guardian: personName(need.answererId),
                    })
                  : partyName(need.partyId)}
              </Typography>
              <Box className="flex flex-wrap items-center gap-2">
                {need.accepted === true ? (
                  <StatusChip tone="positive" label={t(acceptedKey(need.source), { date: day(need.recordedAt) })} />
                ) : need.accepted === false ? (
                  <StatusChip tone="attention" label={t("case-civil-declined", { date: day(need.recordedAt) })} />
                ) : (
                  <StatusChip tone="neutral" label={t(need.planned ? "case-civil-waiting" : "case-civil-none")} />
                )}
                {!need.planned && (
                  <Typography variant="caption" className="text-text-secondary">
                    {t("case-civil-filed")}
                  </Typography>
                )}
              </Box>
              {need.note && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("case-civil-how", { note: need.note })}
                </Typography>
              )}
              {need.planned && need.accepted === false && (
                <Typography variant="body2" className="text-text-secondary">
                  {t(declinedHintKey(need.minor))}
                </Typography>
              )}
              {need.planned && !need.answererId && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("case-civil-no-guardian", { name: partyName(need.partyId) })}
                </Typography>
              )}
            </Box>
            {writable && need.planned && need.answererId && (
              <Box>
                <Button variant="text" color="grey" size="small" onClick={() => setRecording(need.partyId)}>
                  {t("case-civil-record")}
                </Button>
              </Box>
            )}
          </Box>
        ))}
      </Box>
      {recordingNeed && (
        <CivilCourtDialog
          caseId={state.case.id}
          need={recordingNeed}
          name={partyName(recordingNeed.partyId)}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            onChanged();
          }}
          onStale={onChanged}
        />
      )}
    </Box>
  );
}

/** The firm records a word given some other way than the link, in the words in force, saying how. */
function CivilCourtDialog({
  caseId,
  need,
  name,
  onClose,
  onSaved,
  onStale,
}: {
  caseId: string;
  need: CivilCourtNeed;
  name: string;
  onClose: () => void;
  onSaved: () => void;
  /** The case is read again: another answer, or other words, came since the screen was read. */
  onStale: () => void;
}) {
  const t = useTranslations("product");
  const [accepted, setAccepted] = useState<"yes" | "no" | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    if (accepted === "") return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await recordCivilCourtAnswer(
        caseId,
        need.partyId,
        accepted === "yes",
        note,
        need.answerId,
        need.wording ?? "",
      );
      if (!result.ok) {
        setProblem(result.code);
        // Another answer, or other words, came since this screen was read: the case is read again and the dialog
        // stays open with what was typed, now over what is in force.
        if (result.code === "answer_changed" || result.code === "wording_changed") onStale();
      } else onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="civil-court-dialog">
      <DialogHeader
        id="civil-court-dialog"
        title={t("case-civil-record-title", { name })}
        onClose={onClose}
        closeLabel={t("hearing-close")}
      />
      <DialogContent className="flex flex-col gap-3">
        {need.wording ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="subtitle2" component="p" className="mb-0">
              {t("case-civil-wording")}
            </Typography>
            <Typography variant="body2" className="border-grey-100 rounded-2xl border p-3">
              {need.wording}
            </Typography>
          </Box>
        ) : null}
        <RadioGroup
          aria-label={t("case-civil-record-title", { name })}
          value={accepted}
          onChange={(event) => setAccepted(event.target.value as "yes" | "no")}
        >
          <FormControlLabel value="yes" control={<Radio />} label={t("case-civil-option-yes")} disabled={busy} />
          <FormControlLabel value="no" control={<Radio />} label={t("case-civil-option-no")} disabled={busy} />
        </RadioGroup>
        <TextField
          size="small"
          id="civil-court-note"
          label={t("case-civil-note")}
          value={note}
          disabled={busy}
          multiline
          minRows={2}
          onChange={(event) => setNote(event.target.value.slice(0, 500))}
          helperText={t("case-civil-note-help")}
        />
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(caseErrorKey(problem))}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("hearing-cancel")}
        </Button>
        <Button
          variant="contained"
          disabled={busy || accepted === "" || note.trim().length < 8 || !need.wording}
          onClick={() => void submit()}
        >
          {busy ? t("cases-working") : t("case-civil-save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
