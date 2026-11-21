"use client";

import { teamErrorKey } from "../settings/team/team-types";
import SetupCpf, { declareSetupCpf } from "./setup-cpf";
import { useFilingStep } from "./setup-filing";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Grid,
  Input,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";

import { PhoneField } from "@/components/product/fields";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import type { SecondFactorState } from "@/lib/ai/approvals";
import { type FilingWaysData, personFilingStep } from "@/lib/filing-ways/ways";
import { addOabRegistration } from "@/lib/firm/actions";
import { personFlowKey, personSetupOpening, type PersonSetupStep, personSetupSteps } from "@/lib/firm/person-setup";
import { type FirmFunction, formatOab, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";
import { saveMyWhatsapp } from "@/lib/firm/whatsapp-actions";
import { enterAfterSessionChange } from "@/lib/safe-next";
import { createClient } from "@flyee/auth/client";
import { isValidPhoneBr, onlyDigits } from "@flyee/fields";
import { completeFlow } from "@flyee/onboarding";

/** What a person's own setup shows (2026-11-03), read under their session by `person-setup-state.ts`. */
export type PersonSetupState =
  | { kind: "unavailable" }
  | { kind: "error" }
  | {
      kind: "ready";
      userId: string;
      orgId: string;
      firmName: string;
      firmFunction: FirmFunction;
      /** The person's registrations at the bar. */
      registrations: OabRegistration[];
      /** Their CPF for the signature in the cloud is asked: a provider can be used here and they declared none. */
      asksCpf: boolean;
      /** Their own WhatsApp, the digits with the country's 55; null while they gave none (it is required). */
      whatsapp: string | null;
      /** How they file on the courts' screens, the firm's way included (0263); null when it could not be read. */
      filing: FilingWaysData | null;
      /** The states of the firm's lawyers' registrations, whose courts a partner choosing the firm's way sees. */
      firmStates: string[];
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      /** The step the address asked for (`?passo=`). */
      step: PersonSetupStep | null;
    };

/** Why a WhatsApp was refused, in the words the step says it. */
const WHATSAPP_ERROR: Record<string, string> = {
  firm_number: "person-setup-whatsapp-error-firm",
  member_number: "person-setup-whatsapp-error-member",
  invalid_phone: "person-setup-whatsapp-error-invalid",
};

/** A WhatsApp as the field shows it: the number without the country's 55. */
const localPhone = (digits: string | null): string => (digits?.startsWith("55") ? digits.slice(2) : (digits ?? ""));

/** Digits and, in the sections that use one, the letter at the end: what the bar writes. */
const NUMBER_PATTERN = /^[0-9]{1,7}[A-Za-z]?$/;
const cleanNumber = (value: string) => value.replace(/[^0-9A-Za-z]/g, "");

/**
 * What a person who joins a firm leaves ready for their own work, one decision per screen: the second factor first,
 * which approving what the AI prepared and deciding for the firm ask for, then their own WhatsApp, required (by it
 * ONE links them to a hearing, sends its guide and knows their report, the owner, 2026-11-14), then, for a partner or
 * a lawyer, their registration at the bar, by which ONE reads their publications in the DJEN. It opens on the home while something
 * of it is owed and the person never answered it (a lawyer dropped on the home met the factor half way and had
 * their publications unread, 2026-11-03), and at `/configurar` for anybody who does not manage the firm. Nothing
 * on it leads away; "Fazer depois" sets it aside on purpose.
 */
export default function PersonSetupView({ state }: { state: PersonSetupState }) {
  const t = useTranslations("product");
  if (state.kind !== "ready") {
    return (
      <Box className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PageHeader title={t("person-setup-title")} crumbs={[{ label: t("person-setup-crumb") }]} />
        <Alert severity={state.kind === "error" ? "error" : "info"} className="neutral bg-background-paper/60!">
          {state.kind === "error" ? t("person-setup-error") : t("person-setup-unavailable")}
        </Alert>
      </Box>
    );
  }
  return <PersonSetupFlow state={state} />;
}

function PersonSetupFlow({ state }: { state: Extract<PersonSetupState, { kind: "ready" }> }) {
  const t = useTranslations("product");
  const blocked = state.supportVisit;
  const registered = state.registrations.length > 0;

  // ---------- The second factor ----------
  const [confirmedHere, setConfirmedHere] = useState(false);
  const factor: SecondFactorState = confirmedHere ? "ok" : state.secondFactor;
  const factorOk = factor === "ok";

  // ---------- The registration at the bar ----------
  const [uf, setUf] = useState("");
  const [number, setNumber] = useState("");
  const [touched, setTouched] = useState(false);
  const [oabError, setOabError] = useState<string | null>(null);
  // The state of the registration given in this setup, before the page reads it again.
  const [addedUf, setAddedUf] = useState<string | null>(null);

  // ---------- How they file on the courts' screens (0263) ----------
  // The courts of their states, the one being registered included, where the firm's way offers them a way to choose;
  // a partner who decides for a firm that chose none chooses the firm's first (the owner's three ways, 2026-11-20).
  const savedStates = [...state.registrations.map((registration) => registration.uf), ...(addedUf ? [addedUf] : [])];
  const myStates = Array.from(new Set([...savedStates, ...(!registered && !addedUf && uf ? [uf] : [])]));
  const filingAsked = state.filing ? personFilingStep(state.filing, myStates) : { shown: false, owed: false };
  const firmForm = Boolean(state.filing?.decidesForFirm && state.filing.firmWay === null);
  const filingStep = useFilingStep({
    filing: state.filing,
    firmForm,
    firmStates: Array.from(new Set([...state.firmStates, ...myStates])),
    myStates,
    blocked,
    onSaved: () => undefined,
  });

  const keys = personSetupSteps(state.firmFunction, filingAsked.shown);
  const opening = personSetupOpening({
    factorOk: state.secondFactor === "ok",
    asked: state.step,
    firmFunction: state.firmFunction,
    files: filingAsked.shown,
  });
  const [stepIndex, setStepIndex] = useState(Math.max(0, keys.indexOf(opening.open)));
  const onFactor = () => {
    setConfirmedHere(true);
    if (opening.afterFactor) setStepIndex(Math.max(0, keys.indexOf(opening.afterFactor)));
  };

  // ---------- Their WhatsApp ----------
  const [phone, setPhone] = useState(localPhone(state.whatsapp));
  const [savedPhone, setSavedPhone] = useState(state.whatsapp);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const phoneOk = isValidPhoneBr(phone);
  /** Required: until a WhatsApp is kept, the setup is not set aside. */
  const whatsappMissing = !savedPhone;

  const saveWhatsapp = async (): Promise<boolean> => {
    setPhoneError(null);
    setPhoneTouched(true);
    if (!phoneOk) return false;
    const digits = onlyDigits(phone);
    if (savedPhone && localPhone(savedPhone) === digits) return true;
    const saved = await saveMyWhatsapp(digits).catch(() => ({ ok: false as const, code: "failed" }));
    if (!saved.ok) {
      setPhoneError(t(WHATSAPP_ERROR[saved.code] ?? "person-setup-whatsapp-error"));
      return false;
    }
    setSavedPhone(`55${digits}`);
    return true;
  };

  const numberOk = NUMBER_PATTERN.test(cleanNumber(number));
  // The CPF for the signature in the cloud, optional: what is typed goes only whole and checked, and one that is not
  // is said under the field when the step goes on.
  const [cpf, setCpf] = useState("");
  const [cpfError, setCpfError] = useState<string | null>(null);
  const oabReady = registered || (Boolean(uf) && numberOk);

  // ---------- The end ----------
  const [leaving, setLeaving] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  /** The setup is answered, or set aside, and the home is loaded anew: the gate and the menu read the factor. */
  const finish = async (): Promise<boolean> => {
    setFinishError(null);
    setLeaving(true);
    const done = await completeFlow(createClient(), personFlowKey(state.userId, state.orgId)).catch(() => ({
      ok: false as const,
    }));
    if (!done.ok) {
      setLeaving(false);
      setFinishError(t("person-setup-finish-error"));
      return false;
    }
    await enterAfterSessionChange("/inicio");
    return true;
  };

  const saveOab = async (): Promise<boolean> => {
    setOabError(null);
    if (!registered) {
      setTouched(true);
      if (!uf || !numberOk) return false;
      const added = await addOabRegistration({ uf, number: cleanNumber(number), kind: "principal" }).catch(() => ({
        ok: false as const,
        code: "failed",
      }));
      if (!added.ok) {
        setOabError(t(teamErrorKey(added.code)));
        return false;
      }
      setAddedUf(uf);
    }
    if (state.asksCpf) {
      setCpfError(null);
      const refused = await declareSetupCpf(cpf);
      if (refused) {
        setCpfError(t(refused));
        return false;
      }
    }
    return true;
  };

  const finishProblem = finishError ? (
    <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
      {finishError}
    </Alert>
  ) : null;

  const factorStep: WizardStep = {
    title: t("setup-factor-title"),
    hint: factor === "challenge" ? t("setup-factor-challenge") : t("person-setup-factor-hint"),
    canAdvance: factorOk && !blocked,
    hidePrimary: !factorOk && !blocked,
    content: (
      <Box className="flex flex-col gap-4">
        {factorOk ? (
          <Alert severity="success" className="neutral bg-background-paper/60!">
            {t("setup-factor-done")}
          </Alert>
        ) : blocked ? null : (
          <SecondFactorPrompt state={factor} onConfirmed={onFactor} />
        )}
      </Box>
    ),
  };

  // Who does not sign at the bar ends on their WhatsApp.
  const whatsappLast = keys[keys.length - 1] === "whatsapp";
  const whatsappStep: WizardStep = {
    title: t("person-setup-whatsapp-title"),
    hint: t("person-setup-whatsapp-hint"),
    canAdvance: phoneOk && !blocked && !leaving,
    ...(whatsappLast
      ? {
          primaryLabel: t("setup-finish"),
          busy: leaving,
          onPrimary: async () => (await saveWhatsapp()) && (await finish()),
        }
      : { onPrimary: saveWhatsapp }),
    content: (
      <Box className="flex flex-col gap-4">
        <PhoneField
          id="person-setup-whatsapp"
          label={t("person-setup-whatsapp-label")}
          value={phone}
          disabled={blocked}
          onChange={(event) => {
            setPhone(event.target.value);
            setPhoneError(null);
          }}
          onBlur={() => setPhoneTouched(true)}
          error={Boolean(phoneError) || (phoneTouched && phone.length > 0 && !phoneOk)}
          helperText={
            phoneError ??
            (phoneTouched && phone.length > 0 && !phoneOk
              ? t("person-setup-whatsapp-error-invalid")
              : t("person-setup-whatsapp-help"))
          }
          className="max-w-sm"
        />
        {whatsappLast ? finishProblem : null}
      </Box>
    ),
  };

  // The registration ends the setup, unless how they file follows it. Set aside, the state chosen and not registered
  // names no court of theirs: the filing follows only for what was saved.
  const oabLast = keys[keys.length - 1] === "oab";
  const skipOab = () => {
    setUf("");
    if (state.filing && personFilingStep(state.filing, savedStates).shown) setStepIndex(keys.length - 1);
    else void finish();
  };
  const oabStep: WizardStep = {
    title: t("person-setup-oab-title"),
    hint: t("person-setup-oab-hint"),
    canAdvance: oabReady && !blocked && !leaving,
    ...(oabLast
      ? {
          primaryLabel: t("setup-finish"),
          busy: leaving,
          onPrimary: async () => (await saveOab()) && (await finish()),
        }
      : { onPrimary: saveOab }),
    secondary: !registered && !blocked ? { label: t("setup-not-now"), onClick: skipOab } : undefined,
    content: (
      <Box className="flex flex-col gap-4">
        {registered ? (
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
                <FormLabel component="label" htmlFor="person-oab-uf" id="person-oab-uf-label">
                  {t("team-oab-uf")}
                </FormLabel>
                <Select
                  id="person-oab-uf-select"
                  labelId="person-oab-uf-label"
                  inputProps={{ id: "person-oab-uf" }}
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
                <FormLabel component="label" htmlFor="person-oab-number">
                  {t("team-oab-number")}
                </FormLabel>
                <Input
                  id="person-oab-number"
                  value={number}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(event) => setNumber(event.target.value)}
                  onBlur={() => setTouched(true)}
                  disabled={blocked}
                  aria-describedby="person-oab-number-help"
                />
                <FormHelperText id="person-oab-number-help">
                  {(touched || number.length > 0) && !numberOk
                    ? t("team-error-oab-invalid")
                    : t("team-oab-number-help")}
                </FormHelperText>
              </FormControl>
            </Grid>
          </Grid>
        )}
        <Typography variant="body2" className="text-text-secondary">
          {t("person-setup-oab-signs")}
        </Typography>
        {state.asksCpf ? (
          <SetupCpf
            id="person-setup-cpf"
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
        {oabLast ? finishProblem : null}
      </Box>
    ),
  };

  const filingWizardStep: WizardStep = {
    title: firmForm ? t("setup-filing-title") : t("person-setup-filing-title"),
    hint: firmForm ? t("person-setup-filing-firm-hint") : t("person-setup-filing-hint"),
    canAdvance: filingStep.canAdvance && !leaving,
    primaryLabel: t("setup-finish"),
    busy: leaving,
    onPrimary: async () => (await filingStep.onPrimary()) && (await finish()),
    secondary: filingAsked.owed && !blocked ? { label: t("setup-not-now"), onClick: () => void finish() } : undefined,
    content: (
      <Box className="flex flex-col gap-4">
        {filingStep.content}
        {finishProblem}
      </Box>
    ),
  };

  const steps = keys.map((key) =>
    key === "seguranca" ? factorStep : key === "whatsapp" ? whatsappStep : key === "oab" ? oabStep : filingWizardStep,
  );

  return (
    <Box className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title={t("person-setup-title")}
        description={t("person-setup-description", { firm: state.firmName })}
        // No crumb leads away: the setup is left only by finishing it or setting it aside.
        crumbs={[{ label: state.firmName }, { label: t("person-setup-crumb") }]}
        // The WhatsApp is required: until it is given, the setup is not set aside.
        action={
          !blocked && !whatsappMissing ? (
            <Button variant="text" color="grey" disabled={leaving} onClick={() => void finish()}>
              {t("setup-later")}
            </Button>
          ) : undefined
        }
      />
      {blocked ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("person-setup-support-visit")}
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
