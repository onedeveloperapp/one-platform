"use client";

import SettingsMenu from "../components/settings-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Drawer,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import CollapsibleCard, { CollapsibleGroup, CollapsibleGroupToggle } from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import { CurrencyField } from "@/components/product/fields";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiRobot from "@/icons/nexture/ni-robot";
import NiUsers from "@/icons/nexture/ni-users";
import type { SecondFactorState } from "@/lib/ai/approvals";
import { type Incident, INCIDENT_KEY, INCIDENTS } from "@/lib/cases/cases";
import {
  autonomyErrorKey,
  type AutonomyMode,
  type ClaimDefault,
  DECISION_KEY,
  type FirmAutonomy,
  LAWYER_ACTS,
  MODE_KEY,
} from "@/lib/firm/autonomy";
import { setFirmAutonomy, setFirmClaimDefault, setFirmSigner } from "@/lib/firm/autonomy-actions";

export type AutonomyDecisionView = FirmAutonomy & { changedByName: string | null; changedLabel: string | null };

/** A partner or a lawyer of the firm, the states they are at the bar in, and whether they sign what ONE prepares. */
export type AutonomySigner = { userId: string; name: string; states: string[]; signs: boolean };

export type AutonomyState =
  | {
      kind: "ready";
      partner: boolean;
      /** Whether this session may change a choice now: the database asks the second factor. */
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      decisions: AutonomyDecisionView[];
      /** Null when who signs could not be read: its card says so, and the decisions stay. */
      signers: AutonomySigner[] | null;
      /** The claim the firm asks by default for each kind of problem; null when it could not be read. */
      claimDefaults: ClaimDefault[] | null;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/**
 * What the firm lets ONE decide alone. A partner comes here to choose, for
 * each decision ONE can take, whether ONE decides, ONE decides with a share
 * checked by a person, or a person decides; everybody else comes to know how
 * the firm works. By default ONE decides and records each decision: success
 * is the firm automating what it trusts and keeping a person where it wants.
 * So the screen opens as the list of decisions with how each one is now, and
 * a person opens the one to read or change.
 */
export default function AutonomyView({ state }: { state: AutonomyState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const ready = state.kind === "ready" ? state : null;

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="autonomy" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={t("autonomy-title")}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: t("settings-autonomy") },
              ]}
              description={t("autonomy-description")}
            />
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={() => setOpenDrawer(true)}
                aria-label={t("settings-open-menu")}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {state.kind === "unavailable" && (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("settings-unavailable")}
            </Alert>
          </Grid>
        )}
        {state.kind === "error" && (
          <Grid size={12}>
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={() => router.refresh()}>
                  {t("autonomy-retry")}
                </Button>
              }
            >
              {t("autonomy-load-error")}
            </Alert>
          </Grid>
        )}
        {state.kind === "no-firm" && (
          <Grid size={12}>
            <EmptyState
              icon={<NiUsers size="large" />}
              title={t("team-no-firm-title")}
              description={t("team-no-firm-body")}
              action={{ label: t("team-no-firm-action"), href: "/admin" }}
            />
          </Grid>
        )}

        {ready && (
          <Grid size={12} className="flex flex-col gap-3">
            {ready.supportVisit ? (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("autonomy-support-visit")}
              </Alert>
            ) : !ready.partner ? (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("autonomy-partner-only")}
              </Alert>
            ) : ready.secondFactor === "missing" ? (
              <Alert
                severity="warning"
                className="neutral bg-background-paper/60!"
                action={
                  <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
                    {t("autonomy-second-factor-missing-action")}
                  </Button>
                }
              >
                {t("autonomy-second-factor-missing")}
              </Alert>
            ) : ready.secondFactor === "challenge" ? (
              <Alert
                severity="warning"
                className="neutral bg-background-paper/60!"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    href="/auth/two-factor?next=/settings/autonomia"
                    LinkComponent={Link}
                  >
                    {t("autonomy-second-factor-challenge-action")}
                  </Button>
                }
              >
                {t("autonomy-second-factor-challenge")}
              </Alert>
            ) : null}
            <CollapsibleGroup>
              {ready.decisions.length === 0 ? (
                <EmptyState
                  icon={<NiRobot size="large" />}
                  title={t("autonomy-empty-title")}
                  description={t("autonomy-empty-body")}
                />
              ) : (
                <>
                  <CollapsibleGroupToggle className="-my-1" />
                  {ready.decisions.map((decision) => (
                    <DecisionCard
                      key={decision.key}
                      decision={decision}
                      editable={ready.partner && !ready.supportVisit && ready.secondFactor === "ok"}
                      onSaved={() => router.refresh()}
                    />
                  ))}
                </>
              )}
              <SignersCard
                signers={ready.signers}
                editable={ready.partner && !ready.supportVisit && ready.secondFactor === "ok"}
                onSaved={() => router.refresh()}
              />
              <ClaimDefaultsCard
                defaults={ready.claimDefaults}
                editable={ready.partner && !ready.supportVisit && ready.secondFactor === "ok"}
                onSaved={() => router.refresh()}
              />
            </CollapsibleGroup>
          </Grid>
        )}
      </Grid>

      <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
        <Box className="min-w-80 p-7">
          <SettingsMenu active="autonomy" />
        </Box>
      </Drawer>
    </Grid>
  );
}

/**
 * One decision: what ONE does alone in it, how the firm has it now, and, for a partner, the way to change it.
 * Closed, it says how the firm has it and who chose it; the card stays open while the choice is saved and the
 * screen reads it again, and says it was saved.
 */
function DecisionCard({
  decision,
  editable,
  onSaved,
}: {
  decision: AutonomyDecisionView;
  /** A partner, outside a support visit, with the second factor confirmed in this session. */
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [saved, setSaved] = useState(false);
  const words = DECISION_KEY[decision.key];
  const titleId = `autonomy-${decision.key}`;

  return (
    <CollapsibleCard
      id={titleId}
      title={t(words.title)}
      chip={
        <StatusChip
          tone={decision.mode === "approval" ? "neutral" : "positive"}
          label={
            decision.mode === "sampled"
              ? t("autonomy-now-sampled", { percent: decision.samplePercent })
              : t(MODE_KEY[decision.mode])
          }
        />
      }
      summary={
        decision.held
          ? t("autonomy-summary-held")
          : decision.chosen && decision.changedLabel
            ? decision.changedByName
              ? t("autonomy-changed", { name: decision.changedByName, when: decision.changedLabel })
              : t("autonomy-changed-unnamed", { when: decision.changedLabel })
            : t("autonomy-default")
      }
      description={t(words.body)}
      bodyClassName="gap-3"
    >
      {LAWYER_ACTS.includes(decision.key) && (
        <Typography variant="body2" className="text-text-secondary">
          {t("autonomy-privative")}
        </Typography>
      )}
      {decision.held && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("autonomy-held")}
        </Alert>
      )}
      {editable && (
        <DecisionChoice
          // A choice changed elsewhere (another partner, the operator) starts the form again from it.
          key={`${decision.chosen ?? "-"}:${decision.samplePercent}:${decision.held}`}
          decision={decision}
          titleId={titleId}
          onSaved={() => {
            setSaved(true);
            onSaved();
          }}
          onReread={onSaved}
          onTouched={() => setSaved(false)}
        />
      )}
      {saved && (
        <Alert severity="success" role="status" className="neutral bg-background-paper/60!">
          {t("autonomy-saved")}
        </Alert>
      )}
    </CollapsibleCard>
  );
}

/** The ways a partner may have a decision, as the screen read it last, and the one to save. */
function DecisionChoice({
  decision,
  titleId,
  onSaved,
  onReread,
  onTouched,
}: {
  decision: AutonomyDecisionView;
  titleId: string;
  onSaved: () => void;
  /** The decision or its ways changed since the screen was read: it reads them again. */
  onReread: () => void;
  onTouched: () => void;
}) {
  const t = useTranslations("product");
  const [mode, setMode] = useState<AutonomyMode>(decision.chosen ?? decision.defaultMode);
  const [sample, setSample] = useState(String(decision.samplePercent));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = decision.chosen ?? decision.defaultMode;
  const samplePercent = Number(sample);
  const sampleOk = Number.isInteger(samplePercent) && samplePercent >= 1 && samplePercent <= 100;
  const changed = mode !== current || (mode === "sampled" && samplePercent !== decision.samplePercent);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setFirmAutonomy(decision.key, mode, mode === "sampled" ? samplePercent : null);
      if (!result.ok) {
        setProblem(result.code);
        if (result.code === "invalid_mode" || result.code === "decision_not_found") onReread();
      } else {
        onSaved();
      }
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box className="flex flex-col gap-2">
      <RadioGroup
        aria-labelledby={titleId}
        value={mode}
        onChange={(event) => {
          setMode(event.target.value as AutonomyMode);
          onTouched();
        }}
      >
        {decision.modes.map((option) => (
          <FormControlLabel
            key={option}
            value={option}
            control={<Radio />}
            label={t(MODE_KEY[option])}
            disabled={busy}
          />
        ))}
      </RadioGroup>
      {mode === "sampled" && (
        <TextField
          size="small"
          className="max-w-56"
          id={`${titleId}-sample`}
          label={t("autonomy-sample-label")}
          value={sample}
          disabled={busy}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          error={!sampleOk}
          helperText={sampleOk ? t("autonomy-sample-help") : t("autonomy-sample-invalid")}
          onChange={(event) => {
            setSample(event.target.value.replace(/\D/g, "").slice(0, 3));
            onTouched();
          }}
        />
      )}
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(autonomyErrorKey(problem))}
        </Alert>
      )}
      <Box>
        <Button
          variant="contained"
          size="small"
          disabled={busy || !changed || (mode === "sampled" && !sampleOk)}
          onClick={() => void save()}
        >
          {busy ? t("cases-working") : t("autonomy-save")}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * Who signs what ONE prepares: the partners and lawyers a partner named. ONE
 * names, for a lawsuit, those of them at the bar in its court's state, and a
 * lawsuit nobody of them can sign waits for one. Closed, it says who signs;
 * it opens by itself while nobody does, since ONE's lawsuits wait for one.
 */
function SignersCard({
  signers,
  editable,
  onSaved,
}: {
  signers: AutonomySigner[] | null;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const signing = (signers ?? []).filter((signer) => signer.signs);

  return (
    <CollapsibleCard
      id="quem-assina-title"
      anchor="quem-assina"
      title={t("autonomy-signers-title")}
      summary={
        signers === null
          ? t("autonomy-signers-load-error")
          : signers.length === 0
            ? t("autonomy-signers-empty-title")
            : signing.length > 0
              ? signing.map((signer) => signer.name).join(", ")
              : t("autonomy-signers-summary-nobody")
      }
      description={t("autonomy-signers-body")}
      defaultOpen={signers === null || signing.length === 0}
      bodyClassName="gap-3"
    >
      {signers === null ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={onSaved}>
              {t("autonomy-retry")}
            </Button>
          }
        >
          {t("autonomy-signers-load-error")}
        </Alert>
      ) : signers.length === 0 ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          titleAs="h3"
          title={t("autonomy-signers-empty-title")}
          description={t("autonomy-signers-empty-body")}
          action={{ label: t("autonomy-signers-empty-action"), href: "/settings/team" }}
        />
      ) : (
        <SignersList
          // Who signs as the page read it last: what a partner switched starts again from it.
          key={signers.map((signer) => `${signer.userId}:${signer.signs}`).join(",")}
          signers={signers}
          editable={editable}
          onSaved={onSaved}
        />
      )}
    </CollapsibleCard>
  );
}

/** The signers, each with its switch for a partner. A switch says its new state at once, and is said back as it is once the page is read again. */
function SignersList({
  signers,
  editable,
  onSaved,
}: {
  signers: AutonomySigner[];
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // What a partner just switched, until the page read again says the same.
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  const signs = (signer: AutonomySigner) => switched[signer.userId] ?? signer.signs;

  const change = async (signer: AutonomySigner, value: boolean) => {
    setBusy(signer.userId);
    setProblem(null);
    try {
      const result = await setFirmSigner(signer.userId, value);
      if (result.ok) setSwitched((before) => ({ ...before, [signer.userId]: value }));
      else setProblem(result.code);
      onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
        {signers.map((signer) => {
          const states =
            signer.states.length > 0
              ? t("autonomy-signers-states", { states: signer.states.join(", ") })
              : t("autonomy-signers-no-state");
          return (
            <Box component="li" key={signer.userId} className="flex flex-wrap items-center justify-between gap-2">
              {editable ? (
                <FormControlLabel
                  className="m-0"
                  control={
                    <Switch
                      checked={signs(signer)}
                      disabled={busy !== null}
                      onChange={(event) => void change(signer, event.target.checked)}
                    />
                  }
                  label={
                    <Box className="flex flex-col">
                      <Typography variant="body1">{signer.name}</Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {states}
                      </Typography>
                    </Box>
                  }
                />
              ) : (
                <>
                  <Box className="min-w-0">
                    <Typography variant="body1">{signer.name}</Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {states}
                    </Typography>
                  </Box>
                  <StatusChip
                    tone={signs(signer) ? "positive" : "neutral"}
                    label={t(signs(signer) ? "autonomy-signers-signs" : "autonomy-signers-does-not")}
                  />
                </>
              )}
            </Box>
          );
        })}
      </Box>
      {!signers.some((signer) => signs(signer)) && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("autonomy-signers-none")}
        </Alert>
      )}
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(autonomyErrorKey(problem))}
        </Alert>
      )}
    </>
  );
}

/** Reais as a person reads them: 10.000,00. */
const reais = (cents: number): string =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

/**
 * The claim the firm asks by default for each kind of problem (migration
 * 0052). Where a claimant of a case has no claim, ONE writes the default of
 * the case's kind of problem and goes on; a claim a person wrote is never
 * changed, and a kind with no default waits for the claim on the case. A
 * partner with the second factor says each one, or takes it off. Closed, it
 * says how many kinds have one; it opens by itself while none has.
 */
function ClaimDefaultsCard({
  defaults,
  editable,
  onSaved,
}: {
  defaults: ClaimDefault[] | null;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");

  return (
    <CollapsibleCard
      id="valor-do-pedido-title"
      anchor="valor-do-pedido"
      title={t("autonomy-claims-title")}
      summary={
        defaults === null
          ? t("autonomy-claims-load-error")
          : defaults.length > 0
            ? t("autonomy-claims-summary", { count: defaults.length, total: INCIDENTS.length })
            : t("autonomy-claims-summary-none")
      }
      description={t("autonomy-claims-body")}
      defaultOpen={defaults === null || defaults.length === 0}
      bodyClassName="gap-3"
    >
      {defaults === null ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={onSaved}>
              {t("autonomy-retry")}
            </Button>
          }
        >
          {t("autonomy-claims-load-error")}
        </Alert>
      ) : (
        <ClaimDefaultsForm
          // The defaults as the page read them last: what a partner saved starts again from it.
          key={defaults.map((row) => `${row.incident}:${row.cents}`).join(",")}
          defaults={defaults}
          editable={editable}
          onSaved={onSaved}
        />
      )}
    </CollapsibleCard>
  );
}

/** Each kind of problem with its default, typed and saved one at a time. */
function ClaimDefaultsForm({
  defaults,
  editable,
  onSaved,
}: {
  defaults: ClaimDefault[];
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const saved = new Map(defaults.map((row) => [row.incident, row.cents]));
  // What a partner typed, as the field holds it (reais with their decimals), until the page reads it back.
  const [typed, setTyped] = useState<Partial<Record<Incident, string>>>(() =>
    Object.fromEntries(defaults.map((row) => [row.incident, (row.cents / 100).toFixed(2)])),
  );
  const [busy, setBusy] = useState<Incident | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const centsOf = (incident: Incident): number | null => {
    const raw = typed[incident] ?? "";
    const value = Number(raw);
    return raw !== "" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  };

  const save = async (incident: Incident, cents: number | null) => {
    setBusy(incident);
    setProblem(null);
    try {
      const result = await setFirmClaimDefault(incident, cents);
      if (!result.ok) setProblem(result.code);
      else onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
        {INCIDENTS.map((incident) => {
          const current = saved.get(incident) ?? null;
          const label = t(INCIDENT_KEY[incident]);
          return (
            <Box component="li" key={incident} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {editable ? (
                <>
                  <CurrencyField
                    size="small"
                    className="sm:max-w-xs"
                    fullWidth
                    id={`claim-default-${incident}`}
                    name={`claim-default-${incident}`}
                    label={label}
                    currencySymbol="R$"
                    value={typed[incident] ?? ""}
                    disabled={busy !== null}
                    onChange={(event) => setTyped((before) => ({ ...before, [incident]: event.target.value }))}
                  />
                  <Box className="flex flex-row gap-1">
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      disabled={busy !== null || centsOf(incident) === null || centsOf(incident) === current}
                      onClick={() => void save(incident, centsOf(incident))}
                    >
                      {t("autonomy-claims-save")}
                    </Button>
                    {current !== null && (
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        disabled={busy !== null}
                        onClick={() => void save(incident, null)}
                        aria-label={t("autonomy-claims-remove-label", { kind: label })}
                      >
                        {t("autonomy-claims-remove")}
                      </Button>
                    )}
                  </Box>
                </>
              ) : (
                <Box className="flex w-full flex-wrap items-center justify-between gap-2">
                  <Typography variant="body1">{label}</Typography>
                  <Typography variant="body1" className={current === null ? "text-text-secondary" : undefined}>
                    {current === null
                      ? t("autonomy-claims-none")
                      : t("autonomy-claims-value", { value: reais(current) })}
                  </Typography>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(autonomyErrorKey(problem))}
        </Alert>
      )}
    </>
  );
}
