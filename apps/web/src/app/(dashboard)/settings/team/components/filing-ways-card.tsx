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
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import {
  beginExtensionLink,
  endCourtLogin,
  endExtensionLink,
  giveCourtLogin,
  setFirmFilingWay,
  setLawyerFilingWay,
} from "@/lib/filing-ways/actions";
import {
  type CourtLogin,
  type FilingWaysData,
  type ScreenSystem,
  systemsFor,
  type Way,
  wayAt,
  waysOffered,
} from "@/lib/filing-ways/ways";

/** The words of each way, as the lawyer chooses it for themself. */
const WAY_WORDS: Record<Way, { label: string; help: string; chip: string }> = {
  browser: { label: "filing-way-browser", help: "filing-way-browser-help", chip: "filing-ways-chip-browser" },
  extension: { label: "filing-way-extension", help: "filing-way-extension-help", chip: "filing-ways-chip-extension" },
  hand: { label: "filing-way-hand", help: "filing-way-hand-help", chip: "filing-ways-chip-hand" },
};

/** The words of each way, as who decides for the firm chooses it for every lawyer of it. */
const FIRM_WAY_WORDS: Record<Way, { label: string; help: string }> = {
  browser: { label: "filing-ways-firm-way-browser", help: "filing-ways-firm-way-browser-help" },
  extension: { label: "filing-ways-firm-way-extension", help: "filing-ways-firm-way-extension-help" },
  hand: { label: "filing-ways-firm-way-hand", help: "filing-ways-firm-way-hand-help" },
};

/** The words of a kept login, of the risk and of the acknowledgment, by the way and the login's state. */
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

/** The words of a refusal: the code's own when the screen has them, else the general one. */
const errorKey = (code: string): string => (ERROR_KEYS.has(code) ? `filing-ways-error-${code}` : "filing-ways-error");

/**
 * How the lawyer files in each court they sign in (the owner, 2026-11-20; migrations 0263 and 0264): ONE's browser
 * with their login, their extension, or by hand with ONE's guide, the firm's choice marked. The login is typed here
 * and sealed in the same request, never shown again; the extension is linked by a code. The setup of each lawyer opens
 * on the same card (the canvas the owner approved), so nothing of it is left to be found in the settings later.
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
  const [way, setWay] = useState<Way>(data.firmWay ?? "browser");
  const [aware, setAware] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data.decidesForFirm) {
    return data.firmWay ? (
      <StateLine tone="info">{t("filing-ways-firm-chosen", { way: t(FIRM_WAY_WORDS[data.firmWay].label) })}</StateLine>
    ) : (
      <StateLine tone="info">{t("filing-ways-firm-none")}</StateLine>
    );
  }

  const changed = way !== data.firmWay;
  const needsAware = changed && way !== "hand";

  async function save() {
    setError(null);
    if (needsAware && !aware) return setError(t("filing-ways-error-term_not_accepted"));
    setBusy(true);
    try {
      const set = await setFirmFilingWay(way, way === "hand" ? null : (data.terms.firm?.id ?? null));
      if (!set.ok) return setError(t(errorKey(set.code)));
      setAware(false);
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
      <RadioGroup
        aria-label={t("filing-ways-firm-title")}
        value={way}
        onChange={(event) => {
          setWay(event.target.value as Way);
          setError(null);
        }}
        className="flex flex-col gap-2"
      >
        {(["browser", "extension", "hand"] as const).map((option) => (
          <FormControlLabel
            key={option}
            value={option}
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
      {needsAware ? (
        <Box className="border-accent-4/30 bg-accent-4/5 flex flex-col gap-2 rounded-lg border p-4">
          <Typography variant="body2">{t("filing-ways-firm-risk")}</Typography>
          <FormControlLabel
            control={<Checkbox checked={aware} onChange={(event) => setAware(event.target.checked)} />}
            label={t("filing-ways-firm-aware")}
          />
        </Box>
      ) : null}
      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {changed ? (
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
  const saved = wayAt(data, system);
  const offered = waysOffered(system, data.firmWay);
  const login: CourtLogin | null = data.logins.find((row) => row.system === system.key) ?? null;
  const firmWay = data.firmWay ?? "browser";

  const [way, setWay] = useState<Way>(saved);
  const [aware, setAware] = useState(false);
  const [readTerm, setReadTerm] = useState(false);
  const [changing, setChanging] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const automated = way !== "hand";
  // A login is asked for ONE's browser when none is kept, the court refused it, or the lawyer changes it.
  const asksLogin = way === "browser" && (!login || login.state === "refused" || login.state === "blocked" || changing);
  // The acknowledgment is asked whenever an automated way is saved: the database keeps the text it was given for.
  const needsAware = automated && (way !== data.myWays[system.key] || asksLogin);
  const loginKey = LOGIN_STATE_KEY[login?.state === "verified" ? "verified" : "unchecked"];
  const riskKey = RISK_KEY[way === "browser" ? "browser" : "extension"];
  const awareKey = AWARE_KEY[way === "browser" ? "browser" : "extension"];

  async function save() {
    setError(null);
    setSaid(null);
    if (needsAware && !aware) return setError(t("filing-ways-error-term_not_accepted"));
    if (asksLogin && (!user.trim() || !password)) return setError(t("filing-ways-error-empty"));
    setBusy(true);
    try {
      if (way !== data.myWays[system.key] || needsAware) {
        const set = await setLawyerFilingWay(system.key, way, automated ? (data.terms.lawyer?.id ?? null) : null);
        if (!set.ok) return setError(t(errorKey(set.code)));
      }
      if (asksLogin) {
        const given = await giveCourtLogin(system.key, user, password);
        setPassword("");
        if (!given.ok) return setError(t(errorKey(given.code)));
        setUser("");
        setChanging(false);
      }
      setAware(false);
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
      if (!begun.ok || !begun.value) return setError(t(errorKey(begun.code)));
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
      if (!ended.ok) return setError(t(errorKey(ended.code)));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box className="flex flex-col gap-4">
      <SectionTitle
        id={`filing-ways-${system.key}`}
        title={system.name}
        as="h3"
        variant="subtitle1"
        chip={<StatusChip label={t(WAY_WORDS[saved].chip)} tone={saved === "hand" ? "neutral" : "positive"} />}
      />

      <RadioGroup
        aria-label={t("filing-ways-choose", { system: system.name })}
        value={way}
        onChange={(event) => {
          setWay(event.target.value as Way);
          setError(null);
          setSaid(null);
        }}
        className="flex flex-col gap-2"
      >
        {offered.map((option) => (
          <FormControlLabel
            key={option}
            value={option}
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

      {way === "browser" && login && !asksLogin ? (
        <StateLine
          tone={login.state === "verified" ? "done" : "waiting"}
          action={
            <Box className="flex flex-row flex-wrap gap-1">
              <Button size="small" variant="text" onClick={() => setChanging(true)} disabled={busy}>
                {t("filing-ways-change-password")}
              </Button>
              <Button size="small" variant="text" color="grey" onClick={() => setRemoving(true)} disabled={busy}>
                {t("filing-ways-remove-login")}
              </Button>
            </Box>
          }
        >
          {t(loginKey, {
            hint: login.hint ?? "",
          })}
        </StateLine>
      ) : null}

      {way === "browser" && login && (login.state === "refused" || login.state === "blocked") ? (
        <StateLine tone="failed">{t(`filing-ways-login-${login.state}`)}</StateLine>
      ) : null}

      {asksLogin ? (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              variant="standard"
              label={t("filing-ways-login")}
              helperText={t("filing-ways-login-help")}
              value={user}
              onChange={(event) => setUser(event.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              variant="standard"
              type="password"
              label={t("filing-ways-password")}
              helperText={t("filing-ways-password-help")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </Grid>
        </Grid>
      ) : null}

      {way === "extension" && saved === "extension" ? (
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
      ) : null}

      {way === "hand" ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("filing-ways-hand-note")}
        </Typography>
      ) : null}

      {needsAware ? (
        <Box className="border-accent-4/30 bg-accent-4/5 flex flex-col gap-2 rounded-lg border p-4">
          <Typography variant="body2">
            {t(riskKey, {
              system: system.name,
            })}
          </Typography>
          {system.ruleNote ? (
            <Typography variant="body2" className="text-text-secondary">
              {system.ruleNote}
            </Typography>
          ) : null}
          <Box className="flex flex-row flex-wrap items-center gap-2">
            <FormControlLabel
              control={<Checkbox checked={aware} onChange={(event) => setAware(event.target.checked)} />}
              label={t(awareKey)}
            />
            {data.terms.lawyer ? (
              <Button size="small" variant="text" onClick={() => setReadTerm(true)}>
                {t("filing-ways-read-term")}
              </Button>
            ) : null}
          </Box>
        </Box>
      ) : null}

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

      {way !== saved || asksLogin || needsAware ? (
        <Box className="flex flex-row justify-end">
          <Button variant="contained" onClick={() => void save()} disabled={busy}>
            {busy ? t("saving") : t("filing-ways-save")}
          </Button>
        </Box>
      ) : null}

      {data.terms.lawyer ? (
        <Dialog open={readTerm} onClose={() => setReadTerm(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{data.terms.lawyer.title}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" component="div" className="whitespace-pre-line">
              {data.terms.lawyer.bodyMd.replace(/^- /gm, "· ")}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setReadTerm(false)}>{t("filing-ways-term-close")}</Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {removing && login ? (
        <ConfirmActionDialog
          title={t("filing-ways-remove-title", { system: system.name })}
          consequences={[t("filing-ways-remove-consequence-1"), t("filing-ways-remove-consequence-2")]}
          confirmLabel={t("filing-ways-remove-confirm")}
          tone="warning"
          onConfirm={async () => {
            const ended = await endCourtLogin(login.connectionId);
            if (!ended.ok) return t(errorKey(ended.code));
            onChanged();
            return null;
          }}
          onClose={() => setRemoving(false)}
        />
      ) : null}
    </Box>
  );
}
