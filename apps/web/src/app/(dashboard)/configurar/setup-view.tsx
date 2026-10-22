"use client";

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

import PageHeader from "@/components/product/page-header";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import type { SecondFactorState } from "@/lib/ai/approvals";
import { addOabRegistration, answerFirmSetup, inviteToFirm } from "@/lib/firm/actions";
import { autonomyErrorKey } from "@/lib/firm/autonomy";
import { setFirmSigner } from "@/lib/firm/autonomy-actions";
import { FIRM_FUNCTIONS, type FirmFunction, formatOab, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";

export type SetupState =
  | { kind: "unavailable" }
  | { kind: "error" }
  /** The questions are who manages the firm's to answer. */
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
    };

/** Digits and, in the sections that use one, the letter at the end: what the bar writes. */
const NUMBER_PATTERN = /^[0-9]{1,7}[A-Za-z]?$/;
const cleanNumber = (value: string) => value.replace(/[^0-9A-Za-z]/g, "");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The first questions of a firm, one per screen: who answers and whether they
 * sign what ONE prepares, whether the firm works alone, and the channel to the
 * clients. Each step saves what it asks before the next one opens, so leaving
 * half way keeps what was answered; "Fazer depois" sets the questions aside
 * for good, and the list on the home keeps what is still missing.
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

  const lawyer = state.firmFunction === "socio" || state.firmFunction === "advogado";
  const partner = state.firmFunction === "socio";
  const registered = state.registrations.length > 0;

  // ---------- Who answers, at the bar ----------
  const [uf, setUf] = useState("");
  const [number, setNumber] = useState("");
  const [touched, setTouched] = useState(false);
  const [signs, setSigns] = useState(partner ? true : state.signs);
  const [oabError, setOabError] = useState<string | null>(null);
  const numberOk = NUMBER_PATTERN.test(cleanNumber(number));
  const oabReady = !lawyer || registered || (Boolean(uf) && numberOk);

  // ---------- Alone or with a team ----------
  const [worksAlone, setWorksAlone] = useState<boolean | null>(state.worksAlone);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteFunction, setInviteFunction] = useState<FirmFunction>("advogado");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState<{ email: string; link: string | null }[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // ---------- The end ----------
  const [finishError, setFinishError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const blocked = state.supportVisit;

  // A flow left half way opens where the person stopped; one answered before opens at its start.
  const firstOpen = (lawyer && !registered) || (partner && !state.signs) ? 0 : state.worksAlone === null ? 1 : 2;
  const [stepIndex, setStepIndex] = useState(state.answered ? 0 : firstOpen);

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
    if (partner && signs !== state.signs) {
      const chosen = await setFirmSigner(state.userId, signs);
      if (!chosen.ok) {
        setOabError(t(autonomyErrorKey(chosen.code)));
        return false;
      }
    }
    router.refresh();
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

  /** The questions are answered, or set aside: the firm goes on to its home, or to where the person chose. */
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
                    disabled={blocked || state.secondFactor !== "ok"}
                  />
                }
                label={t("setup-oab-signs")}
              />
              <Typography variant="body2" className="text-text-secondary">
                {t("setup-oab-signs-help")}
              </Typography>
              {state.secondFactor !== "ok" ? (
                <Alert
                  severity="warning"
                  className="neutral bg-background-paper/60! mt-2"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      href={
                        state.secondFactor === "challenge" ? "/auth/two-factor?next=/configurar" : "/settings/security"
                      }
                    >
                      {t("setup-second-factor-action")}
                    </Button>
                  }
                >
                  {t("setup-second-factor")}
                </Alert>
              ) : null}
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
                      disabled={blocked || inviting}
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
                      disabled={blocked || inviting}
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
                <Button variant="outlined" color="grey" onClick={() => void invite()} disabled={blocked || inviting}>
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
      title: t("setup-channel-title"),
      hint: t("setup-channel-hint"),
      canAdvance: !blocked,
      primaryLabel: t("setup-finish"),
      onPrimary: () => finish("/inicio"),
      busy: leaving,
      content: (
        <Box className="flex flex-col gap-4">
          {state.whatsapp ? (
            <Alert severity="success" className="neutral bg-background-paper/60!">
              {t("setup-channel-whatsapp-done")}
            </Alert>
          ) : (
            <Box className="flex flex-col items-start gap-2">
              <Typography variant="body1">{t("setup-channel-whatsapp-help")}</Typography>
              <Button
                variant="outlined"
                color="grey"
                disabled={blocked || leaving}
                onClick={() => void finish("/settings/connections")}
              >
                {t("setup-channel-whatsapp")}
              </Button>
            </Box>
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
    </Box>
  );
}
