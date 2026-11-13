"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";

import OutcomeDialog, { type OutcomeLine } from "@/components/product/outcome-dialog";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiArrowHistory from "@/icons/nexture/ni-arrow-history";
import NiBell from "@/icons/nexture/ni-bell";
import NiBellInactive from "@/icons/nexture/ni-bell-inactive";
import NiLink from "@/icons/nexture/ni-link";
import NiPhone from "@/icons/nexture/ni-phone";
import { caseErrorKey } from "@/lib/cases/cases";
import type { ClientNotices as ClientNoticesView } from "@/lib/cases/client-link";
import { setClientNotices } from "@/lib/cases/client-link-actions";
import { momentIn } from "@/lib/hearings/hearings";
import { phoneLabel } from "@/lib/whatsapp/conversations";

/** What a refusal of the client's answer is called: the notices' own, then the link's. */
const NOTICE_ERROR_KEY: Record<string, string> = {
  too_many: "client-notices-error-too-many",
  no_phone: "client-notices-error-no-phone",
};
const clientNoticeErrorKey = (code: string): string => NOTICE_ERROR_KEY[code] ?? caseErrorKey(code);

/**
 * Where the notices of the client's lawsuit go on WhatsApp, said, never asked
 * (the owner, 2026-11-03): they are the firm's only way to the client, and a
 * client who never answered would miss a hearing. The card says where they go
 * and what they bring; stopping them is the client's, confirmed before (what
 * they lose: a hearing missed may end the lawsuit) and said whole after, as
 * being told again is.
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
  const [leaving, setLeaving] = useState(false);
  const [outcome, setOutcome] = useState<"stopped" | "resumed" | null>(null);
  // A firm that tells its clients nothing on WhatsApp has nothing to say here; a client who stopped may still undo it.
  if (!notices || (!notices.active && !notices.stopped)) return null;

  const phone = notices.phone ? phoneLabel(notices.phone) : null;
  const firm = notices.firm ?? "";

  const answer = async (receive: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setClientNotices(token, receive);
      if (!result.ok) {
        setProblem(result.code);
        return;
      }
      setLeaving(false);
      if (result.code === "stopped" || result.code === "resumed") setOutcome(result.code);
      onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  const outcomeLines = (): OutcomeLine[] =>
    outcome === "stopped"
      ? [
          { key: "none", icon: <NiBellInactive size="medium" />, text: t("client-notices-outcome-stopped-none") },
          { key: "link", icon: <NiLink size="medium" />, text: t("client-notices-outcome-stopped-link") },
          { key: "back", icon: <NiArrowHistory size="medium" />, text: t("client-notices-outcome-stopped-back") },
        ]
      : [
          {
            key: "where",
            icon: <NiPhone size="medium" />,
            text: phone ? t("client-notices-going", { phone, firm }) : t("client-notices-going-plain", { firm }),
          },
          { key: "stop", icon: <NiBellInactive size="medium" />, text: t("client-notices-how-to-stop") },
        ];

  const chip = !notices.phone ? (
    <StatusChip tone="attention" label={t("client-notices-chip-no-phone")} />
  ) : notices.stopped || notices.opted_out ? (
    <StatusChip tone="neutral" label={t("client-notices-chip-stopped")} />
  ) : (
    <StatusChip tone="positive" label={t("client-notices-chip-on")} />
  );

  return (
    <ClientSection
      id="client-notices"
      icon={<NiBell size="medium" />}
      tone="primary"
      title={t("client-notices-title")}
      chip={chip}
      gap={3}
    >
      {!notices.phone ? (
        <StateLine tone="attention">
          {editable ? t("client-notices-no-phone-editable") : t("client-notices-no-phone")}
        </StateLine>
      ) : notices.opted_out ? (
        <StateLine tone="info">{t("client-notices-opted-out")}</StateLine>
      ) : notices.stopped ? (
        <StateLine
          tone="attention"
          emphasis
          icon={<NiBellInactive size="medium" />}
          action={
            <Button variant="contained" disabled={busy} onClick={() => void answer(true)}>
              {t("client-notices-resume")}
            </Button>
          }
        >
          <strong>
            {notices.stopped_at
              ? t("client-notices-stopped", { day: momentIn(notices.stopped_at, "America/Sao_Paulo").day })
              : t("client-notices-stopped-undated")}
          </strong>{" "}
          {t("client-notices-stopped-risk")}
        </StateLine>
      ) : (
        <>
          <StateLine tone="done" emphasis icon={<NiPhone size="medium" />}>
            {t("client-notices-going", { phone: phone ?? "", firm })}
          </StateLine>
          <Typography variant="body2" className="text-text-secondary">
            {t("client-notices-what")}
          </Typography>
          <Box>
            <Button variant="text" color="grey" disabled={busy} onClick={() => setLeaving(true)}>
              {t("client-notices-stop")}
            </Button>
          </Box>
        </>
      )}
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(clientNoticeErrorKey(problem))}
        </Alert>
      ) : null}

      {leaving ? (
        <Dialog open onClose={busy ? undefined : () => setLeaving(false)} aria-labelledby="client-notices-leave-title">
          <DialogTitle id="client-notices-leave-title">{t("client-notices-stop-title")}</DialogTitle>
          <DialogContent>
            <Typography variant="body1">{t("client-notices-stop-body")}</Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="text" color="grey" disabled={busy} onClick={() => setLeaving(false)}>
              {t("client-notices-stop-keep")}
            </Button>
            <Button variant="contained" color="error" disabled={busy} onClick={() => void answer(false)}>
              {t("client-notices-stop-confirm")}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {outcome ? (
        <OutcomeDialog
          open
          tone={outcome === "resumed" ? "done" : "info"}
          title={
            outcome === "resumed"
              ? t("client-notices-outcome-resumed-title")
              : t("client-notices-outcome-stopped-title")
          }
          lines={outcomeLines()}
          closeLabel={t("client-notices-outcome-ok")}
          onClose={() => setOutcome(null)}
        />
      ) : null}
    </ClientSection>
  );
}
