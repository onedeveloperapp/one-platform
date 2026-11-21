"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Box, Button, TextField, Typography } from "@mui/material";

import FactGrid, { type Fact } from "@/components/product/fact-grid";
import MessageBubble from "@/components/product/message-bubble";
import SectionTitle from "@/components/product/section-title";
import type { WizardStep } from "@/components/product/setup-wizard";
import StateLine from "@/components/product/state-line";
import type { FirmProfile } from "@/lib/firm/personality";
import {
  approveFirmPersonality,
  type PersonalityState,
  readFirmPersonality,
  requestFirmPersonality,
} from "@/lib/firm/personality-actions";

/** How often the step looks again while ONE writes. */
const WATCH_MS = 4000;

/**
 * The setup's step "Personalidade" (migration 0272, the plan "o escritório preparado antes do primeiro atendimento",
 * phase 3): ONE writes the firm's profile by itself from what the setup collected, and the person reads it with three
 * messages written with it, then approves it or says in their own words what to change (and, once, the address of the
 * firm's site for ONE to read). ONE answers somebody new only once a profile is approved (decision 2).
 */
export function usePersonalityStep(input: {
  initial: PersonalityState | null;
  blocked: boolean;
  onApproved: () => void;
}): Pick<WizardStep, "content" | "canAdvance" | "onPrimary" | "primaryLabel"> {
  const t = useTranslations("product");
  const [state, setState] = useState<PersonalityState | null>(input.initial);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [change, setChange] = useState("");
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  const writing = state?.writing && state.writing.status !== "failed";
  const shown = state?.draft ?? state?.approved ?? null;

  // ONE writes by itself the first time: nothing for the person to do but wait for it.
  useEffect(() => {
    if (asked.current || input.blocked || !state || state.draft || state.approved || state.writing) return;
    asked.current = true;
    void requestFirmPersonality({}).then((done) => {
      if (done.ok)
        setState((current) => (current ? { ...current, writing: { status: "waiting", failure: null } } : current));
    });
  }, [state, input.blocked]);

  // While ONE writes, the step looks again by itself.
  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void readFirmPersonality()
        .then((read) => {
          if (read) setState(read);
        })
        .catch(() => undefined);
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [writing]);

  const ask = async () => {
    setError(null);
    setBusy(true);
    const done = await requestFirmPersonality({ change: change.trim() || null, site: site.trim() || null }).catch(
      () => ({ ok: false as const, code: "failed" }),
    );
    setBusy(false);
    if (!done.ok) {
      setError(
        done.code === "invalid_site"
          ? t("setup-personality-error-site")
          : done.code === "second_factor_required"
            ? t("setup-operation-error-second_factor")
            : t("setup-operation-error-failed"),
      );
      return;
    }
    setChanging(false);
    setChange("");
    setState((current) => (current ? { ...current, writing: { status: "waiting", failure: null } } : current));
  };

  const onPrimary = async (): Promise<boolean> => {
    const draft = state?.draft;
    if (!draft) return true;
    setError(null);
    const done = await approveFirmPersonality(draft.id).catch(() => ({ ok: false as const, code: "failed" }));
    if (!done.ok) {
      setError(
        done.code === "second_factor_required"
          ? t("setup-operation-error-second_factor")
          : t("setup-operation-error-failed"),
      );
      return false;
    }
    input.onApproved();
    return true;
  };

  const factsOf = (profile: FirmProfile): Fact[] => {
    const facts: (Fact | null)[] = [
      {
        key: "treatment",
        label: t("setup-personality-treatment"),
        value: t(`setup-personality-treatment-${profile.tratamento}`),
      },
      { key: "tone", label: t("setup-personality-tone"), value: t(`setup-personality-tone-${profile.tom}`) },
      { key: "length", label: t("setup-personality-length"), value: t(`setup-personality-length-${profile.tamanho}`) },
      profile.apresentacao.sobre
        ? { key: "about", label: t("setup-personality-about"), value: profile.apresentacao.sobre, wide: true }
        : null,
      profile.fora_do_horario
        ? { key: "hours", label: t("setup-personality-out-of-hours"), value: profile.fora_do_horario, wide: true }
        : null,
      profile.evitar.length > 0
        ? { key: "avoid", label: t("setup-personality-avoid"), value: profile.evitar.join(" · "), wide: true }
        : null,
    ];
    return facts.filter((fact): fact is Fact => fact !== null);
  };

  const content = (
    <Box className="flex flex-col gap-5">
      {writing ? (
        <StateLine tone="waiting">{t("setup-personality-writing")}</StateLine>
      ) : state?.writing?.status === "failed" && !shown ? (
        <StateLine
          tone="failed"
          action={
            <Button variant="outlined" size="small" onClick={() => void ask()} disabled={input.blocked || busy}>
              {t("setup-personality-retry")}
            </Button>
          }
        >
          {t("setup-personality-failed")}
        </StateLine>
      ) : state?.draft ? (
        <StateLine tone="attention">{t("setup-personality-check")}</StateLine>
      ) : state?.approved ? (
        <StateLine tone="done">{t("setup-personality-approved")}</StateLine>
      ) : null}

      {shown ? (
        <>
          <Box component="section" className="flex flex-col gap-3" aria-labelledby="setup-personality-profile">
            <SectionTitle
              id="setup-personality-profile"
              title={t("setup-personality-profile-title")}
              description={t("setup-personality-profile-info")}
              as="h3"
              variant="subtitle1"
            />
            <FactGrid facts={factsOf(shown.profile)} />
            {shown.profile.areas.length > 0 ? (
              <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                {shown.profile.areas.map((area) => (
                  <Box component="li" key={area.area} className="flex flex-col gap-0.5">
                    <Typography variant="subtitle2" component="span">
                      {area.area}
                    </Typography>
                    {area.aceita ? (
                      <Typography variant="body2" component="span" className="text-text-secondary">
                        {t("setup-personality-accepts", { text: area.aceita })}
                      </Typography>
                    ) : null}
                    {area.nao_aceita ? (
                      <Typography variant="body2" component="span" className="text-text-secondary">
                        {t("setup-personality-declines", { text: area.nao_aceita })}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>

          <Box component="section" className="flex flex-col gap-3" aria-labelledby="setup-personality-examples">
            <SectionTitle
              id="setup-personality-examples"
              title={t("setup-personality-examples-title")}
              description={t("setup-personality-examples-info")}
              as="h3"
              variant="subtitle1"
            />
            <Box component="ol" className="m-0 flex list-none flex-col gap-3 p-0">
              {shown.examples.map((example) => (
                <MessageBubble
                  key={example.situacao}
                  side="out"
                  sideLabel={t("setup-personality-example-said")}
                  note={example.situacao}
                >
                  {example.mensagem}
                </MessageBubble>
              ))}
            </Box>
          </Box>
        </>
      ) : null}

      {shown && !writing ? (
        changing ? (
          <Box className="flex flex-col gap-3">
            <TextField
              id="setup-personality-change"
              label={t("setup-personality-change-label")}
              value={change}
              onChange={(event) => setChange(event.target.value)}
              multiline
              minRows={3}
              variant="standard"
              className="outlined"
              helperText={t("setup-personality-change-help")}
              disabled={input.blocked || busy}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
            />
            {!state?.site?.read ? (
              <TextField
                id="setup-personality-site"
                label={t("setup-personality-site-label")}
                value={site}
                onChange={(event) => setSite(event.target.value)}
                variant="standard"
                className="outlined"
                helperText={t("setup-personality-site-help")}
                disabled={input.blocked || busy}
                slotProps={{ htmlInput: { maxLength: 300, inputMode: "url" } }}
              />
            ) : null}
            <Box className="flex flex-wrap gap-2">
              <Button
                variant="outlined"
                onClick={() => void ask()}
                disabled={input.blocked || busy || (!change.trim() && !site.trim())}
              >
                {t("setup-personality-rewrite")}
              </Button>
              <Button variant="text" onClick={() => setChanging(false)} disabled={busy}>
                {t("setup-personality-cancel")}
              </Button>
            </Box>
          </Box>
        ) : (
          <Box>
            <Button variant="text" onClick={() => setChanging(true)} disabled={input.blocked}>
              {t("setup-personality-ask-change")}
            </Button>
          </Box>
        )
      ) : null}

      {error ? <StateLine tone="failed">{error}</StateLine> : null}
    </Box>
  );

  return {
    content,
    canAdvance: !input.blocked,
    onPrimary,
    primaryLabel: state?.draft ? t("setup-personality-approve") : undefined,
  };
}
