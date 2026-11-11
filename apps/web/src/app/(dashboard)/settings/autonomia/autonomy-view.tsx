"use client";

import SettingsMenu from "../components/settings-menu";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Drawer,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import AiTriageSection from "@/components/firm/ai-triage-section";
import DecidesNotice from "@/components/firm/decides-notice";
import CollapsibleCard, { CollapsibleGroup, CollapsibleGroupToggle } from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import SectionTitle from "@/components/product/section-title";
import StatusChip from "@/components/product/status-chip";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiRobot from "@/icons/nexture/ni-robot";
import NiUsers from "@/icons/nexture/ni-users";
import type { SecondFactorState } from "@/lib/ai/approvals";
import {
  type AutonomyDecision,
  autonomyErrorKey,
  type AutonomyMode,
  DECISION_KEY,
  decisionsByStage,
  type FirmAutonomy,
  LAWYER_ACTS,
  MODE_KEY,
} from "@/lib/firm/autonomy";
import { setFirmAutonomy } from "@/lib/firm/autonomy-actions";
import type { AiTriage } from "@/lib/publications/facts";

export type AutonomyDecisionView = FirmAutonomy & { changedByName: string | null; changedLabel: string | null };

export type AutonomyState =
  | {
      kind: "ready";
      /** Decides for the firm what a partner decides: a partner, or, in a firm with no partner, who manages it (0078). */
      partner: boolean;
      /** Whether this session may change a choice now: the database asks the second factor. */
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      decisions: AutonomyDecisionView[];
      /**
       * Whether the firm lets ONE's reading be the triage of the publications (0035), said inside the decision of
       * the triage; null when it could not be read.
       */
      aiTriage: AiTriage | null;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/** A link to a decision opens its card: the triage of the publications is reached from `/publicacoes`. */
const DECISION_ANCHOR: Partial<Record<AutonomyDecision, string>> = { publication_triage: "triagem-das-publicacoes" };

/**
 * What the firm lets ONE decide alone, and only that: who signs, the internal deadline and the bill in somebody
 * else's name are the firm's rules of the cases (`/settings/regras`), and the values by kind of problem are each
 * module's (its settings). A partner comes here to choose, for each decision ONE can take, whether ONE decides, ONE
 * decides with a share checked by a person, or a person decides; everybody else comes to know how the firm works.
 * By default ONE decides and records each decision: success is the firm automating what it trusts and keeping a
 * person where it wants. So the screen opens as the decisions grouped by the stage of the case each one acts in,
 * each with how it is now, and a person opens the one to read or change.
 */
export default function AutonomyView({ state }: { state: AutonomyState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const ready = state.kind === "ready" ? state : null;
  const editable = ready !== null && ready.partner && !ready.supportVisit && ready.secondFactor === "ok";

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
            <DecidesNotice
              decides={ready.partner}
              supportVisit={ready.supportVisit}
              secondFactor={ready.secondFactor}
              next="/settings/autonomia"
            />
            {ready.decisions.length === 0 ? (
              <EmptyState
                icon={<NiRobot size="large" />}
                title={t("autonomy-empty-title")}
                description={t("autonomy-empty-body")}
              />
            ) : (
              <CollapsibleGroup>
                <CollapsibleGroupToggle className="-my-1" />
                {decisionsByStage(ready.decisions).map((stage) => (
                  <Box
                    key={stage.key}
                    component="section"
                    aria-labelledby={`autonomy-stage-${stage.key}`}
                    className="flex flex-col gap-3 pt-2"
                  >
                    <SectionTitle
                      id={`autonomy-stage-${stage.key}`}
                      title={t(stage.title)}
                      variant="subtitle1"
                      chip={<StatusChip tone="neutral" label={String(stage.decisions.length)} />}
                    />
                    {stage.decisions.map((decision) => (
                      <DecisionCard
                        key={decision.key}
                        decision={decision}
                        editable={editable}
                        onSaved={() => router.refresh()}
                      >
                        {decision.key === "publication_triage" && ready.aiTriage ? (
                          <AiTriageSection
                            aiTriage={ready.aiTriage}
                            mayDecide={ready.partner && !ready.supportVisit}
                            onChanged={() => router.refresh()}
                          />
                        ) : null}
                      </DecisionCard>
                    ))}
                  </Box>
                ))}
              </CollapsibleGroup>
            )}
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
  children,
}: {
  decision: AutonomyDecisionView;
  /** A partner, outside a support visit, with the second factor confirmed in this session. */
  editable: boolean;
  onSaved: () => void;
  /** What else the firm says of this decision, in its card (the triage of the publications: the firm's switch). */
  children?: ReactNode;
}) {
  const t = useTranslations("product");
  const [saved, setSaved] = useState(false);
  const words = DECISION_KEY[decision.key];
  const titleId = `autonomy-${decision.key}`;

  return (
    <CollapsibleCard
      id={titleId}
      anchor={DECISION_ANCHOR[decision.key]}
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
      detail={t(words.body)}
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
      {children}
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
