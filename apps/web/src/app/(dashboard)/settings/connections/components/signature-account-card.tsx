"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  FormLabel,
  Grid,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { connectD4SignAccount, connectSignatureAccount, disconnectSignatureAccount } from "@/lib/signatures/actions";
import { ACCOUNT_NAME, type AccountMethod } from "@/lib/signatures/methods";
import { connectErrorKey } from "@/lib/whatsapp/connections";

/** A refusal of D4Sign said in D4Sign's words; the rest is the connections' common words. */
const D4SIGN_ERROR_KEY: Record<string, string> = {
  invalid_token: "connections-error-d4sign-keys",
  token_refused: "connections-error-d4sign-refused",
  provider_unavailable: "connections-error-d4sign-unavailable",
  other_account: "connections-error-d4sign-other-account",
  no_safe: "connections-error-d4sign-no-safe",
  safe_not_found: "connections-error-d4sign-safe",
  provider_rate_limited: "connections-error-d4sign-limit",
};

/** A refusal of either account's (0254): papers still signing by the account it would cut. */
const SIGNATURE_ERROR_KEY: Record<string, string> = {
  open_papers: "connections-error-signature-open-papers",
};

const errorKey = (provider: AccountMethod, code: string): string =>
  (provider === "d4sign" ? D4SIGN_ERROR_KEY[code] : undefined) ?? SIGNATURE_ERROR_KEY[code] ?? connectErrorKey(code);

/**
 * The firm's signature account, where its clients sign the power of attorney and the contract: ZapSign, by its API
 * token, or D4Sign (0253), by its two API keys and the safe the papers go into. ONE reads the account first (D4Sign's
 * safes: one is taken as it is, several are offered to choose), seals the keys in the vault and follows each paper by
 * itself. One account at a time. The test environment of either signs nothing with legal validity.
 */
export default function SignatureAccountCard({
  account,
  blocked,
  vault,
  onChanged,
  embedded = false,
}: {
  account: {
    connectionId: string;
    provider: AccountMethod;
    status: string;
    environment: string;
    safeName: string | null;
    lastError: string | null;
  } | null;
  /** A support visit, or a session without the second factor: nothing is connected or cut. */
  blocked: boolean;
  vault: boolean;
  onChanged: () => void;
  /** Inside another screen's flow (the firm's setup): the section without its card, its title a level down. */
  embedded?: boolean;
}) {
  const t = useTranslations("product");
  const [provider, setProvider] = useState<AccountMethod>(account?.provider ?? "d4sign");
  const [token, setToken] = useState("");
  const [cryptKey, setCryptKey] = useState("");
  const [environment, setEnvironment] = useState<"production" | "sandbox">("production");
  const [safes, setSafes] = useState<{ uuid: string; name: string }[] | null>(null);
  const [safe, setSafe] = useState("");
  const [busy, setBusy] = useState(false);
  // What went wrong, said in the words of the provider it happened with: the one being connected, or the one cut.
  const [problem, setProblem] = useState<{ code: string; provider: AccountMethod } | null>(null);
  const connected = account?.status === "connected";
  const accountName = ACCOUNT_NAME[account?.provider ?? provider];

  // Keys of another provider or environment are other keys: what the account offered no longer holds.
  const reset = () => {
    setSafes(null);
    setSafe("");
    setProblem(null);
  };

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (provider === "d4sign") {
        const result = await connectD4SignAccount({
          tokenApi: token,
          cryptKey,
          environment,
          safeUuid: safe || null,
        });
        if (!result.ok) {
          // The safes as the account has them now: a safe chosen that is gone leaves the list as it is.
          if ("safes" in result && Array.isArray(result.safes)) {
            setSafes(result.safes);
            setSafe("");
          }
          if (result.code !== "choose_safe") setProblem({ code: result.code, provider });
          return;
        }
      } else {
        const result = await connectSignatureAccount({ token, environment });
        if (!result.ok) {
          setProblem({ code: result.code, provider });
          return;
        }
      }
      setToken("");
      setCryptKey("");
      reset();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!account) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await disconnectSignatureAccount(account.connectionId);
      if (!result.ok) setProblem({ code: result.code, provider: account.provider });
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  // D4Sign's cryptKey only where the account enabled it: the token alone may connect.
  const keysTyped = token.trim().length >= 16;
  const ready = keysTyped && (safes === null || safe !== "");

  const content = (
    <>
      <Box className="flex flex-wrap items-start justify-between gap-2">
        <Box className="flex flex-col gap-1">
          <Typography
            id="connections-signature"
            variant={embedded ? "subtitle2" : "h5"}
            component={embedded ? "h3" : "h2"}
            className="mb-0"
          >
            {t("connections-signature-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("connections-signature-body")}
          </Typography>
        </Box>
        {account && (
          <StatusChip
            tone={connected ? "positive" : "attention"}
            label={
              connected
                ? account.environment === "sandbox"
                  ? t("connections-signature-connected-sandbox", { provider: accountName })
                  : t("connections-signature-connected", { provider: accountName })
                : t("connections-signature-problem", { provider: accountName })
            }
          />
        )}
      </Box>

      {!vault && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("connections-error-vault")}
        </Alert>
      )}

      {connected ? (
        <Box className="flex flex-col gap-2">
          {account.provider === "d4sign" && account.safeName && (
            <Typography variant="body2" className="text-text-secondary">
              {t("connections-signature-safe-in-use", { safe: account.safeName })}
            </Typography>
          )}
          <Box>
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy || blocked}
              onClick={() => void disconnect()}
            >
              {busy ? t("cases-working") : t("connections-signature-disconnect")}
            </Button>
          </Box>
        </Box>
      ) : (
        <Box className="flex flex-col gap-3">
          <Box>
            <FormLabel component="legend" id="connections-signature-provider" className="mb-1">
              {t("connections-signature-provider")}
            </FormLabel>
            <RadioGroup
              row
              className="gap-x-6"
              aria-labelledby="connections-signature-provider"
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value === "zapsign" ? "zapsign" : "d4sign");
                setToken("");
                setCryptKey("");
                reset();
              }}
            >
              <FormControlLabel
                value="d4sign"
                control={<Radio size="small" />}
                label={ACCOUNT_NAME.d4sign}
                disabled={busy || blocked}
              />
              <FormControlLabel
                value="zapsign"
                control={<Radio size="small" />}
                label={ACCOUNT_NAME.zapsign}
                disabled={busy || blocked}
              />
            </RadioGroup>
          </Box>

          {provider === "d4sign" ? (
            <>
              <TextField
                fullWidth
                size="small"
                id="connections-signature-d4sign-token"
                label={t("connections-signature-d4sign-token")}
                helperText={t("connections-signature-d4sign-help")}
                value={token}
                type="password"
                autoComplete="off"
                disabled={busy || blocked || !vault}
                onChange={(event) => {
                  setToken(event.target.value);
                  reset();
                }}
              />
              <TextField
                fullWidth
                size="small"
                id="connections-signature-d4sign-crypt"
                label={t("connections-signature-d4sign-crypt")}
                helperText={t("connections-signature-d4sign-crypt-help")}
                value={cryptKey}
                type="password"
                autoComplete="off"
                disabled={busy || blocked || !vault}
                onChange={(event) => {
                  setCryptKey(event.target.value);
                  reset();
                }}
              />
            </>
          ) : (
            <TextField
              fullWidth
              size="small"
              id="connections-signature-token"
              label={t("connections-signature-token")}
              helperText={t("connections-signature-token-help")}
              value={token}
              type="password"
              autoComplete="off"
              disabled={busy || blocked || !vault}
              onChange={(event) => setToken(event.target.value)}
            />
          )}

          <RadioGroup
            row
            className="gap-x-6"
            aria-label={t("connections-signature-environment")}
            value={environment}
            onChange={(event) => {
              setEnvironment(event.target.value === "sandbox" ? "sandbox" : "production");
              reset();
            }}
          >
            <FormControlLabel
              value="production"
              control={<Radio size="small" />}
              label={t("connections-signature-production")}
            />
            <FormControlLabel
              value="sandbox"
              control={<Radio size="small" />}
              label={t("connections-signature-sandbox")}
            />
          </RadioGroup>

          {provider === "d4sign" && safes && (
            <Box>
              <FormLabel component="legend" id="connections-signature-safe" className="mb-1">
                {t("connections-signature-safe-choose")}
              </FormLabel>
              <RadioGroup
                aria-labelledby="connections-signature-safe"
                value={safe}
                onChange={(event) => setSafe(event.target.value)}
              >
                {safes.map((item) => (
                  <FormControlLabel
                    key={item.uuid}
                    value={item.uuid}
                    control={<Radio size="small" />}
                    label={item.name}
                    disabled={busy || blocked}
                  />
                ))}
              </RadioGroup>
            </Box>
          )}

          <Box className="flex flex-wrap gap-2">
            <Button variant="contained" disabled={busy || blocked || !vault || !ready} onClick={() => void connect()}>
              {busy ? t("cases-working") : t("connections-signature-connect")}
            </Button>
            {/* An account with a problem may be cut, to connect the other provider or start again. */}
            {account && (
              <Button variant="text" color="grey" disabled={busy || blocked} onClick={() => void disconnect()}>
                {t("connections-signature-disconnect")}
              </Button>
            )}
          </Box>
        </Box>
      )}

      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(errorKey(problem.provider, problem.code))}
        </Alert>
      )}
    </>
  );

  if (embedded) {
    return (
      <Box component="section" aria-labelledby="connections-signature" className="flex flex-col gap-4">
        {content}
      </Box>
    );
  }
  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="connections-signature">
        <CardContent className="flex flex-col gap-4">{content}</CardContent>
      </Card>
    </Grid>
  );
}
