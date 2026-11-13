"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button } from "@mui/material";

import StateLine from "@/components/product/state-line";
import NiEmail from "@/icons/nexture/ni-email";
import { readClientMarketing, setClientMarketing } from "@/lib/cases/client-link-actions";

/**
 * The client's word on the firm's marketing, on their own link (migration 0133): they ask not to receive it, or to
 * receive it again. It never stops the notices of their lawsuit, and the card says so. Hidden while it cannot be read.
 */
export default function ClientMarketing({ token, editable }: { token: string; editable: boolean }) {
  const t = useTranslations("product");
  const [off, setOff] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void readClientMarketing(token)
      .then((answer) => {
        if (live && answer.ok) setOff(answer.off);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token]);

  if (off === null) return null;

  const change = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const answer = await setClientMarketing(token, !off);
      if (answer.ok) setOff(answer.off);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ClientSection id="client-marketing" icon={<NiEmail size="medium" />} title={t("client-marketing-title")} gap={3}>
      {failed ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t("client-marketing-failed")}
        </Alert>
      ) : null}
      <StateLine tone={off ? "done" : "info"}>{t(off ? "client-marketing-off" : "client-marketing-on")}</StateLine>
      <StateLine tone="info">{t("client-marketing-notices")}</StateLine>
      {editable ? (
        <Box>
          <Button variant="outlined" color="grey" disabled={busy} onClick={() => void change()}>
            {t(off ? "client-marketing-resume" : "client-marketing-stop")}
          </Button>
        </Box>
      ) : null}
    </ClientSection>
  );
}
