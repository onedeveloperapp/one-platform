"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Input,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import PartnerInviteDialog from "@/components/partners/partner-invite-dialog";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import StatusChip from "@/components/product/status-chip";
import WordDownloadButton from "@/components/product/word-download-button";
import type { SecondFactorState } from "@/lib/ai/approvals";
import { renamePartner } from "@/lib/partners/actions";
import type { PartnerTeamState } from "@/lib/partners/facts";
import { PARTNER_ROLE_KEY, partnerErrorKey } from "@/lib/partners/partner";
import { answerPartnerSetup } from "@/lib/partners/setup-actions";
import { enterAfterSessionChange } from "@/lib/safe-next";
import { saveClause } from "@/modules/direito-do-passageiro/agency/actions";
import { paxErrorKey } from "@/modules/direito-do-passageiro/agency/passengers";
import {
  agencySetupOpening,
  type AgencySetupStep,
  agencySetupSteps,
  CLAUSE_MOST,
  clauseChange,
  clauseText,
  PASSENGER_WAY_HREF,
  type PassengerWay,
  passengerWays,
} from "@/modules/direito-do-passageiro/agency/setup";

/** What the agency's setup shows (migration 0080), read under the person's own session by `setup-state.ts`. */
export type AgencySetupState =
  | { kind: "unavailable" }
  | {
      kind: "ready";
      agency: { id: string; name: string; manager: boolean; owner: boolean; answered: boolean };
      /** The firm of the agency's partnership in the passenger module; null while it has none active. */
      firm: string | null;
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      /** The clause of the agency's contract in force; null with none. */
      clause: { version: number; body: string } | null;
      /** Whether the clause could be read: one that could not is never said to be missing. */
      clauseRead: boolean;
      /** The clause ONE proposes, with the agency's and the firm's names; null when there is none to read. */
      proposal: string | null;
      /** The agency's team and its open invitations, for who manages it; null when it could not be read. */
      team: Extract<PartnerTeamState, { kind: "ready" }> | null;
      /** The step the address asked for (`?passo=`). */
      step: AgencySetupStep | null;
    };

// The words of each way the passengers reach ONE, spelled out so the catalog check sees each key.
const WAY_WORDS: Record<PassengerWay, { title: string; help: string }> = {
  "um-a-um": { title: "partner-setup-way-one", help: "partner-setup-way-one-help" },
  planilha: { title: "partner-setup-way-sheet", help: "partner-setup-way-sheet-help" },
  api: { title: "partner-setup-way-api", help: "partner-setup-way-api-help" },
};

/**
 * What a travel agency sets up to work with its firm in ONE, one decision per screen: the second factor first,
 * which every write of the agency asks for (an agency's first person was sent to a page of settings that said
 * nothing of the agency and got lost there, the owner, 2026-11-03); then, for who manages the agency, its name,
 * the clause of its contract (ONE proposes the words, the agency registers them), its team, and how its passengers
 * reach ONE, where the setup ends by opening that way. Nothing on it leads away from the setup (the rule is in
 * apps/web/CLAUDE.md): the factor is set up in its step, colleagues are invited in a dialog over it, and "Fazer
 * depois" sets it aside on purpose. Each step saves what it asks before the next one opens.
 */
export default function AgencySetupView({ state }: { state: AgencySetupState }) {
  const t = useTranslations("product");
  if (state.kind !== "ready") {
    return (
      <Box className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PageHeader title={t("partner-setup-page-title")} crumbs={[{ label: t("partner-setup-crumb") }]} />
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("partner-setup-unavailable")}
        </Alert>
      </Box>
    );
  }
  return <AgencySetupFlow state={state} />;
}

function AgencySetupFlow({ state }: { state: Extract<AgencySetupState, { kind: "ready" }> }) {
  const t = useTranslations("product");
  const router = useRouter();
  const refresh = () => router.refresh();
  const { agency } = state;
  const manager = agency.manager;
  const blocked = state.supportVisit;

  // ---------- The second factor ----------
  // Confirmed here, before the page reads the session again: every step goes on from the same moment.
  const [confirmedHere, setConfirmedHere] = useState(false);
  const factor: SecondFactorState = confirmedHere ? "ok" : state.secondFactor;
  const factorOk = factor === "ok";

  const keys = agencySetupSteps(manager);
  const opening = agencySetupOpening({ factorOk: state.secondFactor === "ok", asked: state.step, manager });
  const [stepIndex, setStepIndex] = useState(keys.indexOf(opening.open));
  const goTo = (key: AgencySetupStep) => setStepIndex(Math.max(0, keys.indexOf(key)));
  const onFactor = () => {
    setConfirmedHere(true);
    goTo(opening.afterFactor);
  };

  // ---------- The agency's name ----------
  const [name, setName] = useState(agency.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const cleanName = name.replace(/\s+/g, " ").trim();
  const nameOk = cleanName.length >= 2 && cleanName.length <= 120;
  const saveName = async (): Promise<boolean> => {
    setNameError(null);
    if (cleanName === agency.name) return true;
    const result = await renamePartner(cleanName).catch(() => ({ ok: false as const, code: "failed" }));
    if (!result.ok) {
      setNameError(t(partnerErrorKey(result.code)));
      return false;
    }
    refresh();
    return true;
  };

  // ---------- The clause of the agency's contract ----------
  const inForce = state.clause?.body ?? null;
  // What the person typed; untouched (null), the field shows the clause in force or ONE's proposal as the page
  // reads it now, so a name corrected in the step before is already in ONE's words.
  const [clauseDraft, setClauseDraft] = useState<string | null>(null);
  const clause = clauseDraft ?? inForce ?? state.proposal ?? "";
  const setClause = (value: string) => setClauseDraft(value);
  const [clauseError, setClauseError] = useState<string | null>(null);
  // Registered here, before the page reads it again: the last step stops asking for it at once.
  const [registeredHere, setRegisteredHere] = useState(false);
  const change = clauseChange(clause, inForce);
  const fromOne = state.proposal !== null && clauseText(clause) === clauseText(state.proposal);
  const length = clauseText(clause).length;
  const saveClauseStep = async (): Promise<boolean> => {
    setClauseError(null);
    // With no partnership the agency registers nothing yet: the step says so and goes on.
    if (!state.firm || change.kind === "same") return true;
    if (change.kind === "invalid") {
      setClauseError(t("partner-setup-clause-invalid"));
      return false;
    }
    const result = await saveClause(change.text).catch(() => ({ ok: false as const, code: "failed" }));
    if (!result.ok) {
      setClauseError(t(paxErrorKey(result.code)));
      return false;
    }
    setRegisteredHere(true);
    refresh();
    return true;
  };
  const hasClause = inForce !== null || registeredHere;

  // ---------- The team ----------
  const [inviting, setInviting] = useState(false);

  // ---------- The way the passengers reach ONE ----------
  const ways = passengerWays(manager);
  const [way, setWay] = useState<PassengerWay>("um-a-um");

  // ---------- The end ----------
  const [finishError, setFinishError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** The setup is answered, or set aside, by who manages the agency; the page is loaded anew where it leads. */
  const finish = async (destination: string): Promise<boolean> => {
    setFinishError(null);
    setLeaving(true);
    if (manager && !agency.answered) {
      const answered = await answerPartnerSetup().catch(() => ({ ok: false as const, code: "failed" }));
      if (!answered.ok) {
        setLeaving(false);
        setFinishError(t(partnerErrorKey(answered.code)));
        return false;
      }
    }
    // Loaded anew, so the gate reads the factor and the answer just given: no page sends the person back here.
    await enterAfterSessionChange(destination);
    return true;
  };
  const finishProblem = finishError ? (
    <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
      {finishError}
    </Alert>
  ) : null;

  const noPartnership = state.firm === null;
  const factorStep: WizardStep = {
    title: t("setup-factor-title"),
    hint: factor === "challenge" ? t("setup-factor-challenge") : t("partner-setup-factor-hint"),
    // Every step after it writes what the database asks the factor for: the flow does not go past it without one.
    canAdvance: factorOk && !blocked,
    // Until it is confirmed the step's action is the prompt's own, and confirming goes on by itself.
    hidePrimary: !factorOk && !blocked,
    content: factorOk ? (
      <Alert severity="success" className="neutral bg-background-paper/60!">
        {t("setup-factor-done")}
      </Alert>
    ) : blocked ? null : (
      <SecondFactorPrompt state={factor} onConfirmed={onFactor} />
    ),
  };

  const nameStep: WizardStep = {
    title: t("partner-setup-name-title"),
    hint: t("partner-setup-name-hint"),
    canAdvance: nameOk && !blocked,
    onPrimary: saveName,
    content: (
      <Box className="flex flex-col gap-4">
        <FormControl fullWidth className="outlined" variant="standard" error={Boolean(nameError) || !nameOk}>
          <FormLabel component="label" htmlFor="partner-setup-name">
            {t("partner-setup-name-label")}
          </FormLabel>
          <Input
            id="partner-setup-name"
            value={name}
            autoComplete="organization"
            onChange={(event) => setName(event.target.value)}
            disabled={blocked}
            aria-describedby="partner-setup-name-help"
          />
          <FormHelperText id="partner-setup-name-help">
            {nameError ?? (nameOk ? t("partner-setup-name-help") : t("partner-error-name"))}
          </FormHelperText>
        </FormControl>
        {state.firm && nameOk ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="subtitle2" component="p">
              {t("partner-setup-name-preview-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary break-words">
              {t("partner-setup-name-preview", { agency: cleanName, firm: state.firm })}
            </Typography>
          </Box>
        ) : null}
      </Box>
    ),
  };

  const clauseStep: WizardStep = {
    title: t("partner-setup-clause-title"),
    hint: t("partner-setup-clause-hint"),
    canAdvance: !blocked && (noPartnership || change.kind !== "invalid"),
    onPrimary: saveClauseStep,
    primaryLabel:
      !noPartnership && change.kind === "register"
        ? inForce
          ? t("pax-clause-save")
          : t("partner-setup-clause-register")
        : undefined,
    secondary: !hasClause && !noPartnership ? { label: t("setup-not-now"), onClick: () => goTo("equipe") } : undefined,
    content: noPartnership ? (
      <Alert severity="info" className="neutral bg-background-paper/60!">
        {t("partner-setup-clause-no-partnership")}
      </Alert>
    ) : (
      <Box className="flex flex-col gap-4">
        {state.clause ? (
          <Box>
            <StatusChip tone="positive" label={t("pax-clause-version", { version: state.clause.version })} />
          </Box>
        ) : null}
        {fromOne && !inForce ? (
          // What ONE proposes is said as ONE's, with what to check: the clause is the agency's to register.
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("partner-setup-clause-from-one")}
          </Alert>
        ) : null}
        {!state.clauseRead ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("partner-setup-clause-unread")}
          </Alert>
        ) : null}
        <TextField
          id="partner-setup-clause"
          label={t("pax-clause-label")}
          value={clause}
          multiline
          minRows={8}
          fullWidth
          disabled={blocked}
          error={Boolean(clauseError) || length > CLAUSE_MOST}
          helperText={clauseError ?? t("pax-clause-count", { count: length })}
          onChange={(event) => {
            setClause(event.target.value);
            if (clauseError) setClauseError(null);
          }}
        />
        <Box className="flex flex-wrap items-center gap-2">
          {/* The clause goes into the agency's contract with the passenger: taken in Word as it is written here. */}
          <WordDownloadButton name={t("partner-setup-clause-file")} text={clauseText(clause)} />
          {state.proposal !== null && !fromOne ? (
            <Button variant="text" color="grey" size="small" onClick={() => setClause(state.proposal ?? "")}>
              {t("partner-setup-clause-restore")}
            </Button>
          ) : null}
        </Box>
      </Box>
    ),
  };

  const team = state.team;
  const teamStep: WizardStep = {
    title: t("partner-setup-team-title"),
    hint: t("partner-setup-team-hint"),
    canAdvance: !blocked,
    content: (
      <Box className="flex flex-col gap-4">
        {team ? (
          <>
            <Box component="section" aria-labelledby="partner-setup-team-people" className="flex flex-col gap-2">
              <Typography id="partner-setup-team-people" variant="subtitle2" component="h3" className="mb-0">
                {t("partner-setup-team-people")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                {team.teammates.map((teammate) => (
                  <Box
                    component="li"
                    key={teammate.userId}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <Typography variant="body1" className="min-w-0 break-words">
                      {teammate.userId === team.me
                        ? t("partner-setup-team-you", { name: teammate.name })
                        : teammate.name}
                    </Typography>
                    <StatusChip tone="neutral" label={t(PARTNER_ROLE_KEY[teammate.role])} />
                  </Box>
                ))}
              </Box>
            </Box>
            {team.invitations.length > 0 ? (
              <Box component="section" aria-labelledby="partner-setup-team-open" className="flex flex-col gap-2">
                <Typography id="partner-setup-team-open" variant="subtitle2" component="h3" className="mb-0">
                  {t("partner-setup-team-open")}
                </Typography>
                <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                  {team.invitations.map((invitation) => (
                    <Box
                      component="li"
                      key={invitation.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <Typography variant="body1" className="min-w-0 break-all">
                        {invitation.email}
                      </Typography>
                      <StatusChip tone="info" label={t("partner-setup-team-invited")} />
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : null}
          </>
        ) : (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={refresh}>
                {t("today-retry")}
              </Button>
            }
          >
            {t("partner-setup-team-error")}
          </Alert>
        )}
        <Box>
          <Button variant="outlined" color="grey" onClick={() => setInviting(true)} disabled={blocked || !factorOk}>
            {t("partner-setup-team-invite")}
          </Button>
        </Box>
      </Box>
    ),
  };

  const passengersStep: WizardStep = {
    title: t("partner-setup-way-title"),
    hint: noPartnership ? undefined : t("partner-setup-way-hint"),
    canAdvance: !leaving,
    primaryLabel: t("setup-finish"),
    busy: leaving,
    onPrimary: () => finish(noPartnership ? "/parceiro" : PASSENGER_WAY_HREF[way]),
    content: (
      <Box className="flex flex-col gap-5">
        {noPartnership ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("partner-setup-way-no-partnership")}
          </Alert>
        ) : (
          <>
            <FormControl component="fieldset">
              <FormLabel component="legend" id="partner-setup-way" className="sr-only">
                {t("partner-setup-way-title")}
              </FormLabel>
              <RadioGroup
                aria-labelledby="partner-setup-way"
                className="gap-3"
                value={way}
                onChange={(event) => setWay(event.target.value as PassengerWay)}
              >
                {ways.map((option) => (
                  <FormControlLabel
                    key={option}
                    value={option}
                    control={<Radio />}
                    label={
                      <Box className="flex flex-col">
                        <Typography variant="subtitle2">{t(WAY_WORDS[option].title)}</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {t(WAY_WORDS[option].help)}
                        </Typography>
                      </Box>
                    }
                  />
                ))}
              </RadioGroup>
            </FormControl>
            {state.clauseRead && !hasClause ? (
              <Alert
                severity="warning"
                className="neutral bg-background-paper/60!"
                action={
                  manager ? (
                    <Button color="inherit" size="small" onClick={() => goTo("clausula")}>
                      {t("pax-clause-register")}
                    </Button>
                  ) : undefined
                }
              >
                {manager ? t("partner-setup-way-no-clause") : t("pax-clause-missing-member")}
              </Alert>
            ) : null}
            {/* What follows the registration is ONE's work, said as ONE's: never a task of the agency. */}
            <Typography variant="body2" className="text-text-secondary">
              {t("partner-setup-way-after")}
            </Typography>
          </>
        )}
        {finishProblem}
      </Box>
    ),
  };

  const byKey: Record<AgencySetupStep, WizardStep> = {
    seguranca: factorStep,
    nome: nameStep,
    clausula: clauseStep,
    equipe: teamStep,
    passageiros: passengersStep,
  };
  const steps = keys.map((key) => byKey[key]);

  return (
    <Box className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title={t("partner-setup-page-title")}
        description={
          state.firm
            ? t("partner-setup-page-description", { firm: state.firm })
            : t("partner-setup-page-description-no-firm")
        }
        // No crumb leads away: the setup is left only by finishing it or setting it aside.
        crumbs={[{ label: agency.name }, { label: t("partner-setup-crumb") }]}
        action={
          manager && factorOk && !blocked ? (
            <Button variant="text" color="grey" disabled={leaving} onClick={() => void finish("/parceiro")}>
              {agency.answered ? t("partner-setup-back") : t("setup-later")}
            </Button>
          ) : undefined
        }
      />
      {blocked ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("partner-setup-support-visit")}
        </Alert>
      ) : null}
      {finishError && keys[stepIndex] !== "passageiros" ? finishProblem : null}
      <SetupWizard
        steps={steps}
        index={stepIndex}
        onIndexChange={setStepIndex}
        onComplete={() => undefined}
        completeLabel={t("setup-finish")}
      />
      {inviting ? (
        <PartnerInviteDialog
          mode="colleague"
          title={t("partner-team-invite-title", { partner: agency.name })}
          mayInviteAdmin={agency.owner}
          onClose={() => setInviting(false)}
          onInvited={refresh}
        />
      ) : null}
    </Box>
  );
}
