"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, FormControl, FormLabel, Input, Typography } from "@mui/material";

import {
  confirmTotp,
  dropTotp,
  qrSrc,
  startTotpEnrollment,
  type TotpEnrollment,
  verifiedTotp,
} from "@/lib/security/second-factor";

/**
 * The second factor where an action asks for it, without leaving the screen:
 * what the action needs it for, then, for an account with none, its setup
 * right here (the code the authenticator app reads, its key, a code back),
 * and for a session that has not confirmed its factor, the code alone. Once
 * confirmed, the screen goes on with the session at the second level.
 *
 * Closest to the security card (settings/security), whose setup it shares
 * (`lib/security/second-factor.ts`): that card is where a factor is kept, and
 * this is the moment an action needs one, so a step is never left for another
 * screen it may not come back from. The neutral warning Alert every screen
 * says a missing factor with, the actions under the words so a phone never
 * squeezes them.
 */
export default function SecondFactorPrompt({
  id,
  state,
  reason,
  onConfirmed,
}: {
  /** Unique on the screen: names the field of the code. */
  id: string;
  /** No factor on the account (set it up here), or one this session has not confirmed (the code). */
  state: "missing" | "challenge";
  /** What the action needs the factor for, in one sentence. */
  reason: string;
  onConfirmed: () => void;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asking = state === "challenge" || enrollment !== null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await startTotpEnrollment(t("security-authenticator"));
      if (started) {
        setEnrollment(started);
        setCode("");
      } else setError(t("security-action-error"));
    } catch {
      setError(t("security-action-error"));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (code.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const factorId = enrollment?.factorId ?? (await verifiedTotp());
      const confirmed = factorId ? await confirmTotp(factorId, code) : "failed";
      if (confirmed !== "ok") {
        const refused = confirmed === "code" ? "security-code-error" : "security-action-error";
        setError(t(refused));
        return;
      }
      setEnrollment(null);
      setCode("");
      // The session is at the second level now; what the server reads says so on its next request.
      router.refresh();
      onConfirmed();
    } catch {
      setError(t("security-action-error"));
    } finally {
      setBusy(false);
    }
  };

  // A setup given up leaves no factor half made behind it.
  const cancel = async () => {
    const factorId = enrollment?.factorId ?? null;
    setEnrollment(null);
    setCode("");
    setError(null);
    if (factorId) await dropTotp(factorId).catch(() => undefined);
  };

  return (
    <Box className="flex flex-col gap-2">
      <Alert severity="warning" className="neutral bg-background-paper/60!">
        <Box className="flex flex-col gap-3">
          <Typography variant="body1">{reason}</Typography>
          {!asking ? (
            <>
              <Typography variant="body2" className="text-text-secondary">
                {t("second-factor-prompt-missing")}
              </Typography>
              <Box>
                <Button variant="outlined" color="grey" size="small" disabled={busy} onClick={() => void start()}>
                  {busy ? t("cases-working") : t("second-factor-prompt-start")}
                </Button>
              </Box>
            </>
          ) : (
            <>
              {enrollment ? (
                <>
                  <Typography variant="body2">{t("security-scan")}</Typography>
                  {/* Dark modules on white whatever the theme: an app reads a code only on a light ground. */}
                  <img
                    src={qrSrc(enrollment.qrCode)}
                    alt={t("security-qr-alt")}
                    className="h-40 w-40 self-start rounded-xl bg-white p-2"
                  />
                  <Typography variant="body2" className="text-text-secondary break-all">
                    {t("security-secret")}: {enrollment.secret}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" className="text-text-secondary">
                  {t("second-factor-prompt-challenge")}
                </Typography>
              )}
              <Box className="flex flex-row flex-wrap items-end gap-2">
                <FormControl className="outlined mb-0" variant="standard" size="small">
                  <FormLabel component="label" htmlFor={`${id}-code`}>
                    {t("security-code")}
                  </FormLabel>
                  <Input
                    id={`${id}-code`}
                    value={code}
                    autoComplete="one-time-code"
                    disabled={busy}
                    inputProps={{ inputMode: "numeric", maxLength: 6 }}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitCode();
                    }}
                  />
                </FormControl>
                <Button
                  variant="contained"
                  size="small"
                  disabled={code.length < 6 || busy}
                  onClick={() => void submitCode()}
                >
                  {busy ? t("security-verifying") : t("security-confirm")}
                </Button>
                {enrollment ? (
                  <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => void cancel()}>
                    {t("cancel")}
                  </Button>
                ) : null}
              </Box>
            </>
          )}
        </Box>
      </Alert>
      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
