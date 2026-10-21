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
  Card,
  CardContent,
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

import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiRobot from "@/icons/nexture/ni-robot";
import NiUsers from "@/icons/nexture/ni-users";
import type { SecondFactorState } from "@/lib/ai/approvals";
import {
  autonomyErrorKey,
  type AutonomyMode,
  DECISION_KEY,
  type FirmAutonomy,
  LAWYER_ACTS,
  MODE_KEY,
} from "@/lib/firm/autonomy";
import { setFirmAutonomy, setFirmSigner } from "@/lib/firm/autonomy-actions";

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
          <Grid size={12} className="flex flex-col gap-5">
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
            {ready.decisions.length === 0 ? (
              <EmptyState
                icon={<NiRobot size="large" />}
                title={t("autonomy-empty-title")}
                description={t("autonomy-empty-body")}
              />
            ) : (
              ready.decisions.map((decision) => (
                <DecisionCard
                  // A choice changed elsewhere (another partner, the operator) starts the card again from it.
                  key={`${decision.key}:${decision.chosen ?? "-"}:${decision.samplePercent}:${decision.held}`}
                  decision={decision}
                  editable={ready.partner && !ready.supportVisit && ready.secondFactor === "ok"}
                  onSaved={() => router.refresh()}
                />
              ))
            )}
            <SignersCard
              // Who signs as the page read it last: what a partner switched starts again from it.
              key={ready.signers?.map((signer) => `${signer.userId}:${signer.signs}`).join(",") ?? "-"}
              signers={ready.signers}
              editable={ready.partner && !ready.supportVisit && ready.secondFactor === "ok"}
              onSaved={() => router.refresh()}
            />
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

/** One decision: what ONE does alone in it, how the firm has it now, and, for a partner, the way to change it. */
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
  const [mode, setMode] = useState<AutonomyMode>(decision.chosen ?? decision.defaultMode);
  const [sample, setSample] = useState(String(decision.samplePercent));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const words = DECISION_KEY[decision.key];
  const current = decision.chosen ?? decision.defaultMode;
  const samplePercent = Number(sample);
  const sampleOk = Number.isInteger(samplePercent) && samplePercent >= 1 && samplePercent <= 100;
  const changed = mode !== current || (mode === "sampled" && samplePercent !== decision.samplePercent);
  const titleId = `autonomy-${decision.key}`;

  const save = async () => {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      const result = await setFirmAutonomy(decision.key, mode, mode === "sampled" ? samplePercent : null);
      if (!result.ok) {
        setProblem(result.code);
        // The decision or its ways changed since the page was read: it reads them again.
        if (result.code === "invalid_mode" || result.code === "decision_not_found") onSaved();
      } else {
        setSaved(true);
        onSaved();
      }
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card component="section" aria-labelledby={titleId}>
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-wrap items-center justify-between gap-2">
          <Typography id={titleId} variant="h5" component="h2" className="mb-0">
            {t(words.title)}
          </Typography>
          <StatusChip
            tone={decision.mode === "approval" ? "neutral" : "positive"}
            label={
              decision.mode === "sampled"
                ? t("autonomy-now-sampled", { percent: decision.samplePercent })
                : t(MODE_KEY[decision.mode])
            }
          />
        </Box>
        <Typography variant="body2" className="text-text-secondary">
          {t(words.body)}
        </Typography>
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
        <Typography variant="caption" className="text-text-secondary">
          {decision.chosen && decision.changedLabel
            ? decision.changedByName
              ? t("autonomy-changed", { name: decision.changedByName, when: decision.changedLabel })
              : t("autonomy-changed-unnamed", { when: decision.changedLabel })
            : decision.held
              ? null
              : t("autonomy-default")}
        </Typography>

        {editable && (
          <Box className="flex flex-col gap-2">
            <RadioGroup
              aria-labelledby={titleId}
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as AutonomyMode);
                setSaved(false);
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
                  setSaved(false);
                }}
              />
            )}
            {problem && (
              <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
                {t(autonomyErrorKey(problem))}
              </Alert>
            )}
            {saved && !problem && (
              <Alert severity="success" role="status" className="neutral bg-background-paper/60!">
                {t("autonomy-saved")}
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
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Who signs what ONE prepares: the partners and lawyers a partner named. ONE
 * names, for a lawsuit, those of them at the bar in its court's state, and a
 * lawsuit nobody of them can sign waits for one. A switch says its new state
 * at once, and is said back as it is once the page is read again.
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
    <Card component="section" aria-labelledby="quem-assina-title" id="quem-assina">
      <CardContent className="flex flex-col gap-3">
        <Typography id="quem-assina-title" variant="h5" component="h2" className="mb-0">
          {t("autonomy-signers-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("autonomy-signers-body")}
        </Typography>
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
            title={t("autonomy-signers-empty-title")}
            description={t("autonomy-signers-empty-body")}
            action={{ label: t("autonomy-signers-empty-action"), href: "/settings/team" }}
          />
        ) : (
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
        )}
        {signers && signers.length > 0 && !signers.some((signer) => signs(signer)) && (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("autonomy-signers-none")}
          </Alert>
        )}
        {problem && (
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
            {t(autonomyErrorKey(problem))}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
