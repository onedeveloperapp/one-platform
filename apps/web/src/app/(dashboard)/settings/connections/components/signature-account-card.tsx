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
  Grid,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { connectSignatureAccount, disconnectSignatureAccount } from "@/lib/signatures/actions";
import { connectErrorKey } from "@/lib/whatsapp/connections";

/**
 * The firm's ZapSign account, where its clients sign the power of attorney
 * and the contract. The firm pastes its own API token (ZapSign: Settings,
 * Integrations, ZapSign API); ONE points the account's webhook at itself and
 * seals the token in the vault. The sandbox signs nothing with legal validity.
 */
export default function SignatureAccountCard({
  account,
  blocked,
  vault,
  onChanged,
}: {
  account: { connectionId: string; status: string; environment: string; lastError: string | null } | null;
  /** A support visit, or a session without the second factor: nothing is connected or cut. */
  blocked: boolean;
  vault: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [token, setToken] = useState("");
  const [environment, setEnvironment] = useState<"production" | "sandbox">("production");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const connected = account?.status === "connected";

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await connectSignatureAccount({ token, environment });
      if (!result.ok) setProblem(result.code);
      else {
        setToken("");
        onChanged();
      }
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
      if (!result.ok) setProblem(result.code);
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="connections-signature">
        <CardContent className="flex flex-col gap-4">
          <Box className="flex flex-wrap items-start justify-between gap-2">
            <Box className="flex flex-col gap-1">
              <Typography id="connections-signature" variant="h5" component="h2" className="mb-0">
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
                      ? t("connections-signature-connected-sandbox")
                      : t("connections-signature-connected")
                    : t("connections-signature-problem")
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
          ) : (
            <Box className="flex flex-col gap-3">
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
              <RadioGroup
                row
                className="gap-x-6"
                aria-label={t("connections-signature-environment")}
                value={environment}
                onChange={(event) => setEnvironment(event.target.value === "sandbox" ? "sandbox" : "production")}
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
              <Box>
                <Button
                  variant="contained"
                  disabled={busy || blocked || !vault || token.trim().length < 16}
                  onClick={() => void connect()}
                >
                  {busy ? t("cases-working") : t("connections-signature-connect")}
                </Button>
              </Box>
            </Box>
          )}

          {problem && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(connectErrorKey(problem))}
            </Alert>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
