"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import NiArrowLeft from "@/icons/nexture/ni-arrow-left";
import NiReceipt from "@/icons/nexture/ni-receipt";
import NiScale from "@/icons/nexture/ni-scale";
import { actTestCourt, readTestCourt, testCourtReceipt } from "@/lib/test-court/actions";
import {
  answerKey,
  COURT_STEPS,
  type CourtStep,
  numberLabel,
  STEP_KEY,
  stepOpen,
  stepWaits,
  type TestCourtLawsuit,
  type TestCourtPackage,
  type TestCourtView,
} from "@/lib/test-court/test-court";

/** How often the court is read again while the page is in front of somebody: a receipt attached in ONE brings its lawsuit here. */
const VIEW_EVERY_MS = 10_000;

/** The kind of a lawsuit, in words. */
const KIND_KEY: Record<string, string> = {
  juizado: "test-court-kind-juizado",
  comum: "test-court-kind-comum",
};

/** A hearing's moment as the database answers it (2026-10-27T15:30), as a person reads it. */
const momentWords = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} às ${iso.slice(11, 16)}`
    : iso;

type Notice = { tone: "success" | "error"; text: string; at: string };

/**
 * The test court of a firm, where whoever tests stands where the court and
 * the DJEN stand: the packages of the test cases ready to file, each filed
 * here with the number and the receipt the lawyer attaches in ONE; and the
 * test lawsuits filed, each moved step by step as a lawsuit of the
 * small-claims court goes. ONE receives each step as it would from the court
 * and from the DJEN.
 */
export default function TestCourt({ token, initial }: { token: string; initial: TestCourtView }) {
  const t = useTranslations("product");
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [received, setReceived] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  // The clock a hearing's step opens by, moved with each read of the court.
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const read = await readTestCourt(token);
    if (read.ok) setView(read.view);
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void refresh();
    }, VIEW_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (lawsuit: TestCourtLawsuit, step: CourtStep) => {
    setBusy(`${lawsuit.id}:${step}`);
    setNotice(null);
    try {
      const answer = await actTestCourt(token, lawsuit.id, step);
      if (!answer.ok && answer.code === "hearing_later" && answer.hearingAt) {
        setNotice({
          tone: "error",
          text: t("test-court-error-hearing-later", { when: momentWords(answer.hearingAt) }),
          at: lawsuit.id,
        });
      } else if (!answer.ok) {
        setNotice({ tone: "error", text: t(answerKey(answer.code)), at: lawsuit.id });
      } else if (step === "audiencia" && answer.hearingAt) {
        setNotice({
          tone: "success",
          text: t("test-court-done-hearing", { when: momentWords(answer.hearingAt) }),
          at: lawsuit.id,
        });
      } else if (answer.published) {
        setNotice({ tone: "success", text: t("test-court-done-published"), at: lawsuit.id });
      } else {
        setNotice({ tone: "success", text: t("test-court-done-moved"), at: lawsuit.id });
      }
      await refresh();
    } catch {
      setNotice({ tone: "error", text: t("test-court-error-failed"), at: lawsuit.id });
    } finally {
      setBusy(null);
    }
  };

  const copyNumber = async (filing: TestCourtPackage) => {
    if (!filing.number) return;
    try {
      await navigator.clipboard.writeText(numberLabel(filing.number));
      setCopied(filing.id);
    } catch {
      setCopied(null);
    }
  };

  const downloadReceipt = async (filing: TestCourtPackage) => {
    setBusy(filing.id);
    setNotice(null);
    try {
      const receipt = await testCourtReceipt(token, filing.id);
      if (!receipt.ok) {
        setNotice({ tone: "error", text: t("test-court-error-failed"), at: filing.id });
        return;
      }
      const bytes = Uint8Array.from(atob(receipt.base64), (character) => character.charCodeAt(0));
      const address = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = address;
      anchor.download = receipt.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(address), 10_000);
    } catch {
      setNotice({ tone: "error", text: t("test-court-error-failed"), at: filing.id });
    } finally {
      setBusy(null);
    }
  };

  const caseWords = (seq: number | null, client: string | null) =>
    [seq !== null ? t("test-court-case-seq", { seq }) : null, client].filter(Boolean).join(" · ");
  const placeWords = (kind: string | null, court: string | null, comarca: string | null) =>
    [kind && KIND_KEY[kind] ? t(KIND_KEY[kind]) : null, court, comarca].filter(Boolean).join(" · ");

  return (
    <Box className="flex min-h-screen w-full justify-center px-3 py-4 sm:px-4 sm:py-8">
      <Box className="flex w-full max-w-3xl flex-col gap-4">
        <Box className="flex flex-col gap-1 px-1">
          <Box className="flex flex-row flex-wrap items-center gap-2">
            <Typography variant="h1" component="h1" className="mb-0 text-2xl sm:text-3xl">
              {t("test-court-title")}
            </Typography>
            <StatusChip tone="info" label={t("test-chat-chip")} />
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            {t("test-court-subtitle", { firm: view.firm })}
          </Typography>
          <Box>
            <Button
              variant="text"
              color="grey"
              size="small"
              href={`/t/${token}`}
              startIcon={<NiArrowLeft size="small" />}
            >
              {t("test-court-back")}
            </Button>
          </Box>
        </Box>

        <Card component="section" aria-labelledby="test-court-filing">
          <CardContent className="flex flex-col gap-3">
            <Typography id="test-court-filing" variant="h5" component="h2" className="mb-0">
              {t("test-court-filing-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("test-court-filing-body")}
            </Typography>
            {view.packages.length === 0 ? (
              <EmptyState
                titleAs="h3"
                icon={<NiReceipt />}
                title={t("test-court-filing-empty-title")}
                description={t("test-court-filing-empty-body")}
              />
            ) : (
              view.packages.map((filing) => (
                <Box key={filing.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
                  <Typography variant="body1" className="font-semibold">
                    {caseWords(filing.caseSeq, filing.client)}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {[
                      placeWords(filing.kind, filing.court, filing.comarca),
                      t("test-court-files", { count: filing.files }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  {notice && notice.at === filing.id ? (
                    <Alert
                      severity={notice.tone}
                      className="neutral bg-background-paper/60!"
                      onClose={() => setNotice(null)}
                    >
                      {notice.text}
                    </Alert>
                  ) : null}
                  {received[filing.id] && filing.number ? (
                    <>
                      <Typography variant="body2" className="font-medium break-words" role="status">
                        {t("test-court-filed", { number: numberLabel(filing.number) })}
                      </Typography>
                      <Box className="flex flex-wrap gap-2">
                        <Button
                          variant="contained"
                          size="small"
                          disabled={busy !== null}
                          onClick={() => void downloadReceipt(filing)}
                        >
                          {t("test-court-download-receipt")}
                        </Button>
                        <Button variant="outlined" color="grey" size="small" onClick={() => void copyNumber(filing)}>
                          {copied === filing.id ? t("test-court-copied") : t("test-court-copy-number")}
                        </Button>
                      </Box>
                      <Typography variant="body2" className="text-text-secondary">
                        {t("test-court-filed-next")}
                      </Typography>
                    </>
                  ) : (
                    <Box>
                      <Button
                        variant="contained"
                        size="small"
                        disabled={!filing.number}
                        onClick={() => setReceived((state) => ({ ...state, [filing.id]: true }))}
                      >
                        {t("test-court-file")}
                      </Button>
                    </Box>
                  )}
                </Box>
              ))
            )}
          </CardContent>
        </Card>

        <Card component="section" aria-labelledby="test-court-lawsuits">
          <CardContent className="flex flex-col gap-3">
            <Typography id="test-court-lawsuits" variant="h5" component="h2" className="mb-0">
              {t("test-court-lawsuits-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("test-court-lawsuits-body")}
            </Typography>
            {view.lawsuits.length === 0 ? (
              <EmptyState
                titleAs="h3"
                icon={<NiScale />}
                title={t("test-court-lawsuits-empty-title")}
                description={t("test-court-lawsuits-empty-body")}
              />
            ) : (
              view.lawsuits.map((lawsuit) => {
                const archived = lawsuit.done.includes("arquivamento");
                const headingId = `test-court-lawsuit-${lawsuit.id}`;
                return (
                  <Box
                    key={lawsuit.id}
                    component="article"
                    aria-labelledby={headingId}
                    className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4"
                  >
                    <Box className="flex flex-wrap items-start justify-between gap-2">
                      <Box className="flex min-w-0 flex-1 basis-60 flex-col">
                        <Typography id={headingId} variant="body1" className="font-semibold break-words">
                          {t("test-court-lawsuit", { number: numberLabel(lawsuit.cnj) })}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[
                            caseWords(lawsuit.caseSeq, lawsuit.client),
                            placeWords(lawsuit.kind, lawsuit.court, lawsuit.comarca),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      </Box>
                      <StatusChip
                        tone={archived || lawsuit.status !== "filed" ? "neutral" : "info"}
                        label={
                          archived
                            ? t("test-court-status-archived")
                            : lawsuit.status !== "filed"
                              ? t("test-court-status-closed")
                              : t("test-court-status-open")
                        }
                      />
                    </Box>
                    {notice && notice.at === lawsuit.id ? (
                      <Alert
                        severity={notice.tone}
                        className="neutral bg-background-paper/60!"
                        onClose={() => setNotice(null)}
                      >
                        {notice.text}
                      </Alert>
                    ) : null}
                    <Box component="ol" className="m-0 flex list-none flex-col gap-2 p-0">
                      {COURT_STEPS.map((step) => {
                        const done = lawsuit.done.includes(step);
                        const waits = stepWaits(step, lawsuit.hearingAt, now);
                        const open = lawsuit.status === "filed" && stepOpen(step, lawsuit.done) && !waits;
                        return (
                          <Box
                            key={step}
                            component="li"
                            className="border-grey-100 flex flex-wrap items-center justify-between gap-2 border-t pt-2"
                          >
                            <Box className="flex min-w-0 flex-1 basis-64 flex-col">
                              <Typography variant="body2" className="font-medium">
                                {t(STEP_KEY[step].title)}
                              </Typography>
                              <Typography variant="body2" className="text-text-secondary">
                                {step === "audiencia" && done && lawsuit.hearing
                                  ? t("test-court-hearing-set", { when: lawsuit.hearing })
                                  : !done && waits && lawsuit.hearing
                                    ? t("test-court-hearing-wait", { when: lawsuit.hearing })
                                    : t(STEP_KEY[step].body)}
                              </Typography>
                            </Box>
                            {done ? (
                              <StatusChip tone="positive" label={t("test-court-step-done")} />
                            ) : (
                              <Button
                                variant={open ? "contained" : "outlined"}
                                color={open ? "primary" : "grey"}
                                size="small"
                                disabled={!open || busy !== null}
                                onClick={() => void act(lawsuit, step)}
                              >
                                {busy === `${lawsuit.id}:${step}` ? t("test-court-acting") : t("test-court-act")}
                              </Button>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                );
              })
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
