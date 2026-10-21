"use client";

import { scheduleSubscriptionCancellation, undoSubscriptionCancellation } from "../actions-cancel";
import { CANCEL_REASONS, type CancelReason } from "../cancel-reasons";
import type { SubscriptionInfo, WorkspaceEntitlements } from "./use-billing";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Grid,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";

/** The label of each reason, in the order the dialog offers them. */
const REASON_LABEL: Record<CancelReason, string> = {
  too_expensive: "billing-cancel-reason-too_expensive",
  not_using: "billing-cancel-reason-not_using",
  missing_tool: "billing-cancel-reason-missing_tool",
  switched: "billing-cancel-reason-switched",
  technical: "billing-cancel-reason-technical",
  temporary: "billing-cancel-reason-temporary",
  other: "billing-cancel-reason-other",
};

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  active: "success",
  trialing: "warning",
  past_due: "error",
};

/**
 * What the workspace holds now: the subscription (or the free plan), the kit
 * when it owns one, and the way out. Cancelling asks why (one of the reasons
 * of `subscription_cancel_reason`, plus an optional note for the operator) and
 * says what stays: with the kit, the catalog and its updates; without it,
 * updates stop when the period ends while installed tools keep working.
 */
export default function CurrentSubscription({
  orgId,
  subscription,
  entitlements,
  canManage,
  onChanged,
}: {
  orgId: string;
  subscription: SubscriptionInfo | null;
  entitlements: WorkspaceEntitlements;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);
  const cancellationKey = useRef<string | null>(null);
  const resumeKey = useRef<string | null>(null);
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale).format(new Date(value));
  // A yearly plan paid in installments ends with its period by design.
  const singleTerm = Boolean(subscription && !subscription.renews);

  const schedule = async () => {
    setWorking(true);
    setError(false);
    cancellationKey.current ??= crypto.randomUUID();
    const result = await scheduleSubscriptionCancellation(orgId, cancellationKey.current, reason || null, note);
    setWorking(false);
    if (result.error) {
      setError(true);
      return;
    }
    cancellationKey.current = null;
    setConfirmOpen(false);
    setReason("");
    setNote("");
    onChanged();
  };

  const undo = async () => {
    setWorking(true);
    setError(false);
    resumeKey.current ??= crypto.randomUUID();
    const result = await undoSubscriptionCancellation(orgId, resumeKey.current);
    setWorking(false);
    if (result.error) {
      setError(true);
      return;
    }
    resumeKey.current = null;
    onChanged();
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Typography variant="h5" component="h2" className="card-title">
            {t("billing-current-title")}
          </Typography>
          {subscription?.adminSuspended && <Alert severity="error">{t("billing-suspended")}</Alert>}
          {error && <Alert severity="error">{t("billing-action-error")}</Alert>}

          {entitlements.hasKit && (
            <Alert severity="success" className="neutral">
              {entitlements.accessEndsAt
                ? t("billing-kit-active-until", { date: formatDate(entitlements.accessEndsAt) })
                : t("billing-kit-active")}
            </Alert>
          )}

          {!subscription ? (
            <Typography variant="body1" className="text-text-secondary">
              {t("billing-no-subscription")}
            </Typography>
          ) : (
            <Box className="flex flex-col gap-4">
              <Box className="flex flex-wrap items-center gap-3">
                <Typography variant="h6" component="h3">
                  {subscription.planName}
                </Typography>
                <Chip
                  label={t(`billing-status-${subscription.status}` as never)}
                  size="small"
                  color={STATUS_COLOR[subscription.status] ?? "default"}
                  variant="outlined"
                />
              </Box>

              {subscription.currentPeriodEnd && !subscription.cancelAtPeriodEnd && !subscription.isFree && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("billing-renews-on", { date: formatDate(subscription.currentPeriodEnd) })}
                </Typography>
              )}

              {subscription.cancelAtPeriodEnd &&
                subscription.currentPeriodEnd &&
                (singleTerm ? (
                  <Alert severity="info" className="neutral">
                    {t("billing-single-term", { date: formatDate(subscription.currentPeriodEnd) })}
                  </Alert>
                ) : (
                  <Alert
                    severity="warning"
                    action={
                      canManage ? (
                        <Button color="inherit" size="small" onClick={undo} disabled={working}>
                          {t("billing-undo-cancel")}
                        </Button>
                      ) : undefined
                    }
                  >
                    {t("billing-cancel-scheduled", { date: formatDate(subscription.currentPeriodEnd) })}
                  </Alert>
                ))}

              {canManage && !subscription.isFree && !subscription.cancelAtPeriodEnd && (
                <Box>
                  <Button variant="outlined" color="error" onClick={() => setConfirmOpen(true)}>
                    {t("billing-cancel")}
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onClose={() => !working && setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("billing-cancel-dialog-title")}</DialogTitle>
        <DialogContent className="flex flex-col gap-4">
          <Typography variant="body1" className="text-text-secondary">
            {t("billing-cancel-dialog-body", {
              date: subscription?.currentPeriodEnd
                ? formatDate(subscription.currentPeriodEnd)
                : t("billing-current-cycle"),
            })}
          </Typography>
          <Alert severity="info" className="neutral">
            {entitlements.hasKit ? t("billing-cancel-kit-kept") : t("billing-cancel-updates-stop")}
          </Alert>
          <FormControl className="outlined" variant="standard" size="small">
            <FormLabel component="label" id="cancel-reason-label" htmlFor="cancel-reason">
              {t("billing-cancel-reason-label")}
            </FormLabel>
            <Select
              id="cancel-reason"
              labelId="cancel-reason-label"
              displayEmpty
              value={reason}
              onChange={(event) => setReason(event.target.value as CancelReason | "")}
              renderValue={(value) =>
                value ? t(REASON_LABEL[value as CancelReason]) : t("billing-cancel-reason-none")
              }
            >
              <MenuItem value="">{t("billing-cancel-reason-none")}</MenuItem>
              {CANCEL_REASONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {t(REASON_LABEL[option])}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label={t("billing-cancel-note-label")}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            multiline
            minRows={2}
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmOpen(false)} disabled={working}>
            {t("billing-keep-plan")}
          </Button>
          <Button color="error" variant="contained" onClick={schedule} disabled={working}>
            {t("billing-confirm-cancel")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
