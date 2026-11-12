"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, LinearProgress, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import StatusChip from "@/components/product/status-chip";
import { disconnectNumber, simulateLeave } from "@/lib/whatsapp/actions";
import { type ConnectedNumber, connectErrorKey, disconnectReasonKey } from "@/lib/whatsapp/connections";

/**
 * One number of the firm: which it is, whether it is working, how it lives
 * (also on the firm's phone, or on the platform alone) and, for one that
 * stopped, why. Cutting it is the one thing here that takes something away,
 * so it says what goes and what stays before it is done.
 */
export default function NumberCard({
  number,
  blocked,
  simulator,
  onChanged,
}: {
  number: ConnectedNumber;
  /** No second factor in this session, or a support visit: the screen already says why. */
  blocked: boolean;
  /** The simulator is on in this environment. */
  simulator: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const active = number.status === "active";
  const titleId = `connection-${number.id}`;

  const leaveFromPhone = async () => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    const result = await simulateLeave(number.id);
    setBusy(false);
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    onChanged();
  };

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby={titleId}>
        <CardContent className="flex flex-col gap-4">
          <Box className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
            <Box className="flex min-w-0 flex-col gap-1">
              <Typography id={titleId} variant="h5" component="h2" className="mb-0">
                {number.phoneLabel}
              </Typography>
              {number.verifiedName ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("connections-verified-name", { name: number.verifiedName })}
                </Typography>
              ) : null}
            </Box>
            <Box className="flex flex-row flex-wrap gap-1.5">
              <StatusChip
                label={active ? t("connections-status-active") : t("connections-status-disconnected")}
                tone={active ? "positive" : "attention"}
              />
              <StatusChip
                label={number.mode === "coexistence" ? t("connections-mode-coexistence") : t("connections-mode-cloud")}
                tone="neutral"
              />
              {number.provider === "simulator" ? <StatusChip label={t("connections-simulated")} tone="info" /> : null}
              {number.provider === "openwa" ? <StatusChip label={t("connections-openwa")} tone="attention" /> : null}
            </Box>
          </Box>

          <Typography variant="body2" className="text-text-secondary">
            {active
              ? t("connections-since-active", { when: number.sinceLabel })
              : t("connections-since-disconnected", { when: number.sinceLabel })}
          </Typography>

          {!active ? (
            <Typography variant="body1" className="text-text-primary">
              {t(disconnectReasonKey(number.disconnectReason))}
            </Typography>
          ) : null}

          {active && number.mode === "coexistence" && number.provider === "meta" ? (
            <Box className="flex flex-col gap-2">
              <Typography variant="body2" className="text-text-secondary">
                {number.syncRequested ? t("connections-sync-requested") : t("connections-sync-not-requested")}
              </Typography>
              {number.historyProgress !== null ? (
                <Box className="flex flex-row items-center gap-3">
                  <LinearProgress
                    variant="determinate"
                    value={number.historyProgress}
                    className="max-w-xs flex-1"
                    aria-label={t("connections-history-label")}
                  />
                  <Typography variant="body2" className="text-text-primary tabular-nums">
                    {t("connections-history-progress", { percent: number.historyProgress })}
                  </Typography>
                </Box>
              ) : null}
            </Box>
          ) : null}

          {errorCode ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(connectErrorKey(errorCode))}
            </Alert>
          ) : null}

          {active ? (
            <Box className="flex flex-row flex-wrap gap-2">
              <Button variant="outlined" color="grey" onClick={() => setConfirming(true)} disabled={busy || blocked}>
                {t("connections-disconnect")}
              </Button>
              {number.provider === "simulator" && simulator ? (
                <Button variant="text" color="grey" onClick={() => void leaveFromPhone()} disabled={busy || blocked}>
                  {t("connections-simulate-leave")}
                </Button>
              ) : null}
            </Box>
          ) : null}
        </CardContent>
      </Card>

      {confirming ? (
        <ConfirmActionDialog
          title={t("connections-disconnect-title", { number: number.phoneLabel })}
          consequences={[t("connections-disconnect-consequence-1"), t("connections-disconnect-consequence-2")]}
          staysTitle={t("connections-disconnect-stays-title")}
          stays={[t("connections-disconnect-stays-1"), t("connections-disconnect-stays-2")]}
          requireReason={false}
          confirmLabel={t("connections-disconnect-confirm")}
          cancelLabel={t("connections-cancel")}
          busyLabel={t("connections-working")}
          tone="danger"
          onConfirm={async () => {
            const result = await disconnectNumber(number.connectionId);
            if (!result.ok) return t(connectErrorKey(result.code));
            onChanged();
            return null;
          }}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </Grid>
  );
}
