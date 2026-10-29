"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button } from "@mui/material";

import { acceptPartnerInvitation } from "@/lib/partners/actions";
import { PARTNER_AREA, partnerErrorKey } from "@/lib/partners/partner";
import { enterAfterSessionChange } from "@/lib/safe-next";

/** Accepts the invitation to a partner for the signed-in account, then opens the partner's area. */
export function AcceptPartnerInvitationButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    const result = await acceptPartnerInvitation(invitationId).catch(() => ({ ok: false as const, code: "failed" }));
    if (!result.ok) {
      setErrorCode(result.code);
      setBusy(false);
      return;
    }
    await enterAfterSessionChange(PARTNER_AREA);
  };

  return (
    <Box className="flex flex-col gap-3">
      {errorCode && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(partnerErrorKey(errorCode))}
        </Alert>
      )}
      <Button variant="contained" onClick={() => void accept()} disabled={busy}>
        {t("partner-invite-accept")}
      </Button>
    </Box>
  );
}
