"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, CircularProgress, TextField, Typography } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import { createClient } from "@flyee/auth/client";
import type { PixCharge } from "@flyee/billing/types";

/** How often the page asks whether the provider confirmed. */
const POLL_MS = 4_000;
/**
 * When the page stops asking on its own. A PIX normally confirms in seconds;
 * past this point the webhook is late, not the payment. Access is released by
 * the webhook either way — this only decides when the SCREEN stops waiting.
 */
const POLL_CAP_MS = 20 * 60_000;
/**
 * The "I paid" button appears once the page has checked this many times and
 * the charge is still open: the honest moment to offer it is after we have
 * looked and not yet seen it, never a countdown we invented.
 */
const CHECKS_BEFORE_PAID_BUTTON = 2;

/** Where she goes once the payment is confirmed, or when she stops waiting. */
const AFTER_PAYMENT = "/inicio";

type Phase = "waiting" | "confirmed" | "timeout";

/**
 * The PIX charge, on OUR page instead of the provider's.
 *
 * The charge, the QR and the hosted invoice are exactly the provider's — the
 * hosted page stays one tap away as the fallback. Confirmation is the
 * WEBHOOK's job, never this page's: for a subscription the row stays
 * `incomplete` until the provider confirms; for the one-time kit the grant
 * appears when the paid invoice arrives. That is all this reads.
 */
export default function PixPaymentPanel({
  pix,
  orgId,
  planId,
  planName,
  priceLabel,
  oneTime,
}: {
  pix: PixCharge;
  orgId: string;
  planId: string;
  planName: string;
  priceLabel: string;
  /** The kit: a grant, not a subscription, and nothing renews. */
  oneTime: boolean;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [checks, setChecks] = useState(0);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (phase !== "waiting") return;
    let active = true;
    const poll = async () => {
      // A hidden tab keeps its place but stops spending queries.
      if (!active || document.visibilityState === "hidden") return;
      if (Date.now() - startedAt.current > POLL_CAP_MS) {
        setPhase("timeout");
        return;
      }
      try {
        const supabase = createClient();
        let confirmed = false;
        if (oneTime) {
          const { data } = await supabase
            .from("entitlement_grants")
            .select("id")
            .eq("org_id", orgId)
            .eq("plan_id", planId)
            .is("revoked_at", null)
            .limit(1)
            .maybeSingle();
          confirmed = Boolean(data);
        } else {
          const { data } = await supabase
            .from("subscriptions")
            .select("status")
            .eq("org_id", orgId)
            .eq("plan_id", planId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          confirmed = data?.status === "active" || data?.status === "trialing";
        }
        if (!active) return;
        if (confirmed) {
          setPhase("confirmed");
          return;
        }
        setChecks((count) => count + 1);
      } catch {
        // A transient failure must not turn a payable code into an error.
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [oneTime, orgId, phase, planId]);

  // Confirmed while she was looking: say so, then take her on.
  useEffect(() => {
    if (phase !== "confirmed") return;
    const timer = window.setTimeout(() => router.push(AFTER_PAYMENT), 2_500);
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pix.copyPaste);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3_000);
    } catch {
      // Clipboard can be refused (permissions, insecure context). The field
      // below is selectable, so the code is never out of reach.
    }
  };

  if (phase === "confirmed") {
    return (
      <Box className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
        <span className="bg-accent-1/15 text-accent-1 flex h-14 w-14 items-center justify-center rounded-2xl">
          <NiCheck size="large" />
        </span>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("pix-confirmed-title")}
        </Typography>
        <Typography variant="body1" className="text-text-secondary">
          {t("pix-confirmed-body", { plan: planName })}
        </Typography>
      </Box>
    );
  }

  // PIX is a Brazilian rail: the provider's expiry is shown in Brasília time.
  const expires = pix.expiresAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(pix.expiresAt))
    : null;

  return (
    <Box className="flex flex-col gap-5">
      <Box className="flex flex-col gap-1">
        <Typography variant="h1" component="h1" className="mb-0">
          {t("pix-title")}
        </Typography>
        <Typography variant="body1" className="text-text-secondary">
          {t("pix-subtitle", { plan: planName, price: priceLabel })}
        </Typography>
      </Box>

      <Box className="border-grey-200 flex flex-col items-center gap-4 rounded-2xl border p-5 sm:flex-row sm:items-start">
        <Box
          component="img"
          src={`data:image/png;base64,${pix.qrCodeBase64}`}
          alt={t("pix-qr-alt", { plan: planName })}
          className="h-52 w-52 flex-none rounded-xl bg-white p-2"
        />
        <Box className="flex w-full min-w-0 flex-col gap-3">
          <TextField
            label={t("pix-copy-label")}
            value={pix.copyPaste}
            fullWidth
            size="small"
            multiline
            maxRows={3}
            slotProps={{ htmlInput: { readOnly: true, "aria-readonly": true } }}
            onFocus={(event) => event.target.select()}
          />
          <Button variant="outlined" onClick={() => void copy()} className="self-start">
            {copied ? t("pix-copied") : t("pix-copy")}
          </Button>
          {/* The provider's own instant, not a countdown we invented. */}
          {expires && (
            <Typography variant="body2" className="text-text-secondary">
              {t("pix-expires", { date: expires })}
            </Typography>
          )}
        </Box>
      </Box>

      {/* On PIX a subscription does NOT renew by itself: each cycle is a new
          code she pays by hand. The kit is paid once and has nothing to renew. */}
      {!oneTime && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("pix-renewal-note")}
        </Alert>
      )}

      {phase === "timeout" ? (
        <Alert severity="info">{t("pix-timeout")}</Alert>
      ) : (
        <Box className="flex items-center gap-3" role="status" aria-live="polite">
          <CircularProgress size={18} aria-hidden />
          <Typography variant="body2" className="text-text-secondary">
            {t("pix-waiting")}
          </Typography>
        </Box>
      )}

      {(checks >= CHECKS_BEFORE_PAID_BUTTON || phase === "timeout") && (
        <Box className="flex flex-col gap-2">
          <Button variant="contained" size="large" onClick={() => router.push(AFTER_PAYMENT)}>
            {t("pix-paid-continue")}
          </Button>
          <Typography variant="body2" className="text-text-secondary text-center">
            {t("pix-paid-note")}
          </Typography>
        </Box>
      )}

      {pix.invoiceUrl && (
        <Typography variant="body2" className="text-text-secondary text-center">
          {t("pix-trouble")}{" "}
          <a href={pix.invoiceUrl} className="link-primary" rel="noopener noreferrer">
            {t("pix-open-invoice")}
          </a>
          .
        </Typography>
      )}
    </Box>
  );
}
