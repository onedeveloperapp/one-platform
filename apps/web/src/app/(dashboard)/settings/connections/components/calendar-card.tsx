"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import StatusChip from "@/components/product/status-chip";
import {
  disconnectCalendar,
  recreateCalendar,
  retakeCalendar,
  startCalendarConnection,
} from "@/lib/hearings/calendar-actions";
import { connectErrorKey } from "@/lib/whatsapp/connections";

/** What the firm's calendar of hearings is, as the screen reads it. */
export type CalendarConnection = {
  /** The calendar connection is possible in this environment (Google's client, or the fake). */
  available: boolean;
  /** `error`: Google no longer honours the grant, and the account is connected again by consent. */
  connection: { id: string; status: string } | null;
  /** The firm's calendar whatever its state: in use, stopped by itself, or turned off by a person. */
  calendar: { name: string; status: "active" | "lost" | "off"; problem: string | null } | null;
  /** What came of the last consent, said by the address Google sent the person back to. */
  outcome: string | null;
};

const OUTCOME_KEY: Record<string, { key: string; severity: "success" | "error" | "warning" }> = {
  conectada: { key: "connections-calendar-outcome-connected", severity: "success" },
  recusada: { key: "connections-calendar-outcome-refused", severity: "warning" },
  "sem-permissao": { key: "connections-calendar-outcome-no-scope", severity: "warning" },
  "sem-agenda": { key: "connections-calendar-outcome-no-calendar", severity: "error" },
  expirada: { key: "connections-calendar-outcome-expired", severity: "warning" },
  erro: { key: "connections-calendar-outcome-error", severity: "error" },
};

const PROBLEM_KEY: Record<string, string> = {
  auth: "connections-calendar-lost-auth",
  gone: "connections-calendar-lost-gone",
  expired: "connections-calendar-lost-expired",
};

/** An action that threw: said as any failure is. */
const FAILED = "failed";

/**
 * The firm's calendar of hearings in Google. Who manages the firm connects
 * one Google account; ONE makes in it one calendar of the firm's hearings
 * (or takes again the one it had, when the account may still write it) and
 * keeps it written, and asks Google for nothing else of the account. The
 * person shares that calendar with the rest of the firm in Google itself.
 * Each state offers the one thing that brings the calendar back first: the
 * account connected again when Google no longer honours the grant, the
 * calendar it had taken back when it is named and was not deleted, a new one
 * when it was deleted or there is none. A new calendar may be made whenever
 * the account is connected, confirmed when one is in use, and cutting it is
 * confirmed first, saying what stays.
 */
export default function CalendarCard({
  state,
  blocked,
  vault,
  onChanged,
}: {
  state: CalendarConnection;
  /** A support visit, or a session without the second factor: nothing is connected or cut. */
  blocked: boolean;
  vault: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"recreate" | "disconnect" | null>(null);
  const connected = Boolean(state.connection && ["connected", "error"].includes(state.connection.status));
  // Google refused the grant: only a new consent brings the calendar back.
  const grantDead = state.connection?.status === "error";
  const outcome = state.outcome ? OUTCOME_KEY[state.outcome] : null;
  const calendar = state.calendar;
  const active = calendar?.status === "active";
  const gone = calendar?.status === "lost" && calendar.problem === "gone";
  // Named, not deleted, and not in use: the one the firm had, to be taken back under the grant in hand.
  const retakable = Boolean(calendar && !active && !gone);

  const run = async (action: () => Promise<{ ok: boolean; code: string; url?: string }>) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await action();
      if (!result.ok) {
        setProblem(result.code);
        onChanged();
        return;
      }
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      onChanged();
    } catch {
      setProblem(FAILED);
    } finally {
      setBusy(false);
    }
  };

  /** The confirmed action, answered as the dialog takes it: a message when it failed, nothing when it went. */
  const confirmed = async (action: () => Promise<{ ok: boolean; code: string }>): Promise<string | null> => {
    try {
      const result = await action();
      onChanged();
      return result.ok ? null : t(connectErrorKey(result.code));
    } catch {
      return t(connectErrorKey(FAILED));
    }
  };

  const disconnect = (
    <Button
      variant="outlined"
      color="grey"
      size="small"
      disabled={busy || blocked}
      onClick={() => setConfirming("disconnect")}
    >
      {t("connections-calendar-disconnect")}
    </Button>
  );
  const newCalendar = (
    <Button
      variant="outlined"
      color="grey"
      size="small"
      disabled={busy || blocked}
      onClick={() => setConfirming("recreate")}
    >
      {t("connections-calendar-new")}
    </Button>
  );

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="connections-calendar">
        <CardContent className="flex flex-col gap-4">
          <Box className="flex flex-wrap items-start justify-between gap-2">
            <Box className="flex flex-col gap-1">
              <Typography id="connections-calendar" variant="h5" component="h2" className="mb-0">
                {t("connections-calendar-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("connections-calendar-body")}
              </Typography>
            </Box>
            {connected && (active || calendar?.status === "lost") ? (
              <StatusChip
                tone={active && !grantDead ? "positive" : "attention"}
                label={t(active && !grantDead ? "connections-calendar-active" : "connections-calendar-lost")}
              />
            ) : null}
          </Box>

          {outcome ? (
            <Alert severity={outcome.severity} className="neutral bg-background-paper/60!">
              {t(outcome.key)}
            </Alert>
          ) : null}

          {!state.available ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("connections-calendar-unavailable")}
            </Alert>
          ) : !vault ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("connections-error-vault")}
            </Alert>
          ) : !connected ? (
            <Box className="flex flex-col gap-2">
              <Typography variant="body2" className="text-text-secondary">
                {t("connections-calendar-what")}
              </Typography>
              <Box>
                <Button
                  variant="contained"
                  disabled={busy || blocked}
                  onClick={() => void run(startCalendarConnection)}
                >
                  {busy ? t("cases-working") : t("connections-calendar-connect")}
                </Button>
              </Box>
            </Box>
          ) : grantDead ? (
            <Box className="flex flex-col gap-3">
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("connections-calendar-lost-auth")}
              </Alert>
              <Box className="flex flex-wrap items-center gap-2">
                <Button
                  variant="contained"
                  disabled={busy || blocked}
                  onClick={() => void run(startCalendarConnection)}
                >
                  {t("connections-calendar-reconnect")}
                </Button>
                {disconnect}
              </Box>
            </Box>
          ) : (
            <Box className="flex flex-col gap-3">
              {calendar ? (
                <Typography variant="body2">{t("connections-calendar-name", { name: calendar.name })}</Typography>
              ) : (
                <Typography variant="body2" className="text-text-secondary">
                  {t("connections-calendar-missing")}
                </Typography>
              )}
              {active ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("connections-calendar-share")}
                </Typography>
              ) : gone ? (
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {t("connections-calendar-lost-gone")}
                </Alert>
              ) : retakable && calendar ? (
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {calendar.status === "lost"
                    ? t(PROBLEM_KEY[calendar.problem ?? ""] ?? "connections-calendar-lost-auth")
                    : t("connections-calendar-retake-body", { name: calendar.name })}
                </Alert>
              ) : null}
              <Box className="flex flex-wrap items-center gap-2">
                {retakable ? (
                  <Button variant="contained" disabled={busy || blocked} onClick={() => void run(retakeCalendar)}>
                    {busy ? t("cases-working") : t("connections-calendar-retake")}
                  </Button>
                ) : null}
                {gone || !calendar ? (
                  <Button variant="contained" disabled={busy || blocked} onClick={() => void run(recreateCalendar)}>
                    {busy
                      ? t("cases-working")
                      : t(gone ? "connections-calendar-recreate" : "connections-calendar-create")}
                  </Button>
                ) : (
                  newCalendar
                )}
                {disconnect}
              </Box>
            </Box>
          )}

          {problem ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(connectErrorKey(problem))}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {confirming === "recreate" ? (
        <ConfirmActionDialog
          requireReason={false}
          title={t("connections-calendar-recreate-title")}
          consequences={[t("connections-calendar-recreate-does-1"), t("connections-calendar-recreate-does-2")]}
          staysTitle={t("connections-calendar-confirm-stays")}
          stays={[t("connections-calendar-recreate-stays")]}
          confirmLabel={t("connections-calendar-new")}
          cancelLabel={t("connections-calendar-cancel")}
          busyLabel={t("cases-working")}
          onConfirm={() => confirmed(recreateCalendar)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "disconnect" ? (
        <ConfirmActionDialog
          requireReason={false}
          tone="danger"
          title={t("connections-calendar-disconnect-title")}
          consequences={[t("connections-calendar-disconnect-does-1"), t("connections-calendar-disconnect-does-2")]}
          staysTitle={t("connections-calendar-confirm-stays")}
          stays={[t("connections-calendar-disconnect-stays")]}
          confirmLabel={t("connections-calendar-disconnect")}
          cancelLabel={t("connections-calendar-cancel")}
          busyLabel={t("cases-working")}
          onConfirm={() => confirmed(disconnectCalendar)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </Grid>
  );
}
