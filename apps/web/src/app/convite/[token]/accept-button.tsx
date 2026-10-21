"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button } from "@mui/material";

import { DEFAULTS } from "@/config";
import { acceptInvitation } from "@/lib/firm/actions";
import { createClient } from "@flyee/auth/client";

/** The errors the invitation page has words for; anything else reads as "try again". */
const ERROR_KEYS: Record<string, string> = {
  already_in_a_firm: "invite-already-in-firm",
  expired: "firm-error-expired",
  revoked: "firm-error-revoked",
  seat_limit: "firm-error-seat-limit",
  email_not_confirmed: "firm-error-email-not-confirmed",
  not_found: "firm-error-not-found",
  already_accepted: "firm-error-already-accepted",
};

/** Accepts the invitation for the signed-in account, then opens the app. */
export function AcceptInvitationButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    const result = await acceptInvitation(invitationId);
    if (!result.ok) {
      setErrorCode(result.code);
      setBusy(false);
      return;
    }
    router.push(DEFAULTS.appRoot);
    router.refresh();
  };

  return (
    <Box className="flex flex-col gap-3">
      {errorCode && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(ERROR_KEYS[errorCode] ?? "firm-error-failed")}
        </Alert>
      )}
      <Button variant="contained" onClick={() => void accept()} disabled={busy}>
        {t("invite-accept")}
      </Button>
    </Box>
  );
}

/** Signs the current account out and comes back to this invitation, to enter with the invited address. */
export function SwitchAccountButton({ next }: { next: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const switchAccount = async () => {
    if (busy) return;
    setBusy(true);
    await createClient().auth.signOut();
    router.replace(`/auth/sign-in?next=${encodeURIComponent(next)}`);
    router.refresh();
  };

  return (
    <Button variant="outlined" color="grey" onClick={() => void switchAccount()} disabled={busy}>
      {t("invite-switch")}
    </Button>
  );
}
