"use client";

import type { CaseDossier, CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, CircularProgress, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import MetricBars from "@/components/product/metric-bars";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import { openCaseDossier, requestCaseDossier } from "@/lib/cases/dossier-actions";

type Ready = Extract<CaseState, { kind: "ready" }>;

/** The answers of the dossier's actions a screen has words for; anything else is "failed". */
const ERROR_KEY: Record<string, string> = {
  in_course: "dossier-error-in-course",
  not_allowed_in_support_session: "dossier-error-support",
  case_not_found: "dossier-error-not-found",
  not_found: "dossier-error-not-found",
  backend_not_configured: "dossier-error-unavailable",
  not_recorded: "dossier-error-not-recorded",
};
const errorKey = (code: string): string => ERROR_KEY[code] ?? "dossier-error-failed";

/** How long a dossier asked for is said to be on its way: what the database waits before taking it as given up. */
const IN_COURSE_MS = 2 * 60 * 1000;

/** What a dossier holds, in the order it says it. */
const HOLDS: [keyof CaseDossier["summary"], string][] = [
  ["people", "dossier-holds-people"],
  ["registry_checks", "dossier-holds-registry"],
  ["links_finished", "dossier-holds-links"],
  ["consents", "dossier-holds-consents"],
  ["signatures", "dossier-holds-signatures"],
  ["statements_confirmed", "dossier-holds-statements"],
  ["complaints", "dossier-holds-complaints"],
  ["documents", "dossier-holds-documents"],
];

/**
 * The dossier of the case. Somebody of the firm comes here when a court (or
 * anybody) asks whether the case is of a real person who knows of it: one
 * click writes, from what is on record now, who each person is and how that
 * was checked, what they did, accepted and signed, what they told and what
 * was tried before suing, and issues it as a document of the firm with a
 * code anybody can check. What is not on record is said in it as such. The
 * card shows the latest one, what it holds, and the way to write another.
 */
export default function DossierCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  // What the card is doing right now ("generate", or the id of the dossier being opened): each button says
  // its own work, and none is pressed twice.
  const [busy, setBusy] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const dossiers = state.pieces.dossiers;
  const issued = dossiers.filter((dossier) => dossier.status === "issued");
  const latest = issued[0] ?? null;
  // The last request, when it is not the dossier shown: one being written by somebody, or one that did not finish.
  const last = dossiers[0] ?? null;
  // A request is being written for a moment only: one older than that never finished (the database gives
  // it up as abandoned when somebody asks again), and is said so.
  const [now] = useState(() => Date.now());
  const recent = last !== null && now - last.requestedAt < IN_COURSE_MS;
  const inCourse = busy !== "generate" && last?.status === "requested" && recent;
  const unfinished = busy !== "generate" && (last?.status === "failed" || (last?.status === "requested" && !recent));

  const generate = async () => {
    if (busy) return;
    setBusy("generate");
    setErrorCode(null);
    try {
      const result = await requestCaseDossier(state.case.id);
      if (!result.ok) setErrorCode(result.code);
      onChanged();
    } catch {
      setErrorCode("failed");
    } finally {
      setBusy(null);
    }
  };

  const open = async (dossierId: string) => {
    if (busy) return;
    setBusy(dossierId);
    setErrorCode(null);
    try {
      const link = await openCaseDossier(dossierId);
      if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
      else setErrorCode(link.code);
    } catch {
      setErrorCode("failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card component="section" aria-labelledby="case-dossier">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-col gap-1">
          <Typography id="case-dossier" variant="h5" component="h2" className="mb-0">
            {t("dossier-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("dossier-body")}
          </Typography>
        </Box>

        {errorCode ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            onClose={() => setErrorCode(null)}
            closeText={t("draft-close")}
          >
            {t(errorKey(errorCode))}
          </Alert>
        ) : null}

        {busy === "generate" ? (
          <Box className="flex items-center gap-3 py-2" role="status">
            <CircularProgress size={20} aria-hidden />
            <Typography variant="body2" className="text-text-secondary">
              {t("dossier-generating")}
            </Typography>
          </Box>
        ) : inCourse ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("dossier-in-course", { when: last?.requestedLabel ?? "" })}
          </Alert>
        ) : unfinished ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("dossier-unfinished", { when: last?.requestedLabel ?? "" })}
          </Alert>
        ) : null}

        {latest ? (
          <Box className="flex flex-col gap-3">
            <Box className="flex flex-col gap-0.5">
              <Typography variant="subtitle2" component="h3" className="mb-0">
                {latest.issuedLabel ? t("dossier-issued-at", { when: latest.issuedLabel }) : t("dossier-issued")}
              </Typography>
              {latest.verifyCode ? (
                // Text, so that it is selected and copied: the code is what somebody types at /verificar.
                <Typography variant="body2" className="text-text-secondary">
                  {t("dossier-code-label")}{" "}
                  <Box component="span" className="text-text-primary font-mono select-all">
                    {latest.verifyCode}
                  </Box>
                </Typography>
              ) : null}
            </Box>
            <MetricBars
              whole={false}
              spacing="dense"
              items={HOLDS.filter(([key]) => typeof latest.summary[key] === "number").map(([key, label]) => ({
                key,
                label: t(label),
                value: latest.summary[key],
              }))}
            />
            <Box className="flex flex-wrap gap-2">
              <Button variant="contained" size="small" disabled={busy !== null} onClick={() => void open(latest.id)}>
                {t(busy === latest.id ? "dossier-opening" : "dossier-open")}
              </Button>
              {writable ? (
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => void generate()}
                >
                  {t("dossier-generate-again")}
                </Button>
              ) : null}
            </Box>
            {issued.length > 1 ? (
              <Box className="border-grey-100 flex flex-col gap-1 border-t pt-2">
                <Typography variant="body2" className="text-text-secondary">
                  {t("dossier-earlier")}
                </Typography>
                {issued.slice(1, 5).map((dossier) => (
                  <Button
                    key={dossier.id}
                    variant="text"
                    color="grey"
                    size="small"
                    disabled={busy !== null}
                    onClick={() => void open(dossier.id)}
                    className="-ml-2 self-start"
                    aria-label={t("dossier-open-of", { when: dossier.issuedLabel ?? dossier.requestedLabel })}
                  >
                    {dossier.issuedLabel ?? dossier.requestedLabel}
                  </Button>
                ))}
              </Box>
            ) : null}
          </Box>
        ) : busy !== "generate" ? (
          <EmptyState
            icon={<NiDocumentCheck />}
            title={t("dossier-none-title")}
            description={t("dossier-none-body")}
            action={writable ? { label: t("dossier-generate"), onClick: () => void generate() } : undefined}
            className="py-6"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
