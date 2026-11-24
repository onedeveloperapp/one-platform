"use client";

import TemplatePanel from "../biblioteca/template-panel";
import ConnectCard from "../settings/connections/components/connect-card";
import SignatureAccountCard from "../settings/connections/components/signature-account-card";
import TestChatCard from "../settings/connections/components/test-chat-card";
import NoticesCard from "../settings/mensagens/notices-card";
import { teamErrorKey } from "../settings/team/team-types";
import { useAreasStep } from "./setup-areas";
import SetupCpf, { declareSetupCpf } from "./setup-cpf";
import { useFilingStep } from "./setup-filing";
import { type SetupBrand, type SetupLetterhead, useOfficeStep } from "./setup-office";
import { SetupQuestion, useOperationStep, YesNo } from "./setup-operation";
import { type Paper, usePaperRows } from "./setup-papers";
import { usePersonalityStep } from "./setup-personality";
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

import { useMarkSetupShown } from "@/components/layout/setup-shown";
import CopyButton from "@/components/product/copy-button";
import InfoHint from "@/components/product/info-hint";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SectionTitle from "@/components/product/section-title";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import StateLine from "@/components/product/state-line";
import { useEmailReady } from "@/components/product/use-email-ready";
import type { SecondFactorState } from "@/lib/ai/approvals";
import type { AreaScriptsState } from "@/lib/areas/script-actions";
import type { FilingWaysData } from "@/lib/filing-ways/ways";
import { addOabRegistration, answerFirmSetup, inviteToFirm } from "@/lib/firm/actions";
import { autonomyErrorKey } from "@/lib/firm/autonomy";
import { setFirmSigner } from "@/lib/firm/autonomy-actions";
import type { FirmOffice } from "@/lib/firm/office";
import type { FirmOperation, KnownArea, OperationArea } from "@/lib/firm/operation";
import { personFlowKey } from "@/lib/firm/person-setup";
import type { PersonalityState } from "@/lib/firm/personality-actions";
import { FIRM_FUNCTIONS, type FirmFunction, formatOab, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";
import { SETUP_STEPS, setupOpening, type SetupStepKey } from "@/lib/firm/setup-steps";
import type { LibraryTemplate, SetupPaper } from "@/lib/library/facts";
import { watchModelImports } from "@/lib/library/import-actions";
import type { PaperImport } from "@/lib/library/import-read";
import { IMPORT_ACCEPT, IMPORT_WORKING } from "@/lib/library/imports";
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
      /** Where the firm is, as the power of attorney says it (0217). */
      office: FirmOffice;
      /** The firm's logo and colour (0258). */
      brand: SetupBrand;
      /** The firm's letterhead (0260). */
      letterhead: SetupLetterhead;
      /** The firm's profile (0272): ONE's draft, the approved one, and ONE's writing owed. */
      personality: PersonalityState | null;
      /** The script of each area of the firm that no module serves (0273); null when it could not be read. */
      areaScripts: AreaScriptsState | null;
      /** The firm said how it works and its areas (0256): ONE answers nobody new on the WhatsApp before it did. */
      operationAnswered: boolean;
      operation: FirmOperation;
      /** The firm's areas, its modules' included. */
      areas: OperationArea[];
      /** The areas of law ONE knows. */
      knownAreas: KnownArea[];
      /** How the firm and who answers file on the courts' screens (0263); null when it could not be read. */
      filing: FilingWaysData | null;
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

/** How often the step looks again while ONE works on a document the firm sent. */
const PAPER_WATCH_MS = 6_000;

/** The two answers of the team's step, each with what it means behind its "i". */
const TEAM_WORDS = {
  alone: { label: "setup-team-alone", help: "setup-team-alone-help" },
  team: { label: "setup-team-with", help: "setup-team-with-help" },
} as const;

/** What an invitation made in the step says: sent by e-mail, or its link to copy. */
const INVITE_DONE_KEY = { email: "setup-team-invite-done-email", link: "setup-team-invite-done-link" } as const;

/**
 * What a firm sets up for ONE to work for it, one decision per screen, in the order of the owner's canvas of
 * 2026-11-24 ("Configuração do escritório, antes e depois"): the second factor first, since every step after it writes
 * what the database asks the factor for (a setup that met it half way stopped the owner at the signer's switch,
 * 2026-11-03), then who answers at the bar, the firm's documents with the data ONE reads from them, how it works, its
 * team, how it files on the courts' screens, how it speaks to its clients and the script of each area, and the
 * channel, where the client also signs. This is the core, what every firm needs whatever it contracted: what one
 * module needs is that module's own setup, in its colour, which the core's finish opens for each module the firm
 * contracted and never answered, before the home (0081). Nothing on it leads away from the setup (2026-10-30): every
 * step does its work where it is, and what opens opens over it.
 *
 * One rule of buttons in every step (the owner, 2026-11-24, after a "Salvar" beside "Continuar" let the person go on
 * without saving): "Continuar" saves everything the step holds and goes on, or stays and says what is missing beside
 * the field; nothing inside a step is called "Salvar", and only the button that goes on is filled; what acts at once
 * (sending a document, connecting, inviting) is outlined and says what came of it in its own line; going back, or to
 * a step of the list, loses nothing typed; and "Continuar depois" saves what is complete before going home, where the
 * list leads back to the step something is still missing in.
 */
export default function SetupView({ state }: { state: SetupState }) {
  const t = useTranslations("product");
  const router = useRouter();
  // The header leaves out the search and "Adicionar" while a setup is on the screen, on /inicio too.
  useMarkSetupShown();

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
  // Who signs is a partner's to say, or, in a firm with no partner, who manages it (0078): a firm founded by a lawyer
  // alone is never left with nobody to answer it.
  const decides = state.decidesForFirm;
  const registered = state.registrations.length > 0;
  const blocked = state.supportVisit;

  // ---------- The second factor ----------
  // Confirmed here, before the page reads the session again: every step goes on from the same moment.
  const [confirmedHere, setConfirmedHere] = useState(false);
  const factor: SecondFactorState = confirmedHere ? "ok" : state.secondFactor;
  // What the database asks the factor for (who signs, an invitation, a connection) is past its step, so nothing here
  // waits for it; the guard stays for a session that lost it.
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
  // The state of the registration given in this step, before the page reads it again: the step of the filing shows
  // the courts of that state at once.
  const [addedUf, setAddedUf] = useState<string | null>(null);

  // ---------- Alone or with a team ----------
  const [worksAlone, setWorksAlone] = useState<boolean | null>(state.worksAlone);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteFunction, setInviteFunction] = useState<FirmFunction>("advogado");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState<{ email: string; link: string | null; byEmail: boolean }[]>([]);
  // The invitation goes by e-mail where ONE can send one, and its link is there to copy either way.
  const emailOk = useEmailReady();
  const [inviteError, setInviteError] = useState<string | null>(null);

  // ---------- The papers a client signs, in the step of the office ----------
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

  /** A paper's model opens over the step: the firm's own to change, else the platform's to start from, else new. */
  const openPaper = (paper: Paper, choice: SetupPaper) => {
    const own = choice.used && !choice.used.platform ? choice.used : null;
    setPaperForm({ paper, template: own, copyOf: own ? null : choice.platform });
  };

  const paperRows = usePaperRows({
    papers: state.papers,
    imports: state.paperImports,
    writes: lawyer,
    blocked: blocked || locked,
    onSend: choosePaper,
    onFollow: (paper, requestId) => setPaperForm({ paper, template: null, copyOf: null, importId: requestId }),
    onOpenModel: openPaper,
    onRetry: refresh,
  });

  // ---------- The office: its documents, its logo and colour, where it is (0258) ----------
  const officeStep = useOfficeStep({
    office: state.office,
    brand: state.brand,
    letterhead: state.letterhead,
    paperRows,
    readingPaper: (["procuracao", "contrato"] as const).some((paper) => {
      const request = state.paperImports[paper];
      return request !== null && IMPORT_WORKING.includes(request.status);
    }),
    blocked: blocked || locked,
    onChanged: refresh,
  });

  // ---------- How the firm works and its areas (0256) ----------
  const operationStep = useOperationStep({
    answered: state.operationAnswered,
    operation: state.operation,
    areas: state.areas,
    knownAreas: state.knownAreas,
    registrationStates: state.registrations.map((registration) => registration.uf),
    blocked: blocked || locked,
  });
  // A firm that said ONE prepares no filing package is asked nothing of how it files.
  const onePrepares = operationStep.works.one_filing !== false;

  // ---------- How the firm files on the courts' screens (0263) ----------
  // Who decides for the firm chooses the firm's way; who answers and signs, their own way at each court of their
  // states in the same step (the canvas the owner approved).
  const myStates = Array.from(
    new Set([
      ...state.registrations.map((registration) => registration.uf),
      ...(state.filing?.myStates ?? []),
      ...(addedUf ? [addedUf] : []),
    ]),
  );
  const filingStep = useFilingStep({
    filing: state.filing,
    firmForm: decides,
    myStates: lawyer ? myStates : [],
    blocked: blocked || locked,
    onSaved: refresh,
  });

  // ---------- The firm's profile (0272) and the script of each area (0273) ----------
  const personalityStep = usePersonalityStep({
    initial: state.personality,
    blocked: blocked || locked,
    onApproved: refresh,
  });
  const approvedProfile = Boolean(state.personality?.approved);
  const areasStep = useAreasStep({ initial: state.areaScripts, blocked: blocked || locked });
  const scriptsPending = Boolean(state.areaScripts?.areas.some((area) => !area.inForce));

  // ---------- The end ----------
  // The account of signatures, an option of the channel's step, opened when asked.
  const [signOpen, setSignOpen] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // A flow left half way opens where something is missing; one answered before opens at its first step past the
  // factor, and the list on the home opens the step it names. Whatever was asked, a session without the factor
  // opens on it, and once confirmed goes on to where it was going.
  const missing: [boolean, SetupStepKey][] = [
    [(lawyer && !registered) || (decides && lawyer && !state.signs), "oab"],
    [!state.brand.logoUrl, "escritorio"],
    [!state.operationAnswered, "operacao"],
    [state.worksAlone === null, "equipe"],
    [onePrepares && filingStep.owed, "protocolo"],
    [!approvedProfile, "personalidade"],
    [scriptsPending, "areas"],
    [!state.whatsapp, "canal"],
  ];
  const opening = setupOpening({
    factorOk: state.secondFactor === "ok",
    asked: state.step,
    answered: state.answered,
    firstMissing: missing.find(([open]) => open)?.[1] ?? null,
  });
  const [stepIndex, setStepIndex] = useState(SETUP_STEPS.indexOf(opening.open));
  const goTo = (step: SetupStepKey) => setStepIndex(SETUP_STEPS.indexOf(step));

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
      setAddedUf(uf);
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

  /** Invites who is typed: by e-mail where ONE can send one, the link there to copy either way. */
  const invite = async (): Promise<boolean> => {
    setInviteError(null);
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) {
      setInviteError(t("setup-team-invite-email-invalid"));
      return false;
    }
    setInviting(true);
    const byEmail = emailOk === true;
    const result = await inviteToFirm({
      email: address,
      role: "member",
      firmFunction: inviteFunction,
      deliver: byEmail ? "email" : "link",
    });
    setInviting(false);
    if (!result.ok) {
      setInviteError(t(teamErrorKey(result.code)));
      return false;
    }
    setInvited((current) => [
      ...current,
      { email: address, link: result.link ?? null, byEmail: byEmail && !result.link },
    ]);
    setEmail("");
    return true;
  };

  /** The team's step: who is typed is invited, the answer kept, and whether the firm has a controladoria with it. */
  const saveTeam = async (): Promise<boolean> => {
    setTeamError(null);
    if (worksAlone === null) return false;
    if (worksAlone === false && email.trim() && !(await invite())) return false;
    const answered = await answerFirmSetup({ worksAlone });
    if (!answered.ok) {
      setTeamError(t(teamErrorKey(answered.code)));
      return false;
    }
    return operationStep.saveWorks();
  };

  /** The filing's step: whether ONE prepares the packages, then how the firm and who answers file. */
  const saveFiling = async (): Promise<boolean> => {
    if (!(await operationStep.saveWorks())) return false;
    return onePrepares ? filingStep.onPrimary() : true;
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
  const finishProblem = finishError ? (
    <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
      {finishError}
    </Alert>
  ) : null;

  const notNow = (step: SetupStepKey): WizardStep["secondary"] => ({
    label: t("setup-not-now"),
    onClick: () => goTo(step),
  });

  const steps: WizardStep[] = [
    {
      label: t("setup-step-label-security"),
      done: factor === "ok",
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
          <StateLine tone="done">{t("setup-factor-done")}</StateLine>
        ) : blocked ? null : (
          <SecondFactorPrompt state={factor} onConfirmed={onFactor} />
        ),
    },
    {
      label: t("setup-step-label-oab"),
      done: !lawyer || (registered && (!decides || state.signs)),
      title: t("setup-oab-title"),
      hint: lawyer ? t("setup-oab-hint") : undefined,
      canAdvance: oabReady && !blocked,
      onPrimary: saveOab,
      onLeave: async () => (oabReady ? saveOab() : true),
      secondary: lawyer && !registered ? notNow("escritorio") : undefined,
      content: (
        <Box className="flex flex-col gap-4">
          {!lawyer ? (
            <StateLine tone="info">{t("setup-oab-not-lawyer")}</StateLine>
          ) : registered ? (
            <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
              {state.registrations.map((registration) => (
                <Box component="li" key={registration.id}>
                  <StateLine tone="done">{t("setup-oab-registered", { oab: formatOab(registration) })}</StateLine>
                </Box>
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
            <Box className="flex flex-row items-center gap-1">
              <FormControlLabel
                control={
                  <Switch
                    checked={signs}
                    onChange={(event) => setSigns(event.target.checked)}
                    disabled={blocked || !choosesSigner}
                  />
                }
                label={t("setup-oab-signs")}
                className="m-0"
              />
              <InfoHint label={t("setup-oab-signs-help")} />
            </Box>
          ) : lawyer ? (
            <StateLine tone="info">{t("setup-oab-not-partner")}</StateLine>
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
      label: t("setup-step-label-office"),
      title: t("setup-office-title"),
      hint: t("setup-office-hint"),
      canAdvance: !blocked,
      ...officeStep,
    },
    {
      label: t("setup-step-label-operation"),
      title: t("setup-operation-title"),
      hint: t("setup-operation-hint"),
      ...operationStep,
    },
    {
      label: t("setup-step-label-team"),
      done: state.worksAlone !== null,
      title: t("setup-team-title"),
      hint: t("setup-team-hint"),
      canAdvance: worksAlone !== null && !blocked && !inviting,
      onPrimary: saveTeam,
      onLeave: async () => (worksAlone === null ? true : saveTeam()),
      content: (
        <Box className="flex flex-col gap-5">
          <FormControl component="fieldset">
            <FormLabel component="legend" id="setup-team-choice" className="sr-only">
              {t("setup-team-title")}
            </FormLabel>
            <RadioGroup
              aria-labelledby="setup-team-choice"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              value={worksAlone === null ? "" : worksAlone ? "alone" : "team"}
              onChange={(event) => setWorksAlone(event.target.value === "alone")}
            >
              {(["alone", "team"] as const).map((option) => (
                <FormControlLabel
                  key={option}
                  value={option}
                  disabled={blocked}
                  control={<Radio />}
                  className="border-grey-100 m-0 rounded-lg border py-2 pe-3"
                  label={
                    <Box className="flex flex-row items-center gap-1">
                      <Typography variant="subtitle2" component="span">
                        {t(TEAM_WORDS[option].label)}
                      </Typography>
                      <InfoHint label={t(TEAM_WORDS[option].help)} />
                    </Box>
                  }
                />
              ))}
            </RadioGroup>
          </FormControl>

          {worksAlone === false ? (
            <Box component="section" aria-labelledby="setup-team-invite" className="flex flex-col gap-3">
              <SectionTitle
                id="setup-team-invite"
                title={t("setup-team-invite-title")}
                description={t("setup-team-invite-help")}
                as="h3"
                variant="subtitle1"
              />
              <Box className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <FormControl fullWidth className="outlined" variant="standard" error={Boolean(inviteError)}>
                  <FormLabel component="label" htmlFor="setup-invite-email">
                    {t("setup-team-invite-email")}
                  </FormLabel>
                  <Input
                    id="setup-invite-email"
                    type="email"
                    value={email}
                    autoComplete="off"
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setInviteError(null);
                    }}
                    disabled={blocked || locked || inviting}
                    aria-describedby={inviteError ? "setup-invite-email-error" : undefined}
                  />
                  {inviteError ? <FormHelperText id="setup-invite-email-error">{inviteError}</FormHelperText> : null}
                </FormControl>
                <FormControl className="outlined w-full sm:w-48 sm:flex-none" variant="standard">
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
                <Button
                  variant="outlined"
                  onClick={() => void invite()}
                  disabled={blocked || locked || inviting || !email.trim()}
                  className="sm:flex-none"
                >
                  {inviting ? t("saving") : t("setup-team-invite")}
                </Button>
              </Box>
              {invited.map((entry) => {
                const doneKey = INVITE_DONE_KEY[entry.byEmail ? "email" : "link"];
                return (
                  <Box role="status" key={entry.email}>
                    <StateLine
                      tone="done"
                      action={
                        entry.link ? (
                          <CopyButton text={entry.link} label={t("setup-team-invite-link-label")} />
                        ) : undefined
                      }
                    >
                      {t(doneKey, { email: entry.email })}
                    </StateLine>
                  </Box>
                );
              })}
            </Box>
          ) : null}

          <SetupQuestion id="setup-team-controladoria" text={t("setup-operation-work-controladoria")}>
            <YesNo
              label={t("setup-operation-work-controladoria")}
              value={operationStep.works.controladoria}
              onChange={(value) => operationStep.setWork("controladoria", value)}
              disabled={blocked}
            />
          </SetupQuestion>

          {teamError ? (
            <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
              {teamError}
            </Alert>
          ) : null}
        </Box>
      ),
    },
    {
      label: t("setup-step-label-filing"),
      done: !onePrepares || !filingStep.owed,
      title: t("setup-filing-title"),
      hint: t("setup-filing-hint"),
      content: (
        <Box className="flex flex-col gap-5">
          <Box className="bg-grey-25 rounded-xl px-4 py-3">
            <SetupQuestion id="setup-filing-one-prepares" text={t("setup-operation-work-one_filing")}>
              <YesNo
                label={t("setup-operation-work-one_filing")}
                value={operationStep.works.one_filing}
                onChange={(value) => operationStep.setWork("one_filing", value)}
                disabled={blocked}
              />
            </SetupQuestion>
          </Box>
          {onePrepares ? filingStep.content : <StateLine tone="info">{t("setup-filing-without-one")}</StateLine>}
        </Box>
      ),
      canAdvance: filingStep.canAdvance,
      onPrimary: saveFiling,
      onLeave: saveFiling,
      // Set aside on purpose: the list on the home leads back to it.
      secondary: onePrepares && filingStep.owed && !blocked ? notNow("personalidade") : undefined,
    },
    {
      label: t("setup-step-label-personality"),
      title: t("setup-personality-title"),
      hint: t("setup-personality-hint"),
      ...personalityStep,
      secondary: personalityStep.skippable && !blocked ? notNow("areas") : undefined,
    },
    {
      label: t("setup-step-label-areas"),
      title: t("setup-areas-title"),
      hint: t("setup-areas-hint"),
      ...areasStep,
      secondary: areasStep.skippable && !blocked ? notNow("canal") : undefined,
    },
    {
      label: t("setup-step-label-channel"),
      done: Boolean(realNumber),
      title: t("setup-channel-title"),
      hint: t("setup-channel-hint"),
      canAdvance: !blocked,
      primaryLabel: next ? t("setup-finish-next", { module: next.name }) : t("setup-finish"),
      onPrimary: () => finish(next?.href ?? "/inicio"),
      busy: leaving,
      content: (
        <Box className="flex flex-col gap-6">
          <Box component="section" aria-labelledby="setup-channel-whatsapp" className="flex flex-col gap-3">
            <SectionTitle
              id="setup-channel-whatsapp"
              title={t("setup-channel-whatsapp-title")}
              description={t("setup-channel-whatsapp-info")}
              as="h3"
              variant="subtitle1"
            />
            {(!state.operationAnswered || !approvedProfile) && !realNumber ? (
              <StateLine tone="info">{t("setup-channel-before-operation")}</StateLine>
            ) : null}
            {!connections ? (
              connectionsError
            ) : realNumber ? (
              <>
                <StateLine tone="done">{t("setup-channel-whatsapp-done")}</StateLine>
                <NoticesCard embedded notices={connections.notices} blocked={blocked || locked} onChanged={refresh} />
              </>
            ) : (
              <>
                {connections.testChat?.state.on ? (
                  // The test chat is offered no longer (2026-11-11): one already on stays, to be turned off.
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
                  openWaPending={connections.openWaPending}
                />
              </>
            )}
          </Box>

          <Box component="section" aria-labelledby="setup-channel-sign" className="flex flex-col gap-3">
            <SectionTitle
              id="setup-channel-sign"
              title={t("setup-papers-sign-title")}
              description={t("setup-channel-sign-info")}
              as="h3"
              variant="subtitle1"
            />
            <StateLine tone="done">{t("setup-channel-sign-govbr")}</StateLine>
            {!connections ? (
              connectionsError
            ) : connections.signature || signOpen ? (
              <SignatureAccountCard
                embedded
                account={connections.signature}
                blocked={blocked || locked}
                vault={connections.environment.vault}
                onChanged={refresh}
              />
            ) : (
              // The account of signatures is the firm's option: its form opens when asked, never in the way.
              <StateLine
                tone="info"
                action={
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setSignOpen(true)}
                    disabled={blocked || locked}
                  >
                    {t("setup-channel-sign-connect")}
                  </Button>
                }
              >
                {t("setup-channel-sign-account")}
              </StateLine>
            )}
          </Box>

          {next ? <StateLine tone="info">{t("setup-next-module", { module: next.name })}</StateLine> : null}
          {finishProblem}
        </Box>
      ),
    },
  ];

  // "Continuar depois": what the step holds and is complete is saved first, then the firm goes home.
  const later = async () => {
    const step = steps[stepIndex];
    if (step?.onLeave) await Promise.resolve(step.onLeave()).catch(() => false);
    await finish("/inicio");
  };

  return (
    <Box className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title={t("setup-page-title")}
        description={t("setup-page-description")}
        crumbs={[{ label: t("settings-home"), href: "/inicio" }, { label: t("setup-crumb") }]}
        action={
          <Button variant="text" color="grey" disabled={leaving || blocked} onClick={() => void later()}>
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
      {paperForm ? (
        <TemplatePanel
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
          // Closed while ONE works, the panel says that this step shows the model once it is ready.
          waitsIn="setup"
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
