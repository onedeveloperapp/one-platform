"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Grid, Typography } from "@mui/material";

import {
  EMPTY_LAWYER_DRAFT,
  filingErrorKey,
  FIRM_WAY_WORDS,
  firmDraftOf,
  FirmWayFields,
  LawyerWayFields,
  saveFirmChoice,
  saveLawyerChoice,
  WAY_WORDS,
} from "@/components/firm/filing-way-form";
import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import { beginExtensionLink, endCourtLogin, endExtensionLink } from "@/lib/filing-ways/actions";
import {
  type CourtLogin,
  type FilingWaysData,
  firmChoiceAsks,
  lawyerChoiceAsks,
  type ScreenSystem,
  systemsFor,
  wayInForce,
  wayProposed,
  waysOffered,
} from "@/lib/filing-ways/ways";

/**
 * How the lawyer files in each court they sign in (the owner, 2026-11-20; migrations 0263 and 0264): ONE's browser
 * with their login, their extension, or by hand with ONE's guide, the firm's choice marked. The login is typed here
 * and sealed in the same request, never shown again; the extension is linked by a code. The setups ask the same with
 * the same fields (`components/firm/filing-way-form.tsx`, the canvas the owner approved): this card is where it is
 * changed later.
 */
export default function FilingWaysCard({ data, onChanged }: { data: FilingWaysData; onChanged: () => void }) {
  const t = useTranslations("product");
  const systems = systemsFor(data.systems, data.myStates);

  return (
    <Grid size={12}>
      <CollapsibleCard
        id="team-filing-ways"
        title={t("filing-ways-title")}
        description={t("filing-ways-description")}
        defaultOpen
        bodyClassName="gap-6"
      >
        <FirmWay data={data} onChanged={onChanged} />
        {systems.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("filing-ways-none")}
          </Typography>
        ) : (
          systems.map((system) => <SystemWay key={system.key} system={system} data={data} onChanged={onChanged} />)
        )}
      </CollapsibleCard>
    </Grid>
  );
}

/**
 * The firm's way, chosen by who decides for the firm with the firm's acknowledgment of the risk: the most automated
 * way any lawyer of it may choose. Who does not decide for the firm reads it.
 */
function FirmWay({ data, onChanged }: { data: FilingWaysData; onChanged: () => void }) {
  const t = useTranslations("product");
  const [draft, setDraft] = useState(() => firmDraftOf(data.firmWay));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data.decidesForFirm) {
    return data.firmWay ? (
      <StateLine tone="info">{t("filing-ways-firm-chosen", { way: t(FIRM_WAY_WORDS[data.firmWay].label) })}</StateLine>
    ) : (
      <StateLine tone="info">{t("filing-ways-firm-none")}</StateLine>
    );
  }

  const asks = firmChoiceAsks({ way: draft.way, saved: data.firmWay });

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const saved = await saveFirmChoice({ draft, saved: data.firmWay, term: data.terms.firm });
      if (!saved.ok) return setError(t(filingErrorKey(saved.code)));
      setDraft((current) => ({ ...current, aware: false }));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box className="flex flex-col gap-4">
      <SectionTitle
        id="filing-ways-firm"
        title={t("filing-ways-firm-title")}
        as="h3"
        variant="subtitle1"
        chip={data.firmWay ? null : <StatusChip label={t("filing-ways-firm-chip-none")} tone="attention" />}
      />
      <FirmWayFields
        draft={draft}
        saved={data.firmWay}
        term={data.terms.firm}
        onChange={(next) => {
          setDraft(next);
          setError(null);
        }}
        disabled={busy}
      />
      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {asks.save ? (
        <Box className="flex flex-row justify-end">
          <Button variant="contained" onClick={() => void save()} disabled={busy}>
            {busy ? t("saving") : t("filing-ways-save")}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function SystemWay({ system, data, onChanged }: { system: ScreenSystem; data: FilingWaysData; onChanged: () => void }) {
  const t = useTranslations("product");
  const inForce = wayInForce(data, system);
  const saved = data.myWays[system.key];
  const choosable = waysOffered(system, data.firmWay).length > 1;
  const login: CourtLogin | null = data.logins.find((row) => row.system === system.key) ?? null;

  const [draft, setDraft] = useState(EMPTY_LAWYER_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const way = wayProposed(draft.way ?? saved, system, data.firmWay);
  const asks = lawyerChoiceAsks({ way, saved, login, changing: draft.changing });

  async function save() {
    setError(null);
    setSaid(null);
    setBusy(true);
    try {
      const done = await saveLawyerChoice({
        system,
        firmWay: data.firmWay,
        saved,
        draft,
        login,
        term: data.terms.lawyer,
      });
      // The password never stays in the page, whatever the answer.
      setDraft((current) => ({ ...current, password: "" }));
      if (!done.ok) return setError(t(filingErrorKey(done.code)));
      setDraft(EMPTY_LAWYER_DRAFT);
      setSaid(t("filing-ways-saved"));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    setError(null);
    setBusy(true);
    try {
      const begun = await beginExtensionLink();
      if (!begun.ok || !begun.value) return setError(t(filingErrorKey(begun.code)));
      setCode(begun.value);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!data.link) return;
    setBusy(true);
    try {
      const ended = await endExtensionLink(data.link.id);
      if (!ended.ok) return setError(t(filingErrorKey(ended.code)));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // The extension is linked once its way is saved: the code is one the extension types to reach this account.
  const extension =
    saved === "extension" ? (
      data.link ? (
        <StateLine
          tone="done"
          action={
            <Button size="small" variant="text" color="grey" onClick={() => void unlink()} disabled={busy}>
              {t("filing-ways-extension-unlink")}
            </Button>
          }
        >
          {t("filing-ways-extension-linked", { label: data.link.label ?? t("filing-ways-extension-unnamed") })}
        </StateLine>
      ) : code ? (
        <Box className="flex flex-col gap-2">
          <Typography variant="body2">{t("filing-ways-extension-code")}</Typography>
          <Typography
            component="p"
            className="bg-grey-50 font-display self-start rounded-lg px-4 py-2 text-2xl font-bold tracking-widest"
          >
            {code}
          </Typography>
        </Box>
      ) : (
        <StateLine
          tone="attention"
          action={
            <Button size="small" variant="outlined" onClick={() => void link()} disabled={busy}>
              {t("filing-ways-extension-link")}
            </Button>
          }
        >
          {t("filing-ways-extension-not-linked")}
        </StateLine>
      )
    ) : null;

  return (
    <Box className="flex flex-col gap-4">
      <SectionTitle
        id={`filing-ways-${system.key}`}
        title={system.name}
        as="h3"
        variant="subtitle1"
        chip={<StatusChip label={t(WAY_WORDS[inForce].chip)} tone={inForce === "hand" ? "neutral" : "positive"} />}
      />

      {choosable ? (
        <LawyerWayFields
          system={system}
          firmWay={data.firmWay}
          saved={saved}
          draft={draft}
          login={login}
          term={data.terms.lawyer}
          onChange={(next) => {
            setDraft(next);
            setError(null);
            setSaid(null);
          }}
          onRemoveLogin={() => setRemoving(true)}
          extension={extension}
          disabled={busy}
        />
      ) : (
        <Typography variant="body2" className="text-text-secondary">
          {t("filing-ways-hand-note")}
        </Typography>
      )}

      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {said ? (
        <Alert severity="success" className="neutral bg-background-paper/60!" onClose={() => setSaid(null)}>
          {said}
        </Alert>
      ) : null}

      {choosable && asks.save ? (
        <Box className="flex flex-row justify-end">
          <Button variant="contained" onClick={() => void save()} disabled={busy}>
            {busy ? t("saving") : t("filing-ways-save")}
          </Button>
        </Box>
      ) : null}

      {removing && login ? (
        <ConfirmActionDialog
          title={t("filing-ways-remove-title", { system: system.name })}
          consequences={[t("filing-ways-remove-consequence-1"), t("filing-ways-remove-consequence-2")]}
          confirmLabel={t("filing-ways-remove-confirm")}
          tone="warning"
          onConfirm={async () => {
            const ended = await endCourtLogin(login.connectionId);
            if (!ended.ok) return t(filingErrorKey(ended.code));
            onChanged();
            return null;
          }}
          onClose={() => setRemoving(false)}
        />
      ) : null}
    </Box>
  );
}
