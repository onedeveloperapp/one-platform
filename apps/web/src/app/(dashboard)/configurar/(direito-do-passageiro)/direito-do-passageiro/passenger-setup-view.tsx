"use client";

import ConnectCard from "../../../settings/connections/components/connect-card";
import { PASSENGER_SETUP_STEPS, type PassengerSetupStep } from "./passenger-setup-steps";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Grid, Typography } from "@mui/material";

import ClaimValueChoice from "@/components/firm/claim-value-choice";
import PartnerInvitePanel from "@/components/partners/partner-invite-panel";
import { QuickActionTile } from "@/components/product/home-tiles";
import ModuleIcon from "@/components/product/module-icon";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import StatusChip from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiLock from "@/icons/nexture/ni-lock";
import type { SecondFactorState } from "@/lib/ai/approvals";
import {
  autonomyErrorKey,
  type ClaimChoice,
  claimChoiceOf,
  type ClaimDefault,
  claimDefaultChanges,
  typedClaims,
} from "@/lib/firm/autonomy";
import { setFirmClaimDefault } from "@/lib/firm/autonomy-actions";
import type { ModuleTone } from "@/lib/modules/offer";
import { caseKindLabelKey, caseKindsOf } from "@/lib/modules/registry";
import { answerModuleSetup } from "@/lib/modules/setup-actions";
import type { FirmPartnersState } from "@/lib/partners/facts";
import { cn } from "@/lib/utils";
import type { ConnectionsState } from "@/lib/whatsapp/connections";
import FirmClauseFields, { useFirmClause } from "@/modules/direito-do-passageiro/firm-clause";
import { PASSENGER_MODULE } from "@/modules/direito-do-passageiro/incidents";

/** What the passenger module's setup shows (migration 0081), read by `passenger-setup-state.ts`. */
export type PassengerSetupState =
  | { kind: "unavailable" }
  | { kind: "not-manager" }
  | { kind: "not-contracted" }
  | {
      kind: "ready";
      firmName: string;
      module: { key: string; name: string; icon: string | null; tone: ModuleTone };
      /** Where it stands among the setups of the modules the firm contracted. */
      position: { index: number; total: number };
      /** The next module setup never answered, which its finish opens; null for the home. */
      next: { href: string; name: string } | null;
      answered: boolean;
      /** Who answers decides for the firm (0078): the Valor da Causa Pedido and the clause's words are theirs. */
      decidesForFirm: boolean;
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      claimDefaults: ClaimDefault[] | null;
      /** The words the firm gave its agencies, in force; null with none. */
      clause: { version: number; body: string } | null;
      clauseRead: boolean;
      /** ONE's proposal written for the firm; null when there is none to read. */
      proposal: string | null;
      partners: Extract<FirmPartnersState, { kind: "ready" }> | null;
      connections: ConnectionsState;
      /** ONE's modules the firm did not contract: shown disabled, as what it could add one day. */
      others: { key: string; name: string; icon: string | null; tone: ModuleTone; soon: boolean }[];
      step: PassengerSetupStep | null;
    };

/**
 * The passenger module's own setup (the owner, 2026-11-03; migration 0081), in the module's colour, after the
 * firm's core setup and before the home: only what this module needs, which a firm that did not contract it never
 * sees. The Valor da Causa Pedido of the air-passenger problems; the words of the clause its partner agencies
 * register in their contracts (ONE proposes them written for the firm, the firm registers them, and each agency
 * receives them ready in its own setup); and the partner agency, with the channel the partnership needs turned on
 * in place. The second factor comes first only for a session that has none, since every step asks for it. Under
 * the steps, the modules the firm did not contract, disabled. Nothing leads away from it; "Fazer depois" sets it
 * aside, and the home's list leads back.
 */
export default function PassengerSetupView({ state }: { state: PassengerSetupState }) {
  const t = useTranslations("product");
  if (state.kind !== "ready") {
    return (
      <Box className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PageHeader title={t("module-setup-crumb")} crumbs={[{ label: t("module-setup-crumb") }]} />
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {state.kind === "not-manager"
            ? t("module-setup-not-manager")
            : state.kind === "not-contracted"
              ? t("module-setup-not-contracted")
              : t("module-setup-unavailable")}
        </Alert>
      </Box>
    );
  }
  return <PassengerSetupFlow state={state} />;
}

function PassengerSetupFlow({ state }: { state: Extract<PassengerSetupState, { kind: "ready" }> }) {
  const t = useTranslations("product");
  const router = useRouter();
  const refresh = () => router.refresh();
  const blocked = state.supportVisit;
  const decides = state.decidesForFirm;
  const tone = TILE_TONE[state.module.tone];

  // ---------- The second factor, first only for a session that has none ----------
  const [confirmedHere, setConfirmedHere] = useState(false);
  const factor: SecondFactorState = confirmedHere ? "ok" : state.secondFactor;
  const factorOk = factor === "ok";
  // The steps are decided when the page opens: confirming the factor reads the page again, and the steps stay.
  const [keys] = useState<PassengerSetupStep[]>(() =>
    state.secondFactor === "ok" ? ["valores", "clausula", "agencia"] : [...PASSENGER_SETUP_STEPS],
  );
  const asked = state.step && keys.includes(state.step) ? state.step : null;
  const [stepIndex, setStepIndex] = useState(() =>
    Math.max(0, keys.indexOf(state.secondFactor === "ok" ? (asked ?? keys[0]) : "seguranca")),
  );
  const goTo = (key: PassengerSetupStep) => setStepIndex(Math.max(0, keys.indexOf(key)));

  // ---------- The Valor da Causa Pedido ----------
  const kinds = caseKindsOf(PASSENGER_MODULE);
  const [claimChoice, setClaimChoice] = useState<ClaimChoice>(() => claimChoiceOf(state.claimDefaults ?? []));
  const [claims, setClaims] = useState<Partial<Record<string, string>>>(() => typedClaims(state.claimDefaults ?? []));
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const claimsEditable = decides && factorOk && !blocked && state.claimDefaults !== null;
  // Each kind whose value changed is said or taken back (all of them, for no value).
  const saveClaims = async (): Promise<boolean> => {
    setClaimsError(null);
    if (!claimsEditable) return true;
    const planned = claimDefaultChanges(
      claimChoice,
      claims,
      state.claimDefaults ?? [],
      kinds.map((kind) => kind.key),
    );
    if (!planned.ok) {
      setClaimsError(t("claims-invalid", { kind: t(caseKindLabelKey(planned.invalid) ?? "case-incident-other") }));
      return false;
    }
    for (const change of planned.changes) {
      const result = await setFirmClaimDefault(change.incident, change.cents);
      if (!result.ok) {
        setClaimsError(t(autonomyErrorKey(result.code)));
        refresh();
        return false;
      }
    }
    if (planned.changes.length > 0) refresh();
    return true;
  };

  // ---------- The words of the clause the agencies register ----------
  const clauseEditable = decides && factorOk && !blocked;
  const clause = useFirmClause({
    clause: state.clause,
    proposal: state.proposal,
    editable: clauseEditable,
    onSaved: refresh,
  });
  const inForce = clause.inForce;
  const change = clause.change;

  // ---------- The partner agency ----------
  const [invitingAgency, setInvitingAgency] = useState(false);
  const connections = state.connections.kind === "ready" ? state.connections : null;
  const realNumber = connections?.numbers.find((item) => item.status === "active" && item.provider !== "test") ?? null;
  // The partnership needs the firm's WhatsApp number before the agency's passenger agrees: with no number nobody is
  // told of a problem. Connected here, in place (the test chat is offered no longer, 2026-11-11).
  const noChannel = connections !== null && !realNumber;
  const partners = state.partners;
  const activePartners = partners?.partnerships.filter((partnership) => partnership.status === "active") ?? [];
  const day = (value: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));

  // ---------- The end ----------
  const [finishError, setFinishError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** The module's setup is answered, or set aside: the next module's setup opens, else the home. */
  const finish = async (destination: string): Promise<boolean> => {
    setFinishError(null);
    setLeaving(true);
    const answered = await answerModuleSetup(state.module.key).catch(() => ({ ok: false as const, code: "failed" }));
    if (!answered.ok) {
      setLeaving(false);
      setFinishError(
        t(
          answered.code === "not_allowed_in_support_session"
            ? "module-setup-support-visit"
            : "module-setup-finish-error",
        ),
      );
      return false;
    }
    router.push(destination);
    router.refresh();
    return true;
  };
  const destination = state.next?.href ?? "/inicio";
  const finishProblem = finishError ? (
    <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
      {finishError}
    </Alert>
  ) : null;

  const steps: Record<PassengerSetupStep, WizardStep> = {
    seguranca: {
      title: t("setup-factor-title"),
      hint: factor === "challenge" ? t("setup-factor-challenge") : t("module-setup-factor-hint"),
      canAdvance: factorOk && !blocked,
      hidePrimary: !factorOk && !blocked,
      content: factorOk ? (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          {t("setup-factor-done")}
        </Alert>
      ) : blocked ? null : (
        <SecondFactorPrompt
          state={factor}
          onConfirmed={() => {
            setConfirmedHere(true);
            goTo("valores");
          }}
        />
      ),
    },
    valores: {
      title: t("setup-claims-title"),
      hint: t("setup-claims-hint"),
      canAdvance: !blocked,
      onPrimary: saveClaims,
      content: (
        <Box className="flex flex-col gap-4">
          {!decides ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("setup-claims-not-partner")}
            </Alert>
          ) : null}
          {state.claimDefaults === null ? (
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={refresh}>
                  {t("today-retry")}
                </Button>
              }
            >
              {t("autonomy-claims-load-error")}
            </Alert>
          ) : (
            <ClaimValueChoice
              id="module-claim"
              choice={claimChoice}
              typed={claims}
              kinds={kinds}
              disabled={!claimsEditable}
              onChoice={(choice) => {
                setClaimChoice(choice);
                setClaimsError(null);
              }}
              onTyped={(incident, value) => setClaims((before) => ({ ...before, [incident]: value }))}
            />
          )}
          {claimsError ? (
            <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
              {claimsError}
            </Alert>
          ) : null}
        </Box>
      ),
    },
    clausula: {
      title: t("pax-setup-clause-title"),
      hint: t("pax-setup-clause-hint"),
      canAdvance: !blocked && (!clauseEditable || change.kind !== "invalid"),
      onPrimary: clause.save,
      primaryLabel:
        clauseEditable && change.kind === "register"
          ? inForce
            ? t("pax-clause-save")
            : t("pax-setup-clause-register")
          : undefined,
      secondary: !inForce && clauseEditable ? { label: t("setup-not-now"), onClick: () => goTo("agencia") } : undefined,
      content: (
        <FirmClauseFields
          draft={clause}
          clause={state.clause}
          clauseRead={state.clauseRead}
          proposal={state.proposal}
          decides={decides}
        />
      ),
    },
    agencia: {
      title: t("setup-agency-title"),
      hint: t("setup-agency-hint"),
      canAdvance: !blocked && !leaving,
      primaryLabel: state.next ? t("setup-finish-next", { module: state.next.name }) : t("setup-finish"),
      busy: leaving,
      onPrimary: () => finish(destination),
      content: (
        <Box className="flex flex-col gap-5">
          {noChannel && !blocked && connections ? (
            // The channel the partnership needs, connected here: the setup is never left for another screen.
            <Box className="flex flex-col gap-3">
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("pax-setup-agency-no-channel")}
              </Alert>
              <ConnectCard
                embedded
                firmName={connections.firm.name}
                again={connections.numbers.some((item) => item.provider !== "test")}
                pending={connections.pending}
                environment={connections.environment}
                blocked={blocked || !factorOk}
                onConnected={refresh}
                openWaPending={connections.openWaPending}
              />
            </Box>
          ) : null}
          {partners === null ? (
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={refresh}>
                  {t("today-retry")}
                </Button>
              }
            >
              {t("partners-load-error")}
            </Alert>
          ) : (
            <>
              {activePartners.length > 0 || partners.invitations.length > 0 ? (
                <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                  {activePartners.map((partnership) => (
                    <Box component="li" key={partnership.linkId} className="flex flex-wrap items-center gap-2">
                      <Typography variant="subtitle2" component="span" className="break-words">
                        {partnership.partner}
                      </Typography>
                      <StatusChip tone="positive" label={t("partners-status-active")} />
                    </Box>
                  ))}
                  {partners.invitations.map((invitation) => (
                    <Box component="li" key={invitation.id} className="flex flex-wrap items-center gap-2">
                      <Typography variant="subtitle2" component="span" className="break-words">
                        {invitation.partnerName ?? invitation.email}
                      </Typography>
                      <StatusChip tone="attention" label={t("setup-agency-invited")} />
                      <Typography variant="body2" className="text-text-secondary">
                        {t("setup-agency-invited-until", { date: day(invitation.expiresAt) })}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" className="text-text-secondary">
                  {t("setup-agency-none")}
                </Typography>
              )}
              <Box className="flex flex-wrap gap-2">
                <Button
                  variant="outlined"
                  color="grey"
                  onClick={() => setInvitingAgency(true)}
                  disabled={blocked || !factorOk}
                >
                  {t("setup-agency-invite")}
                </Button>
              </Box>
            </>
          )}
          <Box component="section" aria-labelledby="module-agency-needs" className="flex flex-col gap-2">
            <Typography id="module-agency-needs" variant="subtitle2" component="h3" className="mb-0">
              {t("setup-agency-needs-title")}
            </Typography>
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
              <Typography component="li" variant="body2" className="text-text-secondary">
                {t("setup-agency-needs-channel")}
              </Typography>
              <Typography component="li" variant="body2" className="text-text-secondary">
                {t("setup-agency-needs-release")}
              </Typography>
              <Typography component="li" variant="body2" className="text-text-secondary">
                {t("setup-agency-needs-test")}
              </Typography>
            </Box>
          </Box>
          {finishProblem}
        </Box>
      ),
    },
  };

  return (
    <Box className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* The module's colour on its icon and its count: the setup is told apart from the core and from another
          module's at a glance. */}
      <Box className="flex flex-row items-center gap-3">
        <span
          aria-hidden
          className={cn("flex h-12 w-12 flex-none items-center justify-center rounded-2xl", tone.bg, tone.text)}
        >
          <ModuleIcon name={state.module.icon} size="large" />
        </span>
        <Typography variant="subtitle2" component="p" className={tone.text}>
          {t("module-setup-position", { index: state.position.index, total: state.position.total })}
        </Typography>
      </Box>
      <PageHeader
        title={t("module-setup-title", { module: state.module.name })}
        description={t("module-setup-description", { module: state.module.name })}
        // No crumb leads away: the setup is left only by finishing it or setting it aside.
        crumbs={[{ label: state.firmName }, { label: t("module-setup-crumb") }]}
        action={
          !blocked ? (
            <Button variant="text" color="grey" disabled={leaving} onClick={() => void finish("/inicio")}>
              {state.answered ? t("module-setup-back") : t("setup-later")}
            </Button>
          ) : undefined
        }
      />
      {blocked ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("module-setup-support-visit")}
        </Alert>
      ) : null}
      {finishError && keys[stepIndex] !== "agencia" ? finishProblem : null}
      <SetupWizard
        steps={keys.map((key) => steps[key])}
        index={stepIndex}
        onIndexChange={setStepIndex}
        onComplete={() => undefined}
        completeLabel={t("setup-finish")}
        tone={state.module.tone}
      />

      {state.others.length > 0 ? (
        // What the firm could add one day, disabled: nothing here opens another screen.
        <Box component="section" aria-labelledby="module-setup-others" className="flex flex-col gap-3">
          <Box className="flex flex-col">
            <Typography id="module-setup-others" variant="h6" component="h2" className="mb-0">
              {t("module-setup-others-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("module-setup-others-body")}
            </Typography>
          </Box>
          <Grid container spacing={2}>
            {state.others.map((other) => (
              <Grid key={other.key} size={{ xs: 12, sm: 6 }}>
                <Box className="h-full opacity-60" aria-disabled>
                  <QuickActionTile
                    icon={<ModuleIcon name={other.icon} />}
                    tone={other.tone}
                    title={other.name}
                    description={other.soon ? t("modules-soon-note") : t("modules-locked-note")}
                    badge={
                      other.soon ? (
                        <StatusChip tone="attention" label={t("modules-status-soon")} />
                      ) : (
                        <NiLock size="small" className="text-text-secondary" />
                      )
                    }
                    label={other.soon ? undefined : `${other.name}, ${t("modules-status-locked")}`}
                  />
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      ) : null}

      {invitingAgency ? (
        <PartnerInvitePanel
          mode="agency"
          module={PASSENGER_MODULE}
          title={t("partners-invite-title")}
          onClose={() => setInvitingAgency(false)}
          onInvited={refresh}
        />
      ) : null}
    </Box>
  );
}
