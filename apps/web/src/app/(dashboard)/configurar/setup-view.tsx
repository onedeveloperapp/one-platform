"use client";

import { refusalWords } from "../biblioteca/import-panel";
import TemplateDialog from "../biblioteca/template-dialog";
import ConnectCard from "../settings/connections/components/connect-card";
import NoticesCard from "../settings/connections/components/notices-card";
import SignatureAccountCard from "../settings/connections/components/signature-account-card";
import TestChatCard from "../settings/connections/components/test-chat-card";
import { teamErrorKey } from "../settings/team/team-types";
import SetupCpf, { declareSetupCpf } from "./setup-cpf";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

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

import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import StatusChip from "@/components/product/status-chip";
import { useEmailReady } from "@/components/product/use-email-ready";
import WordDownloadButton from "@/components/product/word-download-button";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import type { SecondFactorState } from "@/lib/ai/approvals";
import { addOabRegistration, answerFirmSetup, inviteToFirm } from "@/lib/firm/actions";
import { autonomyErrorKey } from "@/lib/firm/autonomy";
import { setFirmSigner } from "@/lib/firm/autonomy-actions";
import { personFlowKey } from "@/lib/firm/person-setup";
import { FIRM_FUNCTIONS, type FirmFunction, formatOab, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";
import { SETUP_STEPS, setupOpening, type SetupStepKey } from "@/lib/firm/setup-steps";
import { readDraftTemplate } from "@/lib/library/actions";
import type { LibraryTemplate, SetupPaper } from "@/lib/library/facts";
import { watchModelImports } from "@/lib/library/import-actions";
import type { PaperImport } from "@/lib/library/import-read";
import { IMPORT_ACCEPT, IMPORT_STATUS_KEY, IMPORT_WORKING, importFailureKey } from "@/lib/library/imports";
import type { ConnectionsState } from "@/lib/whatsapp/connections";
import { createClient } from "@flyee/auth/client";
import { completeFlow } from "@flyee/onboarding";

export type SetupState =
  | { kind: "unavailable" }
  | { kind: "error" }
  /** The setup is who manages the firm's to do. */
  | { kind: "not-manager" }
  | {
      kind: "ready";
      userId: string;
      orgId: string;
      firmName: string;
      firmFunction: FirmFunction;
      /** Who answers decides for the firm what a partner decides (0078): a partner, or, with none, who manages it. */
      decidesForFirm: boolean;
      /** The registrations at the bar of who answers. */
      registrations: OabRegistration[];
      /** Who answers already signs what ONE prepares. */
      signs: boolean;
      /** Their CPF for the signature in the cloud is asked: a provider can be used here and they declared none. */
      asksCpf: boolean;
      /** What the firm said; null while it never answered. */
      worksAlone: boolean | null;
      answered: boolean;
      whatsapp: boolean;
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      isOwner: boolean;
      /** Which model ONE sends clients to sign of each paper; null when it could not be read. */
      papers: { procuracao: SetupPaper; contrato: SetupPaper } | null;
      /** What ONE does with the document the firm sent as each paper (0079), until it saved the firm's model. */
      paperImports: { procuracao: PaperImport | null; contrato: PaperImport | null };
      /** The firm's connections as their own screen reads them: the signature account, the test chat, the number. */
      connections: ConnectionsState;
      /**
       * The setup of the first module the firm contracted that it never answered (0081), which the core's finish
       * opens, in the module's colour; null when there is none, and the finish opens the home.
       */
      nextSetup: { href: string; name: string } | null;
      /** The step the address asked for (`?passo=`): the list on the home leads to the one something is missing in. */
      step: SetupStepKey | null;
    };

/** Digits and, in the sections that use one, the letter at the end: what the bar writes. */
const NUMBER_PATTERN = /^[0-9]{1,7}[A-Za-z]?$/;
const cleanNumber = (value: string) => value.replace(/[^0-9A-Za-z]/g, "");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Paper = "procuracao" | "contrato";

/**
 * The words of each paper a client signs: its name, what ONE sends of it, how the firm sends the one it already
 * uses, and how a person writes the firm's.
 */
const PAPER_WORDS: Record<Paper, { title: string; firm: string; one: string; send: string; make: string }> = {
  procuracao: {
    title: "setup-papers-procuracao",
    firm: "setup-papers-procuracao-firm",
    one: "setup-papers-procuracao-one",
    send: "setup-papers-send-procuracao",
    make: "setup-papers-procuracao-make",
  },
  contrato: {
    title: "setup-papers-contrato",
    firm: "setup-papers-contrato-firm",
    one: "setup-papers-contrato-none",
    send: "setup-papers-send-contrato",
    make: "setup-papers-contrato-make",
  },
};

/** How often the step looks again while ONE works on a document the firm sent. */
const PAPER_WATCH_MS = 6_000;

/**
 * What a firm sets up for ONE to work for it, one decision per screen: the
 * second factor first, since every step after it writes what the database asks
 * the factor for (a setup that met it half way stopped the owner at the
 * signer's switch, 2026-11-03: what a later step cannot do without is its own
 * step before it, and the flow does not go past it until it is done; the rule
 * is in apps/web/CLAUDE.md), then who
 * answers and whether they sign what ONE prepares, whether it works alone,
 * the papers its clients sign and the channel to them. This is the core,
 * what every firm needs whatever it contracted: what one module needs (the
 * passenger module's Valor da Causa Pedido, the words of its agencies'
 * clause, its partner agency) is that module's own setup, in its colour,
 * which the core's finish opens for each module the firm contracted and
 * never answered, before the home (the owner, 2026-11-03; migration 0081,
 * `firmSetup` of the module's definition). Nothing on it leads away from the
 * setup: the modules the firm contracted are said on the home, never here,
 * where a link to them took the owner out of a setup half done (2026-10-30;
 * the rule is in apps/web/CLAUDE.md). Each step does its own work where it
 * is: the second factor is set up in its step, the
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
  // Who signs and the Valor da Causa Pedido are a partner's to say, or, in a firm with no partner, who manages it
  // (0078): a firm founded by a lawyer alone is never left with nobody to answer them.
  const decides = state.decidesForFirm;
  const registered = state.registrations.length > 0;
  const blocked = state.supportVisit;

  // ---------- The second factor ----------
  // Confirmed here, before the page reads the session again: every step goes on from the same moment.
  const [confirmedHere, setConfirmedHere] = useState(false);
  const factor: SecondFactorState = confirmedHere ? "ok" : state.secondFactor;
  // What the database asks the factor for (who signs, the claims, an invitation, a connection) is past its step,
  // so nothing here waits for it; the guard stays for a session that lost it.
  const locked = factor !== "ok";
  const choosesSigner = decides && !locked;

  // ---------- Who answers, at the bar ----------
  const [uf, setUf] = useState("");
  const [number, setNumber] = useState("");
  const [touched, setTouched] = useState(false);
  const [signs, setSigns] = useState(choosesSigner ? true : state.signs);
  const [oabError, setOabError] = useState<string | null>(null);
  const numberOk = NUMBER_PATTERN.test(cleanNumber(number));
  // The CPF for the signature in the cloud, optional: what is typed goes only whole and checked, and one that is not
  // is said under the field when the step goes on.
  const asksCpf = lawyer && state.asksCpf;
  const [cpf, setCpf] = useState("");
  const [cpfError, setCpfError] = useState<string | null>(null);
  const oabReady = !lawyer || registered || (Boolean(uf) && numberOk);

  // ---------- Alone or with a team ----------
  const [worksAlone, setWorksAlone] = useState<boolean | null>(state.worksAlone);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteFunction, setInviteFunction] = useState<FirmFunction>("advogado");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState<{ email: string; link: string | null; chosen: boolean; copied: boolean }[]>(
    [],
  );
  // The invitation is offered as a link always, and by e-mail where ONE can send one.
  const emailOk = useEmailReady();
  const [inviteError, setInviteError] = useState<string | null>(null);

  // ---------- The papers a client signs ----------
  const [paperForm, setPaperForm] = useState<{
    paper: Paper;
    template: LibraryTemplate | null;
    copyOf: LibraryTemplate | null;
    /** The document the firm already uses, sent for ONE to make the firm's model of it (0079). */
    file?: File | null;
    /** A request ONE works or worked on, opened to follow it, answer it or check it. */
    importId?: string | null;
  } | null>(null);
  // The file chooser opens in the person's own click; the paper it was opened for is remembered here.
  const paperInput = useRef<HTMLInputElement>(null);
  const choosingPaper = useRef<Paper>("procuracao");
  const choosePaper = (paper: Paper) => {
    choosingPaper.current = paper;
    paperInput.current?.click();
  };
  // While ONE works on a document sent here, the step looks again by itself and reads anew when a state changed.
  const paperWorking = (["procuracao", "contrato"] as const)
    .map((paper) => state.paperImports[paper])
    .filter((request): request is PaperImport => request !== null && IMPORT_WORKING.includes(request.status))
    .map((request) => `${request.id}:${request.status}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!paperWorking) return;
    let open = true;
    const timer = setInterval(() => {
      watchModelImports()
        .then((watched) => {
          if (!open || !watched.ok) return;
          const now = watched.pending
            .map((item) => `${item.id}:${item.status}`)
            .filter((key) => paperWorking.split(",").some((known) => known.split(":")[0] === key.split(":")[0]))
            .sort()
            .join(",");
          if (now !== paperWorking) router.refresh();
        })
        .catch(() => undefined);
    }, PAPER_WATCH_MS);
    return () => {
      open = false;
      clearInterval(timer);
    };
  }, [paperWorking, router]);

  // ---------- The end ----------
  const [finishError, setFinishError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // A flow left half way opens where something is missing; one answered before opens at its first step past the
  // factor, and the list on the home opens the step it names. Whatever was asked, a session without the factor
  // opens on it, and once confirmed goes on to where it was going. The Valor da Causa Pedido is never missing:
  // with none, the judge defines it.
  const missing: [boolean, SetupStepKey][] = [
    [(lawyer && !registered) || (decides && lawyer && !state.signs), "oab"],
    [state.worksAlone === null, "equipe"],
    [!state.whatsapp, "canal"],
  ];
  const opening = setupOpening({
    factorOk: state.secondFactor === "ok",
    asked: state.step,
    answered: state.answered,
    firstMissing: missing.find(([open]) => open)?.[1] ?? null,
  });
  const [stepIndex, setStepIndex] = useState(SETUP_STEPS.indexOf(opening.open));

  const onFactor = () => {
    setConfirmedHere(true);
    // Who signs is chosen with the factor: a partner who did not sign yet is offered it, as on a first visit.
    if (decides && !state.signs) setSigns(true);
    setStepIndex(SETUP_STEPS.indexOf(opening.afterFactor));
  };

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
    if (asksCpf) {
      setCpfError(null);
      const refused = await declareSetupCpf(cpf);
      if (refused) {
        setCpfError(t(refused));
        return false;
      }
    }
    refresh();
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

  /** Invites by e-mail, or makes the link and copies it for the manager to send by their own channel. */
  const invite = async (way: "email" | "link") => {
    setInviteError(null);
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) {
      setInviteError(t("setup-team-invite-email-invalid"));
      return;
    }
    setInviting(true);
    const chosen = way === "link" || !emailOk;
    const result = await inviteToFirm({
      email: address,
      role: "member",
      firmFunction: inviteFunction,
      deliver: chosen ? "link" : "email",
    });
    setInviting(false);
    if (!result.ok) {
      setInviteError(t(teamErrorKey(result.code)));
      return;
    }
    let copied = false;
    if (chosen && result.link) {
      try {
        await navigator.clipboard.writeText(result.link);
        copied = true;
      } catch {
        copied = false;
      }
    }
    setInvited((current) => [...current, { email: address, link: result.link ?? null, chosen, copied }]);
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
    // The firm's setup asked the person's own steps (the factor, the registration): their own setup is answered too,
    // and the home does not ask them again what they just set aside here.
    await completeFlow(createClient(), personFlowKey(state.userId, state.orgId)).catch(() => undefined);
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

  // The channel finishes the core: the setup of each module the firm contracted follows it, in the module's colour
  // (0081), else the home.
  const next = state.nextSetup;
  const finishing = {
    primaryLabel: next ? t("setup-finish-next", { module: next.name }) : t("setup-finish"),
    onPrimary: () => finish(next?.href ?? "/inicio"),
    busy: leaving,
  };
  const finishProblem = finishError ? (
    <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
      {finishError}
    </Alert>
  ) : null;

  const steps: WizardStep[] = [
    {
      title: t("setup-factor-title"),
      // An account with a factor only confirms it in this session; one with none sets it up, and is told why.
      hint: factor === "challenge" ? t("setup-factor-challenge") : t("setup-factor-hint"),
      // The steps after it write what the database asks the factor for: the flow does not go past it without one.
      canAdvance: factor === "ok" && !blocked,
      // Until it is confirmed the step's action is the prompt's own (start, confirm), and confirming goes on by
      // itself: a "Continuar" beside it would be a second button for the same decision, pressed to no effect.
      hidePrimary: factor !== "ok" && !blocked,
      content:
        factor === "ok" ? (
          <Alert severity="success" className="neutral bg-background-paper/60!">
            {t("setup-factor-done")}
          </Alert>
        ) : blocked ? null : (
          <SecondFactorPrompt state={factor} onConfirmed={onFactor} />
        ),
    },
    {
      title: t("setup-oab-title"),
      hint: lawyer ? t("setup-oab-hint") : undefined,
      canAdvance: oabReady && !blocked,
      onPrimary: saveOab,
      secondary:
        lawyer && !registered
          ? { label: t("setup-not-now"), onClick: () => setStepIndex(SETUP_STEPS.indexOf("equipe")) }
          : undefined,
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

          {lawyer && decides ? (
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
            </Box>
          ) : lawyer ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("setup-oab-not-partner")}
            </Typography>
          ) : null}

          {asksCpf ? (
            <SetupCpf
              id="setup-cpf"
              value={cpf}
              onChange={(value) => {
                setCpf(value);
                setCpfError(null);
              }}
              disabled={blocked}
              error={cpfError}
            />
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
              <Box className="flex flex-wrap gap-2">
                <Button
                  variant="outlined"
                  color="grey"
                  onClick={() => void invite("link")}
                  disabled={blocked || locked || inviting}
                >
                  {inviting ? t("saving") : t("setup-team-invite-copy-link")}
                </Button>
                {emailOk ? (
                  <Button
                    variant="outlined"
                    color="grey"
                    onClick={() => void invite("email")}
                    disabled={blocked || locked || inviting}
                  >
                    {t("setup-team-invite-send")}
                  </Button>
                ) : null}
              </Box>
              {emailOk === false ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("setup-team-invite-email-off")}
                </Typography>
              ) : null}
              {invited.map((entry) => (
                <Alert key={entry.email} severity="success" className="neutral bg-background-paper/60!" role="status">
                  {entry.chosen && entry.link
                    ? t(entry.copied ? "setup-team-invite-link-copied" : "setup-team-invite-link-made", {
                        email: entry.email,
                        link: entry.link,
                      })
                    : entry.link
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
              const used = choice.used;
              const own = used && !used.platform ? used : null;
              const words = PAPER_WORDS[paper];
              // A paper of the firm is changed; the platform's power of attorney is a start; a contract is new.
              const can = lawyer && !blocked && (own !== null || choice.platform !== null || paper === "contrato");
              // The document the firm already uses is the first way: ONE checks it and makes the firm's model of it.
              const sends = lawyer && !blocked;
              const request = state.paperImports[paper];
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
                  {own?.preparedByOne ? (
                    <Typography variant="body2" className="text-text-secondary">
                      {t("setup-papers-prepared-by-one")}
                    </Typography>
                  ) : null}
                  {request ? (
                    <PaperRequestLine
                      request={request}
                      paper={paper}
                      onOpen={() => setPaperForm({ paper, template: null, copyOf: null, importId: request.id })}
                      onSendAnother={sends ? () => choosePaper(paper) : null}
                    />
                  ) : null}
                  {sends || can || used ? (
                    <Box className="flex flex-wrap gap-2">
                      {/* One document at a time: while ONE works on one or asks, and after a refusal, its line
                          offers what comes next; one that waits for a person may still be replaced by another. */}
                      {sends &&
                      (!request ||
                        (request.status !== "asking" &&
                          request.status !== "refused" &&
                          request.status !== "failed" &&
                          !IMPORT_WORKING.includes(request.status))) ? (
                        <Button
                          variant="outlined"
                          color="grey"
                          size="small"
                          startIcon={<NiUploadCloud size="small" />}
                          onClick={() => choosePaper(paper)}
                        >
                          {t(words.send)}
                        </Button>
                      ) : null}
                      {can ? (
                        <Button variant="text" color="grey" size="small" onClick={() => openPaper(paper, choice)}>
                          {own ? t("setup-papers-open") : t(words.make)}
                        </Button>
                      ) : null}
                      {/* The paper ONE sends, the firm's or the platform's, taken in Word by whoever sets the firm up. */}
                      {used ? (
                        <WordDownloadButton
                          name={used.name}
                          read={() => readDraftTemplate(used.id).then((read) => (read.ok ? read.body : null))}
                        />
                      ) : null}
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
          <input
            ref={paperInput}
            type="file"
            hidden
            accept={IMPORT_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) setPaperForm({ paper: choosingPaper.current, template: null, copyOf: null, file });
            }}
          />

          <Box component="section" aria-labelledby="setup-papers-sign" className="flex flex-col gap-2">
            <Typography id="setup-papers-sign" variant="subtitle2" component="h3" className="mb-0">
              {t("setup-papers-sign-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("setup-papers-sign-govbr")}
            </Typography>
          </Box>
          {connections ? (
            <SignatureAccountCard
              embedded
              account={connections.signature}
              blocked={blocked || locked}
              vault={connections.environment.vault}
              onChanged={refresh}
            />
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
      ...finishing,
      content: (
        <Box className="flex flex-col gap-6">
          {!connections ? (
            connectionsError
          ) : (
            <>
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
          {next ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("setup-next-module", { module: next.name })}
            </Typography>
          ) : null}
          {finishProblem}
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
          // A document sent here is sent as this paper: ONE refuses another thing, and its model is the one ONE sends.
          initialFile={paperForm.file ?? null}
          importId={paperForm.importId ?? null}
          expected={paperForm.file || paperForm.importId ? paperForm.paper : null}
          makeDefault={Boolean(paperForm.file)}
          onImportRequested={refresh}
          onClose={() => {
            // What ONE did meanwhile is read again: the step says it.
            if (paperForm.file || paperForm.importId) refresh();
            setPaperForm(null);
          }}
          onSaved={() => {
            setPaperForm(null);
            refresh();
          }}
        />
      ) : null}
    </Box>
  );
}

/**
 * What ONE does with the document the firm sent as a paper (0079), said in
 * the step with the one thing to do next: follow it while ONE works, answer
 * what ONE asks, check what waits for a person, or send another document
 * after a refusal. Everything opens over the step: nothing leads away.
 */
function PaperRequestLine({
  request,
  paper,
  onOpen,
  onSendAnother,
}: {
  request: PaperImport;
  paper: Paper;
  onOpen: () => void;
  onSendAnother: (() => void) | null;
}) {
  const t = useTranslations("product");
  const working = IMPORT_WORKING.includes(request.status);
  const said =
    request.status === "asking"
      ? t("setup-papers-request-asking", { file: request.fileName })
      : request.status === "ready"
        ? t("setup-papers-request-ready", { file: request.fileName })
        : request.status === "refused"
          ? refusalWords(t, request.refusal, paper)
          : request.status === "failed"
            ? t(importFailureKey(request.failure))
            : t("setup-papers-request-working", { file: request.fileName });
  const action =
    request.status === "asking"
      ? { label: t("setup-papers-answer"), onClick: onOpen, primary: true }
      : request.status === "ready"
        ? { label: t("setup-papers-review"), onClick: onOpen, primary: true }
        : working
          ? { label: t("setup-papers-follow"), onClick: onOpen, primary: false }
          : onSendAnother
            ? { label: t("setup-papers-send-again"), onClick: onSendAnother, primary: false }
            : null;
  return (
    <Box className="flex flex-wrap items-center gap-2" role="status">
      <StatusChip
        tone={
          request.status === "failed"
            ? "danger"
            : request.status === "ready"
              ? "positive"
              : working
                ? "info"
                : "attention"
        }
        label={t(IMPORT_STATUS_KEY[request.status])}
      />
      <Typography variant="body2" className="text-text-secondary min-w-0 flex-1 basis-60 break-words">
        {said}
      </Typography>
      {action ? (
        <Button
          variant={action.primary ? "contained" : "text"}
          color={action.primary ? "primary" : "grey"}
          size="small"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </Box>
  );
}
