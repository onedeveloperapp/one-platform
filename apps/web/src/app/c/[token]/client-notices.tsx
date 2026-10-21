"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import { caseErrorKey } from "@/lib/cases/cases";
import type { ClientNotices as ClientNoticesView } from "@/lib/cases/client-link";
import { setClientNotices } from "@/lib/cases/client-link-actions";
import { momentIn } from "@/lib/hearings/hearings";

/** What a refusal of the client's answer is called: the notices' own, then the link's. */
const NOTICE_ERROR_KEY: Record<string, string> = {
  wording_changed: "client-notices-error-changed",
  too_many: "client-notices-error-too-many",
  no_phone: "client-notices-error-no-phone",
};
const clientNoticeErrorKey = (code: string): string => NOTICE_ERROR_KEY[code] ?? caseErrorKey(code);

/**
 * Whether the client is told of their lawsuit on WhatsApp: the words they
 * agree to, for the number the firm has for them, one click; and the way
 * back. The firm's notices go only to who agreed here, or whom the firm
 * recorded as having agreed.
 */
export default function ClientNotices({
  token,
  notices,
  editable,
  onSaved,
}: {
  token: string;
  notices: ClientNoticesView | null;
  /** The client may still write their data on this page (their WhatsApp among it). */
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A firm that tells its clients nothing on WhatsApp asks for no agreement; one already given can still be taken back.
  if (!notices || (!notices.active && !notices.agreed)) return null;

  const save = async (agree: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setClientNotices(token, agree, agree ? notices.wording : null);
      if (!result.ok) {
        setProblem(result.code);
        // The number or the words changed since the page was read: it reads them again before anything is agreed.
        if (result.code === "wording_changed") onSaved();
      } else onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card component="section" aria-labelledby="client-notices">
      <CardContent className="flex flex-col gap-3">
        <Typography id="client-notices" variant="h5" component="h2" className="mb-0">
          {t("client-notices-title")}
        </Typography>
        {!notices.phone ? (
          <Typography variant="body1">
            {editable ? t("client-notices-no-phone-editable") : t("client-notices-no-phone")}
          </Typography>
        ) : notices.opted_out ? (
          <Typography variant="body1">{t("client-notices-opted-out")}</Typography>
        ) : notices.agreed ? (
          <Box className="flex flex-col gap-2">
            <Typography variant="body1">
              {!notices.active
                ? t("client-notices-agreed-idle")
                : notices.agreed_at
                  ? t("client-notices-agreed", { day: momentIn(notices.agreed_at, "America/Sao_Paulo").day })
                  : t("client-notices-agreed-undated")}
            </Typography>
            <Box>
              <Button variant="outlined" color="grey" disabled={busy} onClick={() => void save(false)}>
                {t("client-notices-stop")}
              </Button>
            </Box>
          </Box>
        ) : (
          <Box className="flex flex-col gap-2">
            <Typography variant="body1" className="text-text-primary">
              {notices.wording}
            </Typography>
            <Box>
              <Button variant="contained" disabled={busy} onClick={() => void save(true)}>
                {t("client-notices-agree")}
              </Button>
            </Box>
          </Box>
        )}
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(clientNoticeErrorKey(problem))}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
