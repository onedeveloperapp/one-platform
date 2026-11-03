"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import VerificationCodeInput from "@/components/auth/verification-code-input";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import {
  confirmTotp,
  dropTotp,
  qrSrc,
  startTotpEnrollment,
  type TotpEnrollment,
  verifiedTotp,
} from "@/lib/security/second-factor";
import { cn } from "@/lib/utils";

const CODE_LENGTH = 6;

/**
 * The second factor where a flow asks for it, without leaving the screen: for
 * an account with none, its setup right here (start, then the QR the
 * authenticator app reads with its key beside it, then the code back), and
 * for a session that has not confirmed its factor, the code alone. Once
 * confirmed, the screen goes on with the session at the second level.
 *
 * The one setup of a factor in the app: the first step of the firm's setup,
 * so a step is never left for another screen it may not come back from, and
 * the security card (settings/security), where a factor is kept, both render
 * it over `lib/security/second-factor.ts`, so the two never differ. The code
 * is typed in the six boxes of the sign-in's second factor
 * (`components/auth/verification-code-input.tsx`), which confirm by themselves
 * at the sixth digit and take a pasted code; the QR and its key sit together
 * in a bordered panel, as the Pix code does at checkout. Neutral, never a
 * warning: setting the factor up is the step's work, not a fault.
 */
export default function SecondFactorPrompt({
  state,
  reason,
  onConfirmed,
}: {
  /** No factor on the account (set it up here), or one this session has not confirmed (the code). */
  state: "missing" | "challenge";
  /** What the flow needs the factor for, in one sentence, where the screen around it does not say it already. */
  reason?: string;
  onConfirmed: () => void;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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

  // The code the boxes just completed, when they hand it over: the state of this render has not seen its last digit.
  const submitCode = async (completed?: string) => {
    const typed = completed ?? code;
    if (typed.length < CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      const factorId = enrollment?.factorId ?? (await verifiedTotp());
      const confirmed = factorId ? await confirmTotp(factorId, typed) : "failed";
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

  const copyKey = async () => {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3_000);
    } catch {
      // The clipboard may be refused; the key is written out beside the button, selectable.
    }
  };

  const codeField = (
    <Box className="flex flex-col gap-3">
      {/* Six boxes the width of a code, as at sign-in: across a wide card each would be a field of its own. */}
      <Box className="max-w-sm">
        <VerificationCodeInput
          label={t("security-code")}
          value={code}
          length={CODE_LENGTH}
          onChange={(next) => {
            setCode(next);
            if (error) setError(null);
          }}
          onComplete={(value) => void submitCode(value)}
          // Focus goes to the boxes only after the person started the setup: on a screen that just opened, a box
          // taking the focus would scroll a phone past what the step says.
          autoFocus={enrollment !== null}
          disabled={busy}
        />
      </Box>
      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {error}
        </Alert>
      ) : null}
      <Box className="flex flex-row flex-wrap items-center gap-2">
        <Button variant="contained" disabled={code.length < CODE_LENGTH || busy} onClick={() => void submitCode()}>
          {busy ? t("security-verifying") : t("security-confirm")}
        </Button>
        {enrollment ? (
          <Button variant="text" color="grey" disabled={busy} onClick={() => void cancel()}>
            {t("cancel")}
          </Button>
        ) : null}
      </Box>
    </Box>
  );

  // A numbered step of the setup: the order is the point (the app reads the QR before it shows a code).
  const stepMark = (position: number) => (
    <span
      aria-hidden
      className={cn(
        "flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-semibold",
        TILE_TONE.primary.bg,
        TILE_TONE.primary.text,
      )}
    >
      {position}
    </span>
  );

  return (
    <Box className="border-grey-200 flex flex-col gap-4 rounded-2xl border p-5">
      {reason ? <Typography variant="body1">{reason}</Typography> : null}

      {!asking ? (
        <Box className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span
            className={cn(
              "flex h-12 w-12 flex-none items-center justify-center rounded-2xl",
              TILE_TONE.primary.bg,
              TILE_TONE.primary.text,
            )}
          >
            <NiShieldCheck size="medium" />
          </span>
          <Typography variant="body1" className="text-text-secondary flex-1">
            {t("second-factor-prompt-missing")}
          </Typography>
          <Button
            variant="contained"
            className="flex-none self-start sm:self-auto"
            disabled={busy}
            onClick={() => void start()}
          >
            {busy ? t("cases-working") : t("second-factor-prompt-start")}
          </Button>
        </Box>
      ) : enrollment ? (
        <Box component="ol" className="m-0 flex list-none flex-col gap-5 p-0">
          <Box component="li" className="flex flex-col gap-3">
            <Box className="flex flex-row items-start gap-2">
              {stepMark(1)}
              <Typography variant="body1">{t("second-factor-prompt-scan")}</Typography>
            </Box>
            <Box className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {/* Dark modules on white whatever the theme: an app reads a code only on a light ground. */}
              <img
                src={qrSrc(enrollment.qrCode)}
                alt={t("security-qr-alt")}
                className="border-grey-100 h-44 w-44 flex-none rounded-xl border bg-white p-2"
              />
              <Box className="flex min-w-0 flex-col gap-2">
                <Typography variant="body2" className="text-text-secondary">
                  {t("second-factor-prompt-key")}
                </Typography>
                {/* In groups of four, as the apps show it, a line breaking only between groups; the copy is the key
                    as it is. */}
                <Typography
                  variant="body1"
                  component="code"
                  className="bg-grey-25 rounded-lg px-3 py-2 font-mono tracking-wider break-words select-all"
                >
                  {enrollment.secret.match(/.{1,4}/g)?.join(" ")}
                </Typography>
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  className="self-start"
                  onClick={() => void copyKey()}
                >
                  {copied ? t("second-factor-prompt-copied") : t("second-factor-prompt-copy")}
                </Button>
              </Box>
            </Box>
          </Box>
          <Box component="li" className="flex flex-col gap-3">
            <Box className="flex flex-row items-start gap-2">
              {stepMark(2)}
              <Typography variant="body1">{t("second-factor-prompt-type")}</Typography>
            </Box>
            {codeField}
          </Box>
        </Box>
      ) : (
        <Box className="flex flex-col gap-3">
          <Typography variant="body1" className="text-text-secondary">
            {t("second-factor-prompt-challenge")}
          </Typography>
          {codeField}
        </Box>
      )}

      {!asking && error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
