"use client";

import type { CaseProceeding, CaseState } from "../case-types";
import { useCaseAction } from "./case-action";
import CourtCourse from "./court-course";
import CourtSystem from "./court-system";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import IllustrationLaunch from "@/icons/illustrations/illustration-launch";
import { removeProceeding, saveProceeding } from "@/lib/cases/actions";
import { caseErrorKey } from "@/lib/cases/cases";
import { caseDomicile, lawyerNeedsSupplementary, ruleParties } from "@/lib/cases/rules";
import { opensOnArrival } from "@/lib/cases/sections";
import { formatCnj } from "@flyee/rules/cnj";
import { formatDayBr } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

const KINDS = ["juizado", "comum"] as const;
// The systems a lawsuit may name: ONE names a planned lawsuit's (0066), so the dialog offers none.
type System = "projudi" | "eproc" | "pje" | "esaj" | "outro";
const BASES = ["domicile", "event_place", "defendant_seat", "other"] as const;
const STATUSES = ["planned", "filed", "closed"] as const;

const KIND_KEY: Record<(typeof KINDS)[number], string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};
const SYSTEM_KEY: Record<System, string> = {
  projudi: "case-system-projudi",
  eproc: "case-system-eproc",
  pje: "case-system-pje",
  esaj: "case-system-esaj",
  outro: "case-system-outro",
};
const BASIS_KEY: Record<(typeof BASES)[number], string> = {
  domicile: "case-forum-domicile",
  event_place: "case-forum-event-place",
  defendant_seat: "case-forum-defendant-seat",
  other: "case-forum-other",
};
const STATUS_KEY: Record<(typeof STATUSES)[number], string> = {
  planned: "case-proceeding-planned",
  filed: "case-proceeding-filed",
  closed: "case-proceeding-closed",
};
const STATUS_TONE: Record<(typeof STATUSES)[number], StatusTone> = {
  planned: "attention",
  filed: "info",
  closed: "neutral",
};

const systemLabel = (t: (key: string) => string, system: string | null) =>
  system && system in SYSTEM_KEY ? t(SYSTEM_KEY[system as System]) : null;

/**
 * The lawsuits of the case: one in the small-claims court for the adults,
 * one in the civil court for a minor, each with its court, its forum and why
 * (the client's domicile, or another with a reason), its claimants and the
 * lawyers who sign, and the number once filed. The rules that decide the
 * forum and the kind arrive as code (`packages/rules`); here the lawyer
 * records what was decided. Under each lawsuit filed, its course as the court
 * shows it (`CourtCourse`).
 */
/** A city or a comarca as one name, whatever its accents and capitals. */
const plainName = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export default function ProceedingsCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [editing, setEditing] = useState<CaseProceeding | "new" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // One action at a time on the case: while one runs, every control waits, and the result shows before they come back.
  const action = useCaseAction("proceedings");

  const nameOfParty = (partyId: string) =>
    state.parties.find((party) => party.partyId === partyId)?.person.full_name ?? "";
  const nameOfLawyer = (userId: string) => state.team.find((member) => member.userId === userId)?.name ?? "";
  const unnamedOf = (proceeding: CaseProceeding) =>
    state.unnamedSigners
      .filter((item) => item.proceedingId === proceeding.id)
      .map((item) => item.lawyer ?? nameOfLawyer(item.userId))
      .filter(Boolean);
  const courtName = (acronym: string | null) =>
    state.courts.find((court) => court.acronym === acronym)?.acronym ?? acronym;

  // Removing a planned lawsuit is said before it is done: its piece and package go, and ONE never makes it again.
  const [removing, setRemoving] = useState<CaseProceeding | null>(null);

  const remove = (proceeding: CaseProceeding) =>
    action.run(
      `remove-${proceeding.id}`,
      {
        doing: t("case-action-proceeding-remove-doing"),
        done: t("case-action-proceeding-remove-done"),
        failed: t("case-action-proceeding-remove-failed"),
      },
      async () => {
        setProblem(null);
        const result = await removeProceeding(state.case.id, proceeding.id);
        if (!result.ok) setProblem(result.code);
        return result.ok;
      },
    );

  // What the courts did that nobody of the firm saw yet, over every lawsuit of the case.
  const unseen = state.proceedings.reduce(
    (sum, proceeding) => sum + (state.course.byProceeding[proceeding.id]?.unseen ?? 0),
    0,
  );
  const lineOf = (proceeding: CaseProceeding) =>
    `${[t(KIND_KEY[proceeding.kind]), courtName(proceeding.court)].filter(Boolean).join(", ")}: ${t(STATUS_KEY[proceeding.status])}`;

  return (
    <CollapsibleCard
      id="case-proceedings"
      title={t("case-proceedings-title")}
      summary={
        state.proceedings.length === 0 ? t("case-proceedings-empty-title") : state.proceedings.map(lineOf).join(" · ")
      }
      chip={
        unseen > 0 ? (
          <StatusChip tone="attention" label={t("case-proceedings-summary-moved", { count: unseen })} />
        ) : null
      }
      description={t("case-proceedings-body")}
      action={
        writable && state.proceedings.length > 0 ? (
          <Button variant="outlined" color="grey" size="small" onClick={() => setEditing("new")}>
            {t("case-proceedings-add")}
          </Button>
        ) : null
      }
      defaultOpen={opensOnArrival(state.case.status, "proceedings", unseen > 0, state.proceedings.length === 0)}
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}

      {state.proceedings.length === 0 && (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationLaunch />}
          title={t("case-proceedings-empty-title")}
          description={t("case-proceedings-empty-body")}
          action={writable ? { label: t("case-proceedings-add"), onClick: () => setEditing("new") } : undefined}
        />
      )}

      {state.proceedings.map((proceeding) => {
        const where = [
          courtName(proceeding.court),
          proceeding.comarca,
          proceeding.unit,
          // A planned lawsuit's system is said with the firm's word on it, below (`CourtSystem`).
          proceeding.status === "planned" ? null : systemLabel(t, proceeding.system),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Box key={proceeding.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
            <Box className="flex flex-wrap items-start justify-between gap-2">
              <Box className="flex min-w-0 flex-col">
                <Typography variant="body1" className="font-semibold">
                  {t(KIND_KEY[proceeding.kind])}
                </Typography>
                {where && (
                  <Typography variant="body2" className="text-text-secondary">
                    {where}
                  </Typography>
                )}
              </Box>
              <StatusChip tone={STATUS_TONE[proceeding.status]} label={t(STATUS_KEY[proceeding.status])} />
            </Box>
            {proceeding.status === "planned" && proceeding.comarca ? (
              proceeding.comarcaChecked ? (
                proceeding.forumCity && plainName(proceeding.forumCity) !== plainName(proceeding.comarca) ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("case-proceeding-comarca-of", { city: proceeding.forumCity, comarca: proceeding.comarca })}
                  </Typography>
                ) : null
              ) : (
                // The platform's table does not know this city in this court (0145): a person checks it before filing.
                <StateLine tone="attention">
                  {t("case-proceeding-comarca-unchecked", { comarca: proceeding.comarca })}
                </StateLine>
              )
            ) : null}
            {proceeding.cnj && (
              <Typography variant="body2" className="font-mono">
                {[
                  formatCnj(proceeding.cnj) ?? proceeding.cnj,
                  proceeding.filedAt
                    ? t("case-proceeding-filed-on", { date: formatDayBr(proceeding.filedAt) ?? "" })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Typography>
            )}
            {proceeding.forumBasis && (
              <Typography variant="body2">
                {t("case-proceeding-forum", {
                  basis:
                    proceeding.forumBasis in BASIS_KEY
                      ? t(BASIS_KEY[proceeding.forumBasis as (typeof BASES)[number]])
                      : proceeding.forumBasis,
                })}
                {proceeding.forumReason ? `: ${proceeding.forumReason}` : ""}
              </Typography>
            )}
            {proceeding.parties.length > 0 && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-proceeding-claimants", {
                  names: proceeding.parties.map(nameOfParty).filter(Boolean).join(", "),
                })}
              </Typography>
            )}
            {proceeding.lawyers.length > 0 && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-proceeding-lawyers", {
                  names: proceeding.lawyers.map(nameOfLawyer).filter(Boolean).join(", "),
                })}
              </Typography>
            )}
            {proceeding.status === "planned" && unnamedOf(proceeding).length > 0 && (
              // The firm's own power of attorney names its lawyers as the firm wrote them (0093): one who signs this
              // lawsuit and is not among them holds no power of the client's.
              <StateLine tone="attention">
                {t("case-proceeding-power-unnamed", {
                  names: unnamedOf(proceeding).join(", "),
                  count: unnamedOf(proceeding).length,
                })}
              </StateLine>
            )}
            {proceeding.createdByOne && proceeding.status === "planned" && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-proceeding-created-by-one")}
              </Typography>
            )}
            <CourtSystem state={state} proceeding={proceeding} writable={writable} onChanged={onChanged} />
            <CourtCourse
              caseId={state.case.id}
              proceedingId={proceeding.id}
              view={state.course.byProceeding[proceeding.id]}
              facts={state.course}
              writable={writable}
              onChanged={onChanged}
            />
            {writable && (
              <Box className="flex flex-wrap gap-2 pt-1">
                <Button variant="outlined" color="grey" size="small" onClick={() => setEditing(proceeding)}>
                  {t("client-edit")}
                </Button>
                {proceeding.status === "planned" && (
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    disabled={action.busy}
                    onClick={() => setRemoving(proceeding)}
                  >
                    {t("client-trip-remove")}
                  </Button>
                )}
              </Box>
            )}
          </Box>
        );
      })}

      {editing && (
        <ProceedingDialog
          state={state}
          proceeding={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {removing ? (
        <ConfirmActionDialog
          title={t("case-proceeding-remove-title")}
          consequences={[t("case-proceeding-remove-consequence"), t("case-proceeding-remove-consequence-one")]}
          requireReason={false}
          confirmLabel={t("client-trip-remove")}
          cancelLabel={t("cases-cancel")}
          busyLabel={t("cases-working")}
          tone="danger"
          onConfirm={async () => {
            await remove(removing);
            return null;
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </CollapsibleCard>
  );
}

type Values = {
  kind: (typeof KINDS)[number];
  court: string;
  comarca: string;
  unit: string;
  system: string;
  cnj: string;
  forum_basis: string;
  forum_reason: string;
  forum_city: string;
  status: (typeof STATUSES)[number];
  filed_at: string;
};

function ProceedingDialog({
  state,
  proceeding,
  onClose,
  onSaved,
}: {
  state: Ready;
  proceeding: CaseProceeding | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const claimants = state.parties.filter((party) => party.role === "claimant");
  const lawyers = state.team.filter((member) => member.firmFunction === "socio" || member.firmFunction === "advogado");
  const [values, setValues] = useState<Values>({
    kind: proceeding?.kind ?? "juizado",
    court: proceeding?.court ?? "",
    comarca: proceeding?.comarca ?? "",
    unit: proceeding?.unit ?? "",
    system: proceeding?.system ?? "",
    cnj: proceeding?.cnj ? (formatCnj(proceeding.cnj) ?? proceeding.cnj) : "",
    forum_basis: proceeding?.forumBasis ?? "domicile",
    forum_reason: proceeding?.forumReason ?? "",
    forum_city: proceeding?.forumCity ?? "",
    status: proceeding?.status ?? "planned",
    filed_at: proceeding?.filedAt ?? "",
  });
  const [parties, setParties] = useState<string[]>(proceeding?.parties ?? []);
  const [signers, setSigners] = useState<string[]>(proceeding?.lawyers ?? []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);

  const set = <K extends keyof Values>(field: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [field]: value }));
  const known = state.courtSystems.find((row) => row.court === values.court && row.kind === values.kind) ?? null;
  // A lawyer newly put on a lawsuit in a state where one more cause makes their practice habitual
  // without a registration at that state's bar (`@flyee/rules/state-count`).
  const courtUf = state.courts.find((court) => court.acronym === values.court)?.uf ?? null;
  const barWarnings = courtUf
    ? lawyers.flatMap((member) => {
        if (!signers.includes(member.userId) || (proceeding?.lawyers ?? []).includes(member.userId)) return [];
        const counted = lawyerNeedsSupplementary(
          member.userId,
          courtUf,
          state.rules.causes,
          state.rules.registrations,
          state.rules.year,
        );
        return counted.needs ? [{ userId: member.userId, name: member.name, count: counted.count, uf: courtUf }] : [];
      })
    : [];
  const errorOf = (field: string) => (problem?.field === field ? t(caseErrorKey(problem.code)) : undefined);
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await saveProceeding({
      caseId: state.case.id,
      proceedingId: proceeding?.id ?? null,
      fields: {
        ...values,
        forum_reason: values.forum_basis === "domicile" ? "" : values.forum_reason,
        // At the domicile the forum is where the claimants of THIS lawsuit live (for minors, who answers for
        // them); elsewhere, the city chosen among the trip's.
        forum_city:
          values.forum_basis === "domicile"
            ? (caseDomicile(ruleParties(state.parties, state.rules.claims), state.today, parties)?.city ??
              proceeding?.forumCity ??
              "")
            : values.forum_city,
      },
      parties,
      lawyers: signers,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    onSaved();
  };

  const select = (field: keyof Values, label: string, options: { value: string; label: string }[], empty = false) => (
    <TextField
      select
      fullWidth
      size="small"
      id={`case-proceeding-${field}`}
      label={label}
      value={values[field]}
      disabled={busy}
      error={Boolean(errorOf(field))}
      helperText={errorOf(field)}
      onChange={(event) => set(field, event.target.value as never)}
    >
      {empty && <MenuItem value="">{t("case-field-choose")}</MenuItem>}
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="case-proceeding-dialog">
      <DialogHeader
        id="case-proceeding-dialog"
        title={proceeding ? t("case-proceeding-edit-title") : t("case-proceedings-add")}
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
          <Grid container spacing={2} className="pt-1">
            <Grid size={{ xs: 12, sm: 6 }}>
              {select(
                "kind",
                t("case-proceeding-kind"),
                KINDS.map((value) => ({ value, label: t(KIND_KEY[value]) })),
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {select(
                "court",
                t("case-proceeding-court"),
                state.courts.map((court) => ({ value: court.acronym, label: `${court.acronym} · ${court.uf}` })),
                true,
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                size="small"
                id="case-proceeding-comarca"
                label={t("case-proceeding-comarca")}
                value={values.comarca}
                disabled={busy}
                onChange={(event) => set("comarca", event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                size="small"
                id="case-proceeding-unit"
                label={t("case-proceeding-unit")}
                value={values.unit}
                disabled={busy}
                onChange={(event) => set("unit", event.target.value)}
              />
            </Grid>
            {/* The system is ONE's, from the court and the kind (0066): the firm approves it under the lawsuit,
                never picks it here. What the lawsuit has is sent back as it is. */}
            <Grid size={12}>
              <Typography variant="body2" className="text-text-secondary">
                {values.status === "planned"
                  ? known
                    ? t("case-proceeding-system-by-one", { system: systemLabel(t, known.system) ?? known.system })
                    : t("case-proceeding-system-by-one-none")
                  : t("case-proceeding-system-filed")}
              </Typography>
            </Grid>
            {known?.notes && (
              <Grid size={12}>
                <Alert severity="info" className="neutral bg-background-paper/60!">
                  {known.notes}
                </Alert>
              </Grid>
            )}
            <Grid size={{ xs: 12, sm: 6 }}>
              {select(
                "forum_basis",
                t("case-proceeding-forum-basis"),
                BASES.map((value) => ({ value, label: t(BASIS_KEY[value]) })),
              )}
            </Grid>
            {values.forum_basis !== "domicile" && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  id="case-proceeding-forum-city"
                  label={t("case-proceeding-forum-city")}
                  value={
                    state.rules.tripPlaces.some((place) => place.city === values.forum_city) ? values.forum_city : ""
                  }
                  disabled={busy || state.rules.tripPlaces.length === 0}
                  error={Boolean(errorOf("forum_city"))}
                  helperText={
                    errorOf("forum_city") ??
                    (state.rules.tripPlaces.length === 0
                      ? t("case-proceeding-forum-city-none")
                      : t("case-proceeding-forum-city-help"))
                  }
                  onChange={(event) => set("forum_city", event.target.value)}
                >
                  <MenuItem value="">{t("case-field-choose")}</MenuItem>
                  {state.rules.tripPlaces.map((place) => (
                    <MenuItem key={`${place.city}-${place.uf}`} value={place.city}>
                      {place.city} · {place.uf}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            )}
            {values.forum_basis !== "domicile" && (
              <Grid size={12}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  size="small"
                  id="case-proceeding-forum-reason"
                  label={t("case-proceeding-forum-reason")}
                  value={values.forum_reason}
                  disabled={busy}
                  error={Boolean(errorOf("forum_reason"))}
                  helperText={errorOf("forum_reason") ?? t("case-proceeding-forum-reason-help")}
                  onChange={(event) => set("forum_reason", event.target.value)}
                />
              </Grid>
            )}
            <Grid size={{ xs: 12, sm: 6 }}>
              {select(
                "status",
                t("case-proceeding-status"),
                STATUSES.map((value) => ({ value, label: t(STATUS_KEY[value]) })),
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                fullWidth
                size="small"
                id="case-proceeding-cnj"
                label={t("case-proceeding-cnj")}
                value={values.cnj}
                disabled={busy}
                error={Boolean(errorOf("cnj"))}
                helperText={errorOf("cnj") ?? t("case-proceeding-cnj-help")}
                slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 25 } }}
                onChange={(event) => set("cnj", event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                id="case-proceeding-filed-at"
                label={t("case-proceeding-filed-at")}
                value={values.filed_at}
                disabled={busy}
                error={Boolean(errorOf("filed_at"))}
                helperText={errorOf("filed_at")}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(event) => set("filed_at", event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormLabel component="legend" className="mb-1">
                {t("case-proceeding-parties")}
              </FormLabel>
              <FormGroup>
                {claimants.map((party) => (
                  <FormControlLabel
                    key={party.partyId}
                    control={
                      <Checkbox
                        size="small"
                        checked={parties.includes(party.partyId)}
                        disabled={busy}
                        onChange={() => setParties((current) => toggle(current, party.partyId))}
                      />
                    }
                    label={party.person.full_name}
                  />
                ))}
              </FormGroup>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormLabel component="legend" className="mb-1">
                {t("case-proceeding-lawyers-label")}
              </FormLabel>
              {lawyers.length === 0 ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("case-proceeding-no-lawyers")}
                </Typography>
              ) : (
                <FormGroup>
                  {lawyers.map((member) => (
                    <FormControlLabel
                      key={member.userId}
                      control={
                        <Checkbox
                          size="small"
                          checked={signers.includes(member.userId)}
                          disabled={busy}
                          onChange={() => setSigners((current) => toggle(current, member.userId))}
                        />
                      }
                      label={member.name}
                    />
                  ))}
                </FormGroup>
              )}
            </Grid>
            {barWarnings.map((warning) => (
              <Grid size={12} key={warning.userId}>
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {t("case-proceeding-oab-warning", { name: warning.name, count: warning.count, uf: warning.uf })}
                </Alert>
              </Grid>
            ))}
            {problem && (!problem.field || problem.field === "parties" || problem.field === "lawyers") && (
              <Grid size={12}>
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {t(caseErrorKey(problem.code))}
                </Alert>
              </Grid>
            )}
          </Grid>
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
