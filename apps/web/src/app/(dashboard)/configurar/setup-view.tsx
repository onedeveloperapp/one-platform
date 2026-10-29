"use client";

import TemplateDialog from "../biblioteca/template-dialog";
import ClaimValueChoice from "../settings/autonomia/claim-value-choice";
import ConnectCard from "../settings/connections/components/connect-card";
import NoticesCard from "../settings/connections/components/notices-card";
import SignatureAccountCard from "../settings/connections/components/signature-account-card";
import TestChatCard from "../settings/connections/components/test-chat-card";
import { teamErrorKey } from "../settings/team/team-types";
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
  Grid,
  Input,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Switch,
  Typography,
} from "@mui/material";

import { useViewer } from "@/components/layout/viewer-context";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import type { SecondFactorState } from "@/lib/ai/approvals";
import { addOabRegistration, answerFirmSetup, inviteToFirm } from "@/lib/firm/actions";
import {
  autonomyErrorKey,
  type ClaimChoice,
  claimChoiceOf,
  type ClaimDefault,
  claimDefaultChanges,
  typedClaims,
} from "@/lib/firm/autonomy";
import { setFirmClaimDefault, setFirmSigner } from "@/lib/firm/autonomy-actions";
import { FIRM_FUNCTIONS, type FirmFunction, formatOab, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";
import { SETUP_STEPS, type SetupStepKey } from "@/lib/firm/setup-steps";
import type { LibraryTemplate, SetupPaper } from "@/lib/library/facts";
import { caseKindLabelKey, firmCaseKinds } from "@/lib/modules/registry";
import type { ConnectionsState } from "@/lib/whatsapp/connections";

export type SetupState =
  | { kind: "unavailable" }
  | { kind: "error" }
  /** The setup is who manages the firm's to do. */
  | { kind: "not-manager" }
  | {
      kind: "ready";
      userId: string;
      firmName: string;
      firmFunction: FirmFunction;
      /** The registrations at the bar of who answers. */
      registrations: OabRegistration[];
      /** Who answers already signs what ONE prepares. */
      signs: boolean;
      /** What the firm said; null while it never answered. */
      worksAlone: boolean | null;
      answered: boolean;
      whatsapp: boolean;
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      isOwner: boolean;
      /** The claim the firm asks by default for each kind of problem; null when it could not be read. */
      claimDefaults: ClaimDefault[] | null;
      /** Which model ONE sends clients to sign of each paper; null when it could not be read. */
      papers: { procuracao: SetupPaper; contrato: SetupPaper } | null;
      /** The firm's connections as their own screen reads them: the signature account, the test chat, the number. */
      connections: ConnectionsState;
      /** The step the address asked for (`?passo=`): the list on the home leads to the one something is missing in. */
      step: SetupStepKey | null;
    };

/** Digits and, in the sections that use one, the letter at the end: what the bar writes. */
const NUMBER_PATTERN = /^[0-9]{1,7}[A-Za-z]?$/;
const cleanNumber = (value: string) => value.replace(/[^0-9A-Za-z]/g, "");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Paper = "procuracao" | "contrato";

/** The words of each paper a client signs: its name, what ONE sends of it, and how a person writes the firm's. */
const PAPER_WORDS: Record<Paper, { title: string; firm: string; one: string; make: string }> = {
  procuracao: {
    title: "setup-papers-procuracao",
    firm: "setup-papers-procuracao-firm",
    one: "setup-papers-procuracao-one",
    make: "setup-papers-procuracao-make",
  },
  contrato: {
    title: "setup-papers-contrato",
    firm: "setup-papers-contrato-firm",
    one: "setup-papers-contrato-none",
    make: "setup-papers-contrato-make",
  },
};

/**
 * What a firm sets up for ONE to work for it, one decision per screen: who
 * answers and whether they sign what ONE prepares, the Valor da Causa Pedido
 * (a value for each kind of problem, or none for the judge to define),
 * whether it works alone, the papers its
 * clients sign, and the channel to them. Each step does its own work where it
 * is: the second factor a decision asks for is set up in the step, the
 * models are written in a dialog over it, the signature account, the test
 * chat and the number are connected in it, so nobody leaves the setup for a
 * screen they would not come back from. Each step saves what it asks before
 * the next one opens, so leaving half way keeps what was answered; "Fazer
 * depois" sets the setup aside, and the list on the home leads back to the
 * step something is still missing in.
 */
export default function SetupView({ state }: { state: SetupState }) {
  const t = useTranslations("product");
  const router = useRouter();

  if (state.kind !== "ready") {
    return (
      <Box className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PageHeader
          title={t("setup-page-title")}
          crumbs={[{ label: t("settings-home"), href: "/inicio" }, { label: t("setup-crumb") }]}
        />
        <Alert
          severity={state.kind === "error" ? "error" : "info"}
          className="neutral bg-background-paper/60!"
          action={
            state.kind === "error" ? (
              <Button color="inherit" size="small" onClick={() => router.refresh()}>
                {t("today-retry")}
              </Button>
            ) : state.kind === "not-manager" ? (
              <Button color="inherit" size="small" href="/inicio">
                {t("setup-go-home")}
              </Button>
            ) : undefined
          }
        >
          {state.kind === "error"
            ? t("setup-error-read")
            : state.kind === "not-manager"
              ? t("setup-not-manager")
              : t("settings-unavailable")}
        </Alert>
      </Box>
    );
  }

  return <SetupFlow state={state} />;
}

function SetupFlow({ state }: { state: Extract<SetupState, { kind: "ready" }> }) {
  const t = useTranslations("product");
  const router = useRouter();
  const refresh = () => router.refresh();

  const lawyer = state.firmFunction === "socio" || state.firmFunction === "advogado";
  const partner = state.firmFunction === "socio";
  const registered = state.registrations.length > 0;
  const blocked = state.supportVisit;

  // ---------- The second factor ----------
  // Confirmed here, before the page reads the session again: every step goes on from the same moment.
  const [confirmedHere, setConfirmedHere] = useState(false);
  const factor: SecondFactorState = confirmedHere ? "ok" : state.secondFactor;
  // What the database asks the factor for (who signs, the claims, an invitation, a connection) waits for it.
  const locked = factor !== "ok";
  const choosesSigner = partner && !locked;

  // ---------- Who answers, at the bar ----------
  const [uf, setUf] = useState("");
  const [number, setNumber] = useState("");
  const [touched, setTouched] = useState(false);
  const [signs, setSigns] = useState(choosesSigner ? true : state.signs);
  const [oabError, setOabError] = useState<string | null>(null);
  const numberOk = NUMBER_PATTERN.test(cleanNumber(number));
  const oabReady = !lawyer || registered || (Boolean(uf) && numberOk);

  const onFactor = () => {
    setConfirmedHere(true);
    // Who signs is chosen with the factor: a partner who did not sign yet is offered it, as on a first visit.
    if (partner && !state.signs) setSigns(true);
  };

  /** The step's way to the second factor, saying what it is for; nothing in a support visit or once confirmed. */
  const factorPrompt = (id: string, reason: string) =>
    !blocked && factor !== "ok" ? (
      <SecondFactorPrompt id={id} state={factor} reason={reason} onConfirmed={onFactor} />
    ) : null;

  // ---------- The Valor da Causa Pedido ----------
  // What was chosen and typed, as the fields hold it, until the page reads it back.
  const [claimChoice, setClaimChoice] = useState<ClaimChoice>(() => claimChoiceOf(state.claimDefaults ?? []));
  const claimKinds = firmCaseKinds(useViewer()?.modules);
  const [claims, setClaims] = useState<Partial<Record<string, string>>>(() => typedClaims(state.claimDefaults ?? []));
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const claimsEditable = partner && !locked && !blocked && state.claimDefaults !== null;

  // ---------- Alone or with a team ----------
  const [worksAlone, setWorksAlone] = useState<boolean | null>(state.worksAlone);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteFunction, setInviteFunction] = useState<FirmFunction>("advogado");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState<{ email: string; link: string | null }[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // ---------- The papers a client signs ----------
  const [paperForm, setPaperForm] = useState<{
    paper: Paper;
    template: LibraryTemplate | null;
    copyOf: LibraryTemplate | null;
  } | null>(null);

  // ---------- The end ----------
  const [finishError, setFinishError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // A flow left half way opens where something is missing; one answered before opens at its start, and the list
  // on the home opens the step it names. The Valor da Causa Pedido is never missing: with none, the judge defines it.
  const missing: [boolean, SetupStepKey][] = [
    [(lawyer && !registered) || (partner && !state.signs), "oab"],
    [state.worksAlone === null, "equipe"],
    [!state.whatsapp, "canal"],
  ];
  const firstOpen = SETUP_STEPS.indexOf(missing.find(([open]) => open)?.[1] ?? "oab");
  const [stepIndex, setStepIndex] = useState(
    state.step ? SETUP_STEPS.indexOf(state.step) : state.answered ? 0 : firstOpen,
  );

  const saveOab = async (): Promise<boolean> => {
    setOabError(null);
    if (!lawyer) return true;
    if (!registered) {
      setTouched(true);
      if (!uf || !numberOk) return false;
      const added = await addOabRegistration({ uf, number: cleanNumber(number), kind: "principal" });
      if (!added.ok) {
        setOabError(t(teamErrorKey(added.code)));
        return false;
      }
    }
    if (choosesSigner && signs !== state.signs) {
      const chosen = await setFirmSigner(state.userId, signs);
      if (!chosen.ok) {
        setOabError(t(autonomyErrorKey(chosen.code)));
        return false;
      }
    }
    refresh();
    return true;
  };

  // Each kind whose value changed is said or taken back (all of them, for no value); one that is no amount keeps
  // the step, saying which.
  const saveClaims = async (): Promise<boolean> => {
    setClaimsError(null);
    if (!claimsEditable) return true;
    const planned = claimDefaultChanges(
      claimChoice,
      claims,
      state.claimDefaults ?? [],
      claimKinds.map((kind) => kind.key),
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

  const saveTeam = async (): Promise<boolean> => {
    setTeamError(null);
    if (worksAlone === null) return false;
    const answered = await answerFirmSetup({ worksAlone });
    if (!answered.ok) {
      setTeamError(t(teamErrorKey(answered.code)));
      return false;
    }
    return true;
  };

  const invite = async () => {
    setInviteError(null);
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) {
      setInviteError(t("setup-team-invite-email-invalid"));
      return;
    }
    setInviting(true);
    const result = await inviteToFirm({ email: address, role: "member", firmFunction: inviteFunction });
    setInviting(false);
    if (!result.ok) {
      setInviteError(t(teamErrorKey(result.code)));
      return;
    }
    setInvited((current) => [...current, { email: address, link: result.link ?? null }]);
    setEmail("");
  };

  /** The setup is answered, or set aside: the firm goes on to its home. */
  const finish = async (destination: string): Promise<boolean> => {
    setFinishError(null);
    setLeaving(true);
    const answered = await answerFirmSetup({ finished: true });
    if (!answered.ok) {
      setLeaving(false);
      setFinishError(t(teamErrorKey(answered.code)));
      return false;
    }
    router.push(destination);
    router.refresh();
    return true;
  };

  /** A paper's model opens over the step: the firm's own to change, else the platform's to start from, else new. */
  const openPaper = (paper: Paper, choice: SetupPaper) => {
    const own = choice.used && !choice.used.platform ? choice.used : null;
    setPaperForm({ paper, template: own, copyOf: own ? null : choice.platform });
  };

  const papers = state.papers;
  const signerPrompt = factorPrompt("setup-oab-factor", t("setup-oab-signs-factor"));
  const connections = state.connections.kind === "ready" ? state.connections : null;
  const realNumber = connections?.numbers.find((item) => item.status === "active" && item.provider !== "test") ?? null;
  const connectionsError = (
    <Alert
      severity="error"
      className="neutral bg-background-paper/60!"
      action={
        <Button color="inherit" size="small" onClick={refresh}>
          {t("today-retry")}
        </Button>
      }
    >
      {t("connections-load-error")}
    </Alert>
  );

  const steps: WizardStep[] = [
    {
      title: t("setup-oab-title"),
      hint: lawyer ? t("setup-oab-hint") : undefined,
      canAdvance: oabReady && !blocked,
      onPrimary: saveOab,
      secondary: lawyer && !registered ? { label: t("setup-not-now"), onClick: () => setStepIndex(1) } : undefined,
      content: (
        <Box className="flex flex-col gap-4">
          {!lawyer ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("setup-oab-not-lawyer")}
            </Alert>
          ) : registered ? (
            <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
              {state.registrations.map((registration) => (
                <Typography key={registration.id} component="li" variant="subtitle2">
                  {t("setup-oab-registered", { oab: formatOab(registration) })}
                </Typography>
              ))}
            </Box>
          ) : (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth className="outlined" variant="standard" error={touched && !uf}>
                  <FormLabel component="label" htmlFor="setup-oab-uf" id="setup-oab-uf-label">
                    {t("team-oab-uf")}
                  </FormLabel>
                  <Select
                    id="setup-oab-uf-select"
                    labelId="setup-oab-uf-label"
                    inputProps={{ id: "setup-oab-uf" }}
                    value={uf}
                    displayEmpty
                    onChange={(event) => setUf(String(event.target.value))}
                    disabled={blocked}
                  >
                    <MenuItem value="" disabled>
                      {t("team-oab-uf-placeholder")}
                    </MenuItem>
                    {OAB_STATES.map((stateCode) => (
                      <MenuItem key={stateCode} value={stateCode}>
                        {stateCode}
                      </MenuItem>
                    ))}
                  </Select>
                  {touched && !uf ? <FormHelperText>{t("team-oab-uf-required")}</FormHelperText> : null}
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 8 }}>
                <FormControl
                  fullWidth
                  className="outlined"
                  variant="standard"
                  error={(touched || number.length > 0) && !numberOk}
                >
                  <FormLabel component="label" htmlFor="setup-oab-number">
                    {t("team-oab-number")}
                  </FormLabel>
                  <Input
                    id="setup-oab-number"
                    value={number}
                    inputMode="numeric"
                    autoComplete="off"
                    onChange={(event) => setNumber(event.target.value)}
                    onBlur={() => setTouched(true)}
                    disabled={blocked}
                    aria-describedby="setup-oab-number-help"
                  />
                  <FormHelperText id="setup-oab-number-help">
                    {(touched || number.length > 0) && !numberOk
                      ? t("team-error-oab-invalid")
                      : t("team-oab-number-help")}
                  </FormHelperText>
                </FormControl>
              </Grid>
            </Grid>
          )}

          {lawyer && partner ? (
            <Box className="flex flex-col gap-1">
              <FormControlLabel
                control={
                  <Switch
                    checked={signs}
                    onChange={(event) => setSigns(event.target.checked)}
                    disabled={blocked || !choosesSigner}
                  />
                }
                label={t("setup-oab-signs")}
              />
              <Typography variant="body2" className="text-text-secondary">
                {t("setup-oab-signs-help")}
              </Typography>
              {signerPrompt ? <Box className="mt-2">{signerPrompt}</Box> : null}
            </Box>
          ) : lawyer ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("setup-oab-not-partner")}
            </Typography>
          ) : null}

          {oabError ? (
            <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
              {oabError}
            </Alert>
          ) : null}
        </Box>
      ),
    },
    {
      title: t("setup-claims-title"),
      hint: t("setup-claims-hint"),
      canAdvance: !blocked,
      onPrimary: saveClaims,
      content: (
        <Box className="flex flex-col gap-4">
          {!partner ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("setup-claims-not-partner")}
            </Alert>
          ) : (
            factorPrompt("setup-claims-factor", t("setup-claims-factor"))
          )}
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
              id="setup-claim"
              choice={claimChoice}
              typed={claims}
              kinds={claimKinds}
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
    {
      title: t("setup-team-title"),
      hint: t("setup-team-hint"),
      canAdvance: worksAlone !== null && !blocked,
      onPrimary: saveTeam,
      content: (
        <Box className="flex flex-col gap-4">
          <FormControl component="fieldset">
            <FormLabel component="legend" id="setup-team-choice" className="sr-only">
              {t("setup-team-title")}
            </FormLabel>
            <RadioGroup
              aria-labelledby="setup-team-choice"
              className="gap-3"
              value={worksAlone === null ? "" : worksAlone ? "alone" : "team"}
              onChange={(event) => setWorksAlone(event.target.value === "alone")}
            >
              <FormControlLabel
                value="alone"
                disabled={blocked}
                control={<Radio />}
                label={
                  <Box className="flex flex-col">
                    <Typography variant="subtitle2">{t("setup-team-alone")}</Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {t("setup-team-alone-help")}
                    </Typography>
                  </Box>
                }
              />
              <FormControlLabel
                value="team"
                disabled={blocked}
                control={<Radio />}
                label={
                  <Box className="flex flex-col">
                    <Typography variant="subtitle2">{t("setup-team-with")}</Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {t("setup-team-with-help")}
                    </Typography>
                  </Box>
                }
              />
            </RadioGroup>
          </FormControl>

          {worksAlone === false ? (
            <Box className="flex flex-col gap-3">
              <Typography variant="subtitle2" component="h3">
                {t("setup-team-invite-title")}
              </Typography>
              {factorPrompt("setup-team-factor", t("setup-team-factor"))}
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, sm: 7 }}>
                  <FormControl fullWidth className="outlined" variant="standard" error={Boolean(inviteError)}>
                    <FormLabel component="label" htmlFor="setup-invite-email">
                      {t("setup-team-invite-email")}
                    </FormLabel>
                    <Input
                      id="setup-invite-email"
                      type="email"
                      value={email}
                      autoComplete="off"
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={blocked || locked || inviting}
                      aria-describedby="setup-invite-email-help"
                    />
                    <FormHelperText id="setup-invite-email-help">
                      {inviteError ?? t("setup-team-invite-help")}
                    </FormHelperText>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 5 }}>
                  <FormControl fullWidth className="outlined" variant="standard">
                    <FormLabel component="label" htmlFor="setup-invite-function" id="setup-invite-function-label">
                      {t("setup-team-invite-function")}
                    </FormLabel>
                    <Select
                      id="setup-invite-function-select"
                      labelId="setup-invite-function-label"
                      inputProps={{ id: "setup-invite-function" }}
                      value={inviteFunction}
                      onChange={(event) => setInviteFunction(event.target.value as FirmFunction)}
                      disabled={blocked || locked || inviting}
                    >
                      {FIRM_FUNCTIONS.map((role) => (
                        <MenuItem key={role} value={role}>
                          {t(`team-function-${role}`)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
              <Box>
                <Button
                  variant="outlined"
                  color="grey"
                  onClick={() => void invite()}
                  disabled={blocked || locked || inviting}
                >
                  {inviting ? t("saving") : t("setup-team-invite-send")}
                </Button>
              </Box>
              {invited.map((entry) => (
                <Alert key={entry.email} severity="success" className="neutral bg-background-paper/60!" role="status">
                  {entry.link
                    ? t("setup-team-invite-link", { email: entry.email, link: entry.link })
                    : t("setup-team-invite-sent", { email: entry.email })}
                </Alert>
              ))}
            </Box>
          ) : null}

          {teamError ? (
            <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
              {teamError}
            </Alert>
          ) : null}
        </Box>
      ),
    },
    {
      title: t("setup-papers-title"),
      hint: t("setup-papers-hint"),
      canAdvance: !blocked,
      content: (
        <Box className="flex flex-col gap-6">
          {papers === null ? (
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={refresh}>
                  {t("today-retry")}
                </Button>
              }
            >
              {t("setup-papers-load-error")}
            </Alert>
          ) : (
            (["procuracao", "contrato"] as const).map((paper) => {
              const choice = papers[paper];
              const own = choice.used && !choice.used.platform ? choice.used : null;
              const words = PAPER_WORDS[paper];
              // A paper of the firm is changed; the platform's power of attorney is a start; a contract is new.
              const can = lawyer && !blocked && (own !== null || choice.platform !== null || paper === "contrato");
              return (
                <Box
                  key={paper}
                  component="section"
                  aria-labelledby={`setup-papers-${paper}`}
                  className="flex flex-col gap-2"
                >
                  <Typography id={`setup-papers-${paper}`} variant="subtitle2" component="h3" className="mb-0">
                    {t(words.title)}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {own ? t(words.firm, { name: own.name }) : t(words.one)}
                  </Typography>
                  {can ? (
                    <Box>
                      <Button variant="outlined" color="grey" size="small" onClick={() => openPaper(paper, choice)}>
                        {own ? t("setup-papers-open") : t(words.make)}
                      </Button>
                    </Box>
                  ) : null}
                </Box>
              );
            })
          )}
          {!lawyer ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("setup-papers-not-lawyer")}
            </Alert>
          ) : null}

          <Box component="section" aria-labelledby="setup-papers-sign" className="flex flex-col gap-2">
            <Typography id="setup-papers-sign" variant="subtitle2" component="h3" className="mb-0">
              {t("setup-papers-sign-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("setup-papers-sign-govbr")}
            </Typography>
          </Box>
          {connections ? (
            <>
              {connections.signature?.status === "connected"
                ? null
                : factorPrompt("setup-papers-factor", t("setup-papers-factor"))}
              <SignatureAccountCard
                embedded
                account={connections.signature}
                blocked={blocked || locked}
                vault={connections.environment.vault}
                onChanged={refresh}
              />
            </>
          ) : (
            connectionsError
          )}
        </Box>
      ),
    },
    {
      title: t("setup-channel-title"),
      hint: t("setup-channel-hint"),
      canAdvance: !blocked,
      primaryLabel: t("setup-finish"),
      onPrimary: () => finish("/inicio"),
      busy: leaving,
      content: (
        <Box className="flex flex-col gap-6">
          {!connections ? (
            connectionsError
          ) : (
            <>
              {factorPrompt("setup-channel-factor", t("setup-channel-factor"))}
              {realNumber ? (
                <>
                  <Alert severity="success" className="neutral bg-background-paper/60!">
                    {t("setup-channel-whatsapp-done")}
                  </Alert>
                  <NoticesCard embedded notices={connections.notices} blocked={blocked || locked} onChanged={refresh} />
                </>
              ) : (
                <>
                  {connections.testChat ? (
                    <TestChatCard
                      embedded
                      state={connections.testChat.state}
                      url={connections.testChat.url}
                      sinceLabel={connections.testChat.sinceLabel}
                      blocked={blocked || locked}
                      onChanged={refresh}
                    />
                  ) : null}
                  <ConnectCard
                    embedded
                    firmName={connections.firm.name}
                    again={connections.numbers.some((item) => item.provider !== "test")}
                    pending={connections.pending}
                    environment={connections.environment}
                    blocked={blocked || locked}
                    onConnected={refresh}
                  />
                </>
              )}
            </>
          )}
          {finishError ? (
            <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
              {finishError}
            </Alert>
          ) : null}
        </Box>
      ),
    },
  ];

  return (
    <Box className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title={t("setup-page-title")}
        description={t("setup-page-description")}
        crumbs={[{ label: t("settings-home"), href: "/inicio" }, { label: t("setup-crumb") }]}
        action={
          <Button variant="text" color="grey" disabled={leaving || blocked} onClick={() => void finish("/inicio")}>
            {t("setup-later")}
          </Button>
        }
      />
      {blocked ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("setup-support-visit")}
        </Alert>
      ) : null}
      <SetupWizard
        steps={steps}
        index={stepIndex}
        onIndexChange={setStepIndex}
        onComplete={() => undefined}
        completeLabel={t("setup-finish")}
      />
      {paperForm ? (
        <TemplateDialog
          template={paperForm.template}
          copyOf={paperForm.copyOf}
          // The firm's default of the paper, which the one saved here takes the place of.
          defaults={Object.fromEntries(
            (["procuracao", "contrato"] as const).flatMap((paper) => {
              const name = papers?.[paper].firmDefault ?? null;
              return name && name !== paperForm.template?.name ? [[paper, name]] : [];
            }),
          )}
          initialDocument={paperForm.paper}
          initialDefault
          onClose={() => setPaperForm(null)}
          onSaved={() => {
            setPaperForm(null);
            refresh();
          }}
        />
      ) : null}
    </Box>
  );
}
