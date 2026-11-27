"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import CopyButton from "@/components/product/copy-button";
import InfoHint from "@/components/product/info-hint";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import {
  beginExtensionLink,
  endExtensionLink,
  giveCourtLogin,
  setFirmFilingWay,
  setLawyerFilingWay,
} from "@/lib/filing-ways/actions";
import {
  type CourtLogin,
  type ExtensionLink,
  type FilingTerm,
  firmChoiceAsks,
  lawyerChoiceAsks,
  type ScreenSystem,
  termPoints,
  type Way,
  wayProposed,
  waysOffered,
} from "@/lib/filing-ways/ways";

/**
 * The ways to file on a court's screen as a person chooses them (the owner, 2026-11-20; migrations 0263 and 0264),
 * drawn the same wherever they are chosen: the firm's setup, each lawyer's own setup and "Protocolo nos tribunais"
 * in the person's settings (the canvas the owner approved). The fields are controlled by the screen that holds them,
 * which saves them with its own button (`saveFirmChoice`, `saveLawyerChoice`): a setup with its "Continuar", the
 * settings card with its "Salvar".
 */

/** The words of each way, as the lawyer chooses it for themself. */
export const WAY_WORDS: Record<Way, { label: string; help: string; chip: string }> = {
  browser: { label: "filing-way-browser", help: "filing-way-browser-help", chip: "filing-ways-chip-browser" },
  extension: { label: "filing-way-extension", help: "filing-way-extension-help", chip: "filing-ways-chip-extension" },
  hand: { label: "filing-way-hand", help: "filing-way-hand-help", chip: "filing-ways-chip-hand" },
};

/** The words of each way, as who decides for the firm chooses it for every lawyer of it. */
export const FIRM_WAY_WORDS: Record<Way, { label: string; help: string }> = {
  browser: { label: "filing-ways-firm-way-browser", help: "filing-ways-firm-way-browser-help" },
  extension: { label: "filing-ways-firm-way-extension", help: "filing-ways-firm-way-extension-help" },
  hand: { label: "filing-ways-firm-way-hand", help: "filing-ways-firm-way-hand-help" },
};

const LOGIN_STATE_KEY = { verified: "filing-ways-login-verified", unchecked: "filing-ways-login-unchecked" } as const;
const RISK_KEY = { browser: "filing-ways-risk-browser", extension: "filing-ways-risk-extension" } as const;
const AWARE_KEY = { browser: "filing-ways-aware-browser", extension: "filing-ways-aware-extension" } as const;

const ERROR_KEYS = new Set([
  "second_factor_required",
  "not_allowed_in_support_session",
  "term_not_accepted",
  "beyond_firm_way",
  "way_not_offered",
  "way_not_chosen",
  "vault_not_configured",
  "empty",
  "too_large",
  "invalid_value",
]);

/** The words of a refusal: the code's own when the screens have them, else the general one. */
export const filingErrorKey = (code: string): string =>
  ERROR_KEYS.has(code) ? `filing-ways-error-${code}` : "filing-ways-error";

/** The firm's way being chosen: none marked until the firm chooses (the owner's canvas of 2026-11-24). */
export type FirmWayDraft = { way: Way | null; aware: boolean };

/**
 * A lawyer's choice at a system being made: `way` null follows what is marked (their own saved choice, else the
 * firm's), so a firm's way chosen on the same screen marks it as it changes.
 */
export type LawyerWayDraft = { way: Way | null; user: string; password: string; aware: boolean; changing: boolean };

// A firm that never chose has nothing marked: marking ONE's browser before the choice opened a login, a password and
// two risks the firm had not asked for (2026-11-24).
export const firmDraftOf = (saved: Way | null): FirmWayDraft => ({ way: saved, aware: false });
export const EMPTY_LAWYER_DRAFT: LawyerWayDraft = { way: null, user: "", password: "", aware: false, changing: false };

type Saved = { ok: true } | { ok: false; code: string };

/** Saves the firm's way, by who decides for the firm, with the firm's acknowledgment of an automated one. */
export async function saveFirmChoice(input: {
  draft: FirmWayDraft;
  saved: Way | null;
  term: FilingTerm | null;
}): Promise<Saved> {
  const way = input.draft.way;
  if (way === null) return input.saved ? { ok: true } : { ok: false, code: "way_not_chosen" };
  const asks = firmChoiceAsks({ way, saved: input.saved });
  if (!asks.save) return { ok: true };
  if (asks.aware && !input.draft.aware) return { ok: false, code: "term_not_accepted" };
  const set = await setFirmFilingWay(way, way === "hand" ? null : (input.term?.id ?? null));
  return set.ok ? { ok: true } : { ok: false, code: set.code };
}

/**
 * Saves a lawyer's own way at a system, under the firm's way (the one just saved on the same screen, when it was):
 * the way with the lawyer's acknowledgment of an automated one, then the court login, sealed in the same request.
 * A login refused leaves the way saved, and asking again gives only what is still missing.
 */
export async function saveLawyerChoice(input: {
  system: ScreenSystem;
  firmWay: Way | null;
  saved: Way | undefined;
  draft: LawyerWayDraft;
  login: CourtLogin | null;
  term: FilingTerm | null;
}): Promise<Saved> {
  const way = wayProposed(input.draft.way ?? input.saved, input.system, input.firmWay);
  const asks = lawyerChoiceAsks({ way, saved: input.saved, login: input.login, changing: input.draft.changing });
  if (!asks.save) return { ok: true };
  if (asks.aware && !input.draft.aware) return { ok: false, code: "term_not_accepted" };
  if (asks.login && (!input.draft.user.trim() || !input.draft.password)) return { ok: false, code: "empty" };
  if (way !== input.saved || asks.aware) {
    const set = await setLawyerFilingWay(input.system.key, way, way === "hand" ? null : (input.term?.id ?? null));
    if (!set.ok) return { ok: false, code: set.code };
  }
  if (asks.login) {
    const given = await giveCourtLogin(input.system.key, input.draft.user, input.draft.password);
    if (!given.ok) return { ok: false, code: given.code };
  }
  return { ok: true };
}

/** The full text of an acknowledgment, opened over the screen from the box that asks it. */
function TermDialog({ term, open, onClose }: { term: FilingTerm; open: boolean; onClose: () => void }) {
  const t = useTranslations("product");
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{term.title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" component="div" className="whitespace-pre-line">
          {term.bodyMd.replace(/^- /gm, "· ")}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("filing-ways-term-close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** The box of a risk acknowledged: what is assumed, the box to tick, and the full text one click away. */
function RiskBox({
  title,
  children,
  aware,
  awareLabel,
  onAware,
  term,
  disabled,
}: {
  title?: string;
  children: React.ReactNode;
  aware: boolean;
  awareLabel: string;
  onAware: (aware: boolean) => void;
  term: FilingTerm | null;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const [reading, setReading] = useState(false);
  return (
    <Box className="border-accent-4/30 bg-accent-4/5 flex flex-col gap-2 rounded-lg border p-4">
      {title ? (
        <Box className="flex flex-row items-center gap-2">
          <NiExclamationSquare size="medium" className="text-accent-4" />
          <Typography variant="subtitle2" component="h4">
            {title}
          </Typography>
        </Box>
      ) : null}
      {children}
      <Box className="flex flex-row flex-wrap items-center gap-2">
        <FormControlLabel
          control={<Checkbox checked={aware} onChange={(event) => onAware(event.target.checked)} disabled={disabled} />}
          label={awareLabel}
        />
        {term ? (
          <Button size="small" variant="text" onClick={() => setReading(true)}>
            {t("filing-ways-read-term")}
          </Button>
        ) : null}
      </Box>
      {term ? <TermDialog term={term} open={reading} onClose={() => setReading(false)} /> : null}
    </Box>
  );
}

/**
 * The firm's way, as who decides for the firm chooses it: the most automated way any lawyer of it may choose, with
 * the firm's acknowledgment of the risk under an automated one, the points of the text in force in sight.
 */
export function FirmWayFields({
  draft,
  saved,
  term,
  onChange,
  disabled,
}: {
  draft: FirmWayDraft;
  saved: Way | null;
  term: FilingTerm | null;
  onChange: (draft: FirmWayDraft) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const asks = firmChoiceAsks({ way: draft.way, saved });
  const points = term ? termPoints(term.bodyMd) : [];
  return (
    <Box className="flex flex-col gap-4">
      <RadioGroup
        aria-label={t("filing-ways-firm-title")}
        value={draft.way ?? ""}
        onChange={(event) => onChange({ way: event.target.value as Way, aware: false })}
        className="flex flex-col gap-2"
      >
        {(["browser", "extension", "hand"] as const).map((option) => (
          <FormControlLabel
            key={option}
            value={option}
            disabled={disabled}
            control={<Radio />}
            className="border-grey-100 m-0 items-start rounded-lg border p-3"
            label={
              <Box className="flex flex-col gap-1 pt-1">
                <Typography variant="subtitle2">{t(FIRM_WAY_WORDS[option].label)}</Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t(FIRM_WAY_WORDS[option].help)}
                </Typography>
              </Box>
            }
          />
        ))}
      </RadioGroup>
      {asks.aware ? (
        <RiskBox
          title={t("filing-ways-firm-assumes")}
          aware={draft.aware}
          awareLabel={t("filing-ways-firm-aware")}
          onAware={(aware) => onChange({ ...draft, aware })}
          term={term}
          disabled={disabled}
        >
          {points.length > 0 ? (
            <Box component="ul" className="m-0 flex flex-col gap-1 ps-5">
              {points.map((point) => (
                <Typography key={point} component="li" variant="body2">
                  {point}
                </Typography>
              ))}
            </Box>
          ) : (
            <Typography variant="body2">{t("filing-ways-firm-risk")}</Typography>
          )}
        </RiskBox>
      ) : null}
    </Box>
  );
}

/**
 * A lawyer's own way at a system, under the firm's way: the ways offered with the firm's marked, the court login for
 * ONE's browser (typed here and sealed in the same request, never shown again; a kept one by its hint), what the
 * extension asks (the screen's own: the link where it can be made, a line in a setup) and the lawyer's own
 * acknowledgment of an automated way.
 */
export function LawyerWayFields({
  system,
  firmWay,
  saved,
  draft,
  login,
  term,
  onChange,
  onRemoveLogin,
  extension,
  heading,
  disabled,
}: {
  system: ScreenSystem;
  firmWay: Way | null;
  saved: Way | undefined;
  draft: LawyerWayDraft;
  login: CourtLogin | null;
  term: FilingTerm | null;
  onChange: (draft: LawyerWayDraft) => void;
  /** Takes the kept login out of the vault: only the settings offer it. */
  onRemoveLogin?: () => void;
  /** What the extension asks on this screen, shown while it is the way marked. */
  extension?: React.ReactNode;
  /** The heading over the ways, when the screen gives none of its own. */
  heading?: React.ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const offered = waysOffered(system, firmWay);
  const way = wayProposed(draft.way ?? saved, system, firmWay);
  const asks = lawyerChoiceAsks({ way, saved, login, changing: draft.changing });
  const loginKey = LOGIN_STATE_KEY[login?.state === "verified" ? "verified" : "unchecked"];
  const set = (change: Partial<LawyerWayDraft>) => onChange({ ...draft, ...change });

  return (
    <Box className="flex flex-col gap-4">
      {heading}
      <RadioGroup
        aria-label={t("filing-ways-choose", { system: system.name })}
        value={way}
        onChange={(event) => set({ way: event.target.value as Way, aware: false })}
        className="flex flex-col gap-2"
      >
        {offered.map((option) => (
          <FormControlLabel
            key={option}
            value={option}
            disabled={disabled}
            control={<Radio />}
            className="border-grey-100 m-0 items-start rounded-lg border p-3"
            label={
              <Box className="flex flex-col gap-1 pt-1">
                <Box className="flex flex-row flex-wrap items-center gap-2">
                  <Typography variant="subtitle2">{t(WAY_WORDS[option].label)}</Typography>
                  {option === firmWay ? <StatusChip label={t("filing-ways-firm-choice")} tone="primary" /> : null}
                </Box>
                <Typography variant="body2" className="text-text-secondary">
                  {t(WAY_WORDS[option].help)}
                </Typography>
              </Box>
            }
          />
        ))}
      </RadioGroup>

      {way === "browser" && login && !asks.login ? (
        <StateLine
          tone={login.state === "verified" ? "done" : "waiting"}
          action={
            <Box className="flex flex-row flex-wrap gap-1">
              <Button size="small" variant="text" onClick={() => set({ changing: true })} disabled={disabled}>
                {t("filing-ways-change-password")}
              </Button>
              {onRemoveLogin ? (
                <Button size="small" variant="text" color="grey" onClick={onRemoveLogin} disabled={disabled}>
                  {t("filing-ways-remove-login")}
                </Button>
              ) : null}
            </Box>
          }
        >
          {t(loginKey, { hint: login.hint ?? "" })}
        </StateLine>
      ) : null}

      {way === "browser" && login && (login.state === "refused" || login.state === "blocked") ? (
        <StateLine tone="failed">{t(`filing-ways-login-${login.state}`)}</StateLine>
      ) : null}

      {asks.login ? (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, sm: 6 }}>
            {/* The outlined field keeps its label in sight: a standard one drew an empty box with no name. */}
            <TextField
              fullWidth
              size="small"
              label={t("filing-ways-login")}
              helperText={t("filing-ways-login-help")}
              value={draft.user}
              onChange={(event) => set({ user: event.target.value })}
              autoComplete="off"
              disabled={disabled}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              size="small"
              type="password"
              label={t("filing-ways-password")}
              helperText={t("filing-ways-password-help")}
              value={draft.password}
              onChange={(event) => set({ password: event.target.value })}
              autoComplete="new-password"
              disabled={disabled}
            />
          </Grid>
        </Grid>
      ) : null}

      {way === "hand" ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("filing-ways-hand-note")}
        </Typography>
      ) : null}

      {asks.aware && way !== "hand" ? (
        <RiskBox
          aware={draft.aware}
          awareLabel={t(AWARE_KEY[way])}
          onAware={(aware) => set({ aware })}
          term={term}
          disabled={disabled}
        >
          <Typography variant="body2">{t(RISK_KEY[way], { system: system.name })}</Typography>
          {system.ruleNote ? (
            <Typography variant="body2" className="text-text-secondary">
              {system.ruleNote}
            </Typography>
          ) : null}
        </RiskBox>
      ) : null}

      {/* After the acknowledgment it may need: linking saves the choice first. */}
      {way === "extension" ? extension : null}
    </Box>
  );
}

/**
 * A lawyer's own way at each system, one line per court (the owner's canvas of 2026-11-24, where three courts drew
 * the three ways three times over, 620 words): the way in a list with the firm's marked, the court login only on the
 * line where ONE files with it, one acknowledgment for every court of ONE's browser and one for every court of the
 * extension, naming them, and the extension's link once, while some line chose it. The same drafts and saves as
 * `LawyerWayFields`, which the settings and the case keep.
 */
export function LawyerWayRows({
  systems,
  firmWay,
  saved,
  drafts,
  logins,
  term,
  onChange,
  extension,
  disabled,
}: {
  systems: ScreenSystem[];
  firmWay: Way | null;
  saved: Record<string, Way>;
  drafts: Record<string, LawyerWayDraft>;
  logins: CourtLogin[];
  term: FilingTerm | null;
  onChange: (key: string, draft: LawyerWayDraft) => void;
  /** What linking the extension asks on this screen, shown once while a line chose it. */
  extension?: React.ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const draftOf = (key: string) => drafts[key] ?? EMPTY_LAWYER_DRAFT;
  const rows = systems.map((system) => {
    const draft = draftOf(system.key);
    const login = logins.find((row) => row.system === system.key) ?? null;
    const way = wayProposed(draft.way ?? saved[system.key], system, firmWay);
    const asks = lawyerChoiceAsks({ way, saved: saved[system.key], login, changing: draft.changing });
    return { system, draft, login, way, asks };
  });
  const names = (list: typeof rows) =>
    new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(list.map((row) => row.system.name));
  const acknowledged = (way: "browser" | "extension") => rows.filter((row) => row.way === way && row.asks.aware);
  const browserAsks = acknowledged("browser");
  const extensionAsks = acknowledged("extension");
  const setAware = (list: typeof rows, aware: boolean) => {
    for (const row of list) onChange(row.system.key, { ...row.draft, aware });
  };

  return (
    <Box className="flex flex-col gap-4">
      <Box component="ul" className="border-grey-100 m-0 flex list-none flex-col rounded-xl border p-0">
        {rows.map(({ system, draft, login, way, asks }) => {
          const offered = waysOffered(system, firmWay);
          const set = (change: Partial<LawyerWayDraft>) => onChange(system.key, { ...draft, ...change });
          const loginKey = LOGIN_STATE_KEY[login?.state === "verified" ? "verified" : "unchecked"];
          return (
            <Box
              component="li"
              key={system.key}
              className="border-grey-100 flex flex-col gap-3 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-start"
            >
              <Typography variant="subtitle2" component="h4" className="mb-0 sm:w-40 sm:flex-none sm:pt-2">
                {system.name}
              </Typography>
              <Box className="flex min-w-0 flex-1 flex-col gap-3">
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t("filing-ways-row-way")}
                  value={way}
                  onChange={(event) => set({ way: event.target.value as Way, aware: false })}
                  disabled={disabled || offered.length < 2}
                >
                  {offered.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option === firmWay
                        ? t("filing-ways-row-firm", { way: t(WAY_WORDS[option].label) })
                        : t(WAY_WORDS[option].label)}
                    </MenuItem>
                  ))}
                </TextField>
                {way === "browser" && login && !asks.login ? (
                  <StateLine
                    tone={login.state === "verified" ? "done" : "waiting"}
                    action={
                      <Button
                        size="small"
                        variant="text"
                        color="grey"
                        onClick={() => set({ changing: true })}
                        disabled={disabled}
                      >
                        {t("filing-ways-change-password")}
                      </Button>
                    }
                  >
                    {t(loginKey, { hint: login.hint ?? "" })}
                  </StateLine>
                ) : null}
                {way === "browser" && login && (login.state === "refused" || login.state === "blocked") ? (
                  <StateLine tone="failed">{t(`filing-ways-login-${login.state}`)}</StateLine>
                ) : null}
                {asks.login ? (
                  <Box className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {/* What each field is goes in its name, once: the box of the risk says where the password stays. */}
                    <TextField
                      size="small"
                      label={t("filing-ways-login-cpf")}
                      value={draft.user}
                      onChange={(event) => set({ user: event.target.value })}
                      autoComplete="off"
                      disabled={disabled}
                    />
                    <TextField
                      size="small"
                      type="password"
                      label={t("filing-ways-password")}
                      value={draft.password}
                      onChange={(event) => set({ password: event.target.value })}
                      autoComplete="new-password"
                      disabled={disabled}
                    />
                  </Box>
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>

      {browserAsks.length > 0 ? (
        <RiskBox
          aware={browserAsks.every((row) => row.draft.aware)}
          awareLabel={t("filing-ways-aware-browser-many", { systems: names(browserAsks) })}
          onAware={(aware) => setAware(browserAsks, aware)}
          term={term}
          disabled={disabled}
        >
          <Typography variant="body2">{t("filing-ways-risk-browser-many", { systems: names(browserAsks) })}</Typography>
          {browserAsks
            .filter((row) => row.system.ruleNote)
            .map((row) => (
              <Typography key={row.system.key} variant="body2" className="text-text-secondary">
                {row.system.ruleNote}
              </Typography>
            ))}
        </RiskBox>
      ) : null}

      {extensionAsks.length > 0 ? (
        <RiskBox
          aware={extensionAsks.every((row) => row.draft.aware)}
          awareLabel={t("filing-ways-aware-extension")}
          onAware={(aware) => setAware(extensionAsks, aware)}
          term={term}
          disabled={disabled}
        >
          <Typography variant="body2">
            {t("filing-ways-risk-extension-many", { systems: names(extensionAsks) })}
          </Typography>
        </RiskBox>
      ) : null}

      {rows.some((row) => row.way === "extension") ? extension : null}
    </Box>
  );
}

/**
 * The lawyer's extension and their account (0263), wherever the way is chosen: linked, with the way to unlink it; the
 * code ONE shows to type in the extension's panel; or the button that asks for one. A code is asked only once the
 * way is saved, so `prepare` saves the choice first where it is still a draft (a setup's step), and says whether it
 * may go on. The lawyer's login, password and the court's code never pass through here.
 */
export function ExtensionLinkBox({
  link,
  prepare,
  onChanged,
  disabled = false,
}: {
  link: ExtensionLink | null;
  prepare?: () => Promise<{ ok: true } | { ok: false; code: string }>;
  onChanged: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setError(null);
    setBusy(true);
    try {
      if (prepare) {
        const ready = await prepare();
        if (!ready.ok) return setError(t(filingErrorKey(ready.code)));
      }
      const begun = await beginExtensionLink();
      if (!begun.ok || !begun.value) return setError(t(filingErrorKey(begun.code)));
      setCode(begun.value);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!link) return;
    setError(null);
    setBusy(true);
    try {
      const ended = await endExtensionLink(link.id);
      if (!ended.ok) return setError(t(filingErrorKey(ended.code)));
      setCode(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const failure = error ? (
    <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setError(null)}>
      {error}
    </Alert>
  ) : null;

  // A code asked while an extension is linked (one reinstalled, or another computer): the code shows as when none is,
  // and the extension that types it replaces the one linked before (`claim_extension_link` ends it, 0263). Before
  // 2026-11-27 a linked extension offered only "Desligar", and the owner, who had reinstalled it, found no code.
  if (link && !code) {
    return (
      <Box className="flex flex-col gap-1">
        <StateLine
          tone="done"
          action={
            <Box className="flex flex-row flex-wrap gap-1">
              <Button size="small" variant="text" color="grey" onClick={() => void ask()} disabled={busy || disabled}>
                {t("filing-ways-extension-relink")}
              </Button>
              <Button
                size="small"
                variant="text"
                color="grey"
                onClick={() => void unlink()}
                disabled={busy || disabled}
              >
                {t("filing-ways-extension-unlink")}
              </Button>
            </Box>
          }
        >
          {t("filing-ways-extension-linked", { label: link.label ?? t("filing-ways-extension-unnamed") })}
        </StateLine>
        {failure}
      </Box>
    );
  }
  if (code) {
    return (
      <Box className="flex flex-col gap-2">
        <Typography variant="body2">{t("filing-ways-extension-code")}</Typography>
        <Box className="flex flex-row flex-wrap items-center gap-3">
          <Typography
            component="p"
            className="bg-grey-50 font-display self-start rounded-lg px-4 py-2 text-2xl font-bold tracking-widest"
          >
            {code}
          </Typography>
          <Button size="small" variant="text" color="grey" onClick={onChanged} disabled={busy || disabled}>
            {t("filing-ways-extension-typed")}
          </Button>
        </Box>
        {failure}
      </Box>
    );
  }
  return (
    <Box className="flex flex-col gap-3">
      <ExtensionInstall />
      <StateLine
        tone="attention"
        action={
          <Button size="small" variant="outlined" onClick={() => void ask()} disabled={busy || disabled}>
            {t("filing-ways-extension-link")}
          </Button>
        }
      >
        {t("filing-ways-extension-not-linked")}
      </StateLine>
      {failure}
    </Box>
  );
}

/** Where ONE serves the extension's zip, packed by each deploy (`extension/package.mjs`), to who is signed in. */
export const EXTENSION_DOWNLOAD = "/extensao/one-extensao.zip";

/**
 * How a lawyer gets the extension before linking it (2026-11-24: a lawyer chose the extension and nothing was ever
 * installed, since ONE offered no way to get it): the zip ONE serves, and the three steps of loading it in Chrome,
 * the address of its extensions page copied in one click (a page cannot open it). Until the extension is in the
 * Chrome Web Store, it loads in the developer mode.
 */
function ExtensionInstall() {
  const t = useTranslations("product");
  const address = "chrome://extensions";
  return (
    <Box className="flex flex-col gap-2">
      <Box className="flex flex-wrap items-center justify-between gap-2">
        <Box className="flex items-center gap-1">
          <Typography variant="body2" component="h4" className="font-semibold">
            {t("filing-ways-extension-install-title")}
          </Typography>
          <InfoHint label={t("filing-ways-extension-install-note")} />
        </Box>
        <Button size="small" variant="outlined" href={EXTENSION_DOWNLOAD} download="one-extensao.zip">
          {t("filing-ways-extension-install-download")}
        </Button>
      </Box>
      <Box component="ol" className="m-0 flex list-decimal flex-col gap-1 pl-5">
        <Typography component="li" variant="body2">
          {t("filing-ways-extension-install-step-1")}
        </Typography>
        <Typography component="li" variant="body2">
          {t("filing-ways-extension-install-step-2")}
          <Box component="span" className="ml-1 inline-flex items-center gap-0.5 align-middle">
            <Box component="code" className="bg-grey-50 rounded px-1.5 py-0.5 text-sm">
              {address}
            </Box>
            <CopyButton text={address} label={t("filing-ways-extension-install-address")} />
          </Box>
        </Typography>
        <Typography component="li" variant="body2">
          {t("filing-ways-extension-install-step-3")}
        </Typography>
        <Typography component="li" variant="body2">
          {t("filing-ways-extension-install-step-4")}
        </Typography>
      </Box>
    </Box>
  );
}
