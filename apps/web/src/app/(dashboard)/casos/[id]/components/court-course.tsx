"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { acknowledgeMovements, requestProceedingRead } from "@/lib/courts/actions";
import { courseErrorKey } from "@/lib/courts/course";
import type { CourseFacts, CourseView } from "@/lib/courts/course-facts";

/** How many of the latest movements show before a person asks for the rest. */
const FIRST_SHOWN = 5;

/**
 * The course of one lawsuit as the court shows it (migration 0031): when it
 * was last read and from where, what the court says of it (its unit, state
 * and judge), what waits in it with its term, and its latest movements, the
 * ones nobody of the firm saw yet marked. A person says they saw them, or
 * asks for a reading now. Each state says what happens next: the first
 * reading on its way, a court that does not show the lawsuit yet, a lawsuit
 * in secret, a reading given up, a court no source reads here yet.
 */
export default function CourtCourse({
  caseId,
  proceedingId,
  view,
  facts,
  writable,
  onChanged,
}: {
  caseId: string;
  proceedingId: string;
  view: CourseView | undefined;
  facts: CourseFacts;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<"read" | "seen" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!view || view.status === "off") return null;

  const act = async (kind: "read" | "seen") => {
    setBusy(kind);
    setProblem(null);
    try {
      const result =
        kind === "read"
          ? await requestProceedingRead(caseId, proceedingId)
          : await acknowledgeMovements(caseId, proceedingId);
      if (!result.ok) setProblem(result.code);
      onChanged();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  // Who reads it here: Projudi for TJGO's lawsuits, the aggregator for the others, when each is on.
  const reader = view.source === "projudi" ? facts.courtsOn : facts.aggregatorOn;
  const from =
    view.source === "projudi"
      ? t("course-from-projudi")
      : view.vendor
        ? t("course-from-vendor", { vendor: view.vendor })
        : t("course-from-aggregator");
  const state = (() => {
    if (!reader) return view.source === "projudi" || !facts.courtsOn ? t("course-off") : t("course-no-aggregator");
    // A reading given up says so first: a request it held was answered by it.
    if (view.status === "failed") return t("course-failed");
    if (view.asked) return t("course-asked");
    if (view.status === "waiting") return t("course-waiting");
    if (view.status === "not_found") {
      return view.checkedLabel ? t("course-not-found", { when: view.checkedLabel }) : t("course-not-found-plain");
    }
    if (view.status === "secret") return t("course-secret");
    return view.readLabel ? t("course-read", { from, when: view.readLabel }) : null;
  })();
  const about = [view.unit, view.courtStatus, view.phase, view.judge ? t("course-judge", { name: view.judge }) : null]
    .filter(Boolean)
    .join(" · ");
  const shown = all ? view.movements : view.movements.slice(0, FIRST_SHOWN);
  const mayRead = writable && reader && !view.asked;

  return (
    <Box
      className="border-grey-100 flex flex-col gap-2 border-t pt-3"
      component="section"
      aria-label={t("course-title")}
    >
      <Box className="flex flex-wrap items-center justify-between gap-2">
        <Typography variant="body1" className="font-semibold">
          {t("course-title")}
        </Typography>
        {view.unseen > 0 ? <StatusChip tone="attention" label={t("course-unseen", { count: view.unseen })} /> : null}
      </Box>
      {state ? (
        <Typography
          variant="body2"
          className="text-text-secondary"
          role={view.asked || view.status === "waiting" ? "status" : undefined}
        >
          {state}
        </Typography>
      ) : null}
      {about ? <Typography variant="body2">{about}</Typography> : null}

      {view.pending.length > 0 ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="text-text-secondary">
            {t("course-pending-title")}
          </Typography>
          <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
            {view.pending.map((entry, index) => (
              <Typography key={`${entry.title}-${index}`} component="li" variant="body2">
                {[
                  entry.title,
                  entry.endLabel ? t("course-pending-until", { when: entry.endLabel }) : entry.startLabel,
                  entry.status,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}

      {view.movements.length > 0 ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="text-text-secondary">
            {t("course-movements-title", { count: view.movementsCount })}
          </Typography>
          <Box component="ol" className="m-0 flex list-none flex-col gap-2 p-0">
            {shown.map((movement) => (
              <Box key={movement.id} component="li" className="flex flex-col">
                <Box className="flex flex-wrap items-center gap-2">
                  <Typography variant="body2" className="text-text-secondary">
                    {movement.atLabel}
                  </Typography>
                  {movement.fresh ? <StatusChip tone="attention" label={t("course-fresh")} /> : null}
                </Box>
                <Typography variant="body2" className="font-medium">
                  {movement.title}
                </Typography>
                {movement.detail ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {movement.detail}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Box>
          {view.movements.length > FIRST_SHOWN ? (
            <Box>
              <Button variant="text" color="grey" size="small" onClick={() => setAll(!all)}>
                {all ? t("course-show-fewer") : t("course-show-all", { count: view.movements.length })}
              </Button>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {view.lawyers.length > 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("course-lawyers", {
            names: view.lawyers
              .map((lawyer) => (lawyer.oab ? `${lawyer.name} (${lawyer.oab})` : lawyer.name))
              .join(", "),
          })}
        </Typography>
      ) : null}

      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(courseErrorKey(problem))}
        </Alert>
      ) : null}
      {writable && (view.unseen > 0 || mayRead) ? (
        <Box className="flex flex-wrap gap-2">
          {view.unseen > 0 ? (
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => void act("seen")}
            >
              {t("course-mark-seen")}
            </Button>
          ) : null}
          {mayRead ? (
            <Button variant="text" color="grey" size="small" disabled={busy !== null} onClick={() => void act("read")}>
              {busy === "read" ? t("course-reading") : t("course-read-now")}
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
