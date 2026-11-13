"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { caseErrorKey } from "@/lib/cases/cases";
import type { ClientCivilCourtItem } from "@/lib/cases/client-link";
import { answerCivilCourt } from "@/lib/cases/client-link-actions";

/** The answers after which the page reads again: the words changed, or the question is no longer open. */
const READ_AGAIN = new Set(["wording_changed", "not_asked"]);

const day = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
        new Date(iso),
      )
    : "";

/**
 * The claims the client answers for that go to the civil court: their own
 * and their children's. Each in the words the firm's link shows, accepted or
 * not on its own; the answer stays on record and may change while the
 * lawsuit is not filed. A "no" holds the filing until the firm talks to
 * them, and taking back a "yes" is asked twice.
 */
export default function ClientCivilCourt({
  token,
  items,
  onSaved,
}: {
  token: string;
  /** None when it could not be read: the section is then left out. */
  items: ClientCivilCourtItem[] | null;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!items || items.length === 0) return null;

  const answer = async (item: ClientCivilCourtItem, accepted: boolean) => {
    if (!item.wording) return;
    setBusy(item.party_id);
    setProblem(null);
    try {
      const result = await answerCivilCourt(token, item.party_id, accepted, item.wording);
      if (!result.ok) {
        setProblem(result.code);
        if (READ_AGAIN.has(result.code)) onSaved();
      } else {
        setConfirming(null);
        onSaved();
      }
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ClientSection id="client-civil-court" title={t("client-civil-title")} lead={t("client-civil-body")}>
      {items.map((item) => (
        <Box key={item.party_id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Box className="flex flex-wrap items-center justify-between gap-2">
            <Typography variant="body1" className="font-semibold">
              {item.minor ? t("client-civil-minor", { name: item.name }) : t("client-civil-own")}
            </Typography>
            {item.accepted === true ? (
              <StatusChip
                tone="positive"
                label={
                  item.source === "firm"
                    ? t("client-civil-firm", { date: day(item.recorded_at) })
                    : t("client-civil-accepted", { date: day(item.recorded_at) })
                }
              />
            ) : item.accepted === false ? (
              <StatusChip tone="attention" label={t("client-civil-declined", { date: day(item.recorded_at) })} />
            ) : null}
          </Box>
          {item.wording ? (
            <Typography variant="body1" className="text-text-primary">
              {item.wording}
            </Typography>
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {t("client-civil-unavailable")}
            </Typography>
          )}
          {item.accepted === false && (
            <Typography variant="body2" className="text-text-secondary">
              {t("client-civil-declined-hint")}
            </Typography>
          )}
          {item.wording && confirming === item.party_id ? (
            <Box className="flex flex-col gap-2">
              <Typography variant="body2">{t("client-civil-confirm-no")}</Typography>
              <Box className="flex flex-wrap gap-2">
                <Button
                  variant="contained"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => void answer(item, false)}
                >
                  {busy === item.party_id ? t("client-working") : t("client-civil-confirm-no-action")}
                </Button>
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => setConfirming(null)}
                >
                  {t("client-civil-keep")}
                </Button>
              </Box>
            </Box>
          ) : item.wording ? (
            <Box className="flex flex-wrap gap-2">
              {item.accepted !== true && (
                <Button
                  variant="contained"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => void answer(item, true)}
                >
                  {busy === item.party_id ? t("client-working") : t("client-civil-accept")}
                </Button>
              )}
              {item.accepted === true ? (
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => setConfirming(item.party_id)}
                >
                  {t("client-civil-change")}
                </Button>
              ) : item.accepted === null ? (
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => void answer(item, false)}
                >
                  {t("client-civil-decline")}
                </Button>
              ) : null}
            </Box>
          ) : null}
        </Box>
      ))}
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(caseErrorKey(problem))}
        </Alert>
      ) : null}
    </ClientSection>
  );
}
